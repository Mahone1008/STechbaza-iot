"""Часові межі, якість показань та контракт без зовнішніх сервісів."""

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from pydantic import ValidationError

from app.main import app
from app.schemas.telemetry_read import TelemetrySeriesQuery
from app.services.telemetry_policy import VALUE_CAPABILITY_REQUIREMENTS
from app.services.telemetry_quality import freshness, readings, numeric_value, json_safe
from app.services.telemetry_read_config import METRIC_UNITS, TELEMETRY_STALE_AFTER_SECONDS
from auth_http_helpers import request


class TelemetryReadTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 26, 12, tzinfo=timezone.utc)

    def snapshot(self, **changes):
        fields = dict(last_received_at=self.now, last_reported_at=None,
                      last_session_id=None, values={})
        fields.update(changes)
        return SimpleNamespace(**fields)

    def test_query_normalizes_timezone_and_rejects_invalid_windows(self):
        query = TelemetrySeriesQuery(metric="pressure.bar", start="2026-09-26T15:00:00+03:00",
                                     end="2026-09-26T15:10:00+03:00", bucket_seconds=60)
        self.assertEqual(query.start, self.now)
        self.assertEqual(query.start.utcoffset(), timedelta(0))
        cases = [
            {"start": "2026-09-26T12:00:00"},
            {"end": self.now},
            {"end": self.now - timedelta(seconds=1)},
            {"end": self.now + timedelta(days=7, microseconds=1)},
            {"bucket_seconds": 0},
            {"bucket_seconds": 86401},
            {"end": self.now + timedelta(seconds=1001), "bucket_seconds": 1},
        ]
        for change in cases:
            with self.subTest(change=change), self.assertRaises(ValidationError):
                TelemetrySeriesQuery(**{"metric": "pressure.bar", "start": self.now,
                    "end": self.now + timedelta(minutes=10), "bucket_seconds": 60, **change})

    def test_max_window_and_exact_bucket_limit_are_accepted(self):
        self.assertEqual(TelemetrySeriesQuery(metric="pressure.bar", start=self.now,
            end=self.now + timedelta(days=7), bucket_seconds=86400).end, self.now + timedelta(days=7))
        TelemetrySeriesQuery(metric="pressure.bar", start=self.now,
                             end=self.now + timedelta(seconds=1000), bucket_seconds=1)

    def test_numeric_zero_is_valid_bool_string_and_nonfinite_are_not(self):
        self.assertEqual(numeric_value(0), 0.0)
        self.assertEqual(numeric_value(-2.5), -2.5)
        for value in (None, True, False, "2.5", {}, [], float("nan"), float("inf"), 10**1000):
            self.assertIsNone(numeric_value(value))
        self.assertEqual(json_safe({"flag": False, "list": [0, float("inf")]}), {"flag": False, "list": [0, None]})

    def test_freshness_boundary_timeout_and_no_telemetry(self):
        self.assertEqual(freshness(None, device_session_id=None, now=self.now).status, "missing")
        at_boundary = self.now - timedelta(seconds=TELEMETRY_STALE_AFTER_SECONDS)
        self.assertEqual(freshness(self.snapshot(last_received_at=at_boundary),
                                  device_session_id=None, now=self.now).status, "fresh")
        self.assertEqual(freshness(self.snapshot(last_received_at=at_boundary - timedelta(microseconds=1)),
                                  device_session_id=None, now=self.now).reason, "timeout")

    def test_future_clock_delayed_report_and_session_change_are_stale(self):
        cases = [
            ({"last_received_at": self.now + timedelta(seconds=1)}, None, "future_timestamp"),
            ({"last_reported_at": self.now + timedelta(seconds=31)}, None, "future_timestamp"),
            ({"last_reported_at": self.now - timedelta(hours=1)}, None, "delayed_report"),
            ({"last_session_id": uuid.uuid4()}, uuid.uuid4(), "session_changed"),
        ]
        for fields, session_id, reason in cases:
            result = freshness(self.snapshot(**fields), device_session_id=session_id, now=self.now)
            self.assertEqual(result.status, "stale")
            self.assertEqual(result.reason, reason)

    def test_readings_keep_missing_invalid_zero_and_stale_distinct(self):
        self.assertEqual(set(METRIC_UNITS), set(VALUE_CAPABILITY_REQUIREMENTS))
        snapshot = self.snapshot(values={"pressure.bar": 0, "vfd.current_a": True, "vfd.frequency_hz": None},
                                 last_received_at=self.now - timedelta(hours=1))
        quality = freshness(snapshot, device_session_id=None, now=self.now)
        result = {r.key: r for r in readings(sorted(METRIC_UNITS), snapshot, quality)}
        self.assertEqual((result["pressure.bar"].value, result["pressure.bar"].status), (0, "stale"))
        self.assertEqual(result["vfd.current_a"].status, "invalid")
        self.assertEqual(result["vfd.frequency_hz"].status, "missing")
        self.assertEqual(result["water_level.percent"].status, "missing")

    def test_series_requires_bearer_and_openapi_exposes_limits_and_quality(self):
        path = f"/api/v1/devices/{uuid.uuid4()}/telemetry/series"
        for token in (None, "invalid"):
            headers = {"authorization": f"Bearer {token}"} if token else {}
            self.assertEqual(request("GET", path, headers=headers)[0], 401)
        spec = app.openapi()
        route = spec["paths"]["/api/v1/devices/{device_id}/telemetry/series"]["get"]
        self.assertEqual(route["security"], [{"HTTPBearer": []}])
        params = {p["name"]: p for p in route["parameters"]}
        self.assertEqual(params["start"]["schema"]["format"], "date-time")
        self.assertTrue(params["end"]["required"])
        for status in ("200", "401", "403", "404", "409", "422", "503"):
            self.assertIn(status, route["responses"])
        fields = spec["components"]["schemas"]["DeviceOverviewRead"]["properties"]
        self.assertIn("telemetry_freshness", fields)
        self.assertIn("readings", fields)

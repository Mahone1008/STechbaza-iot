"""Часові агрегати та якість dashboard на PostgreSQL зі справжнім JWT."""

import os
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.parse import urlencode

from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import OperationalError

from app.db import SessionLocal
from app.models.capability import Capability, DeviceCapability
from app.models.device import Device
from app.models.organization import Organization
from app.models.organization_membership import OrganizationMembership
from app.models.site import Site
from app.models.telemetry import DeviceState, TelemetryMessage
from app.models.user import User
from app.security.roles import ORGANIZATION_ROLE_PERMISSIONS, OrganizationRole, Permission
from app.security.tokens import create_access_token
from app.tools.alarm_ack_check import _identity
from auth_http_helpers import request


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires PostgreSQL opt-in")
class TelemetryReadPostgresTests(unittest.TestCase):
    def setUp(self):
        self.orgs = [uuid.uuid4(), uuid.uuid4()]
        self.sites = [uuid.uuid4(), uuid.uuid4()]
        self.devices = [uuid.uuid4(), uuid.uuid4()]
        self.identities = {}
        self.tokens = {}
        self.created_caps = []
        self.start = datetime(2026, 9, 20, 12, tzinfo=timezone.utc)
        self.end = self.start + timedelta(minutes=5)
        self.addCleanup(self.cleanup_data)
        with SessionLocal() as session:
            for org, site, device in zip(self.orgs, self.sites, self.devices):
                session.add(Organization(id=org, name="Chart test", slug=f"chart-{org.hex}"))
                session.flush()
                session.add(Site(id=site, organization_id=org, name="Chart test", code="test"))
                session.flush()
                session.add(Device(id=device, site_id=site, uid=f"TB-CHART-{device.hex}",
                                   name="Chart test", lifecycle_status="active"))
            for role, org in (("viewer", self.orgs[0]), ("owner", self.orgs[0]), ("outsider", self.orgs[1])):
                ctx = _identity(session, org, "viewer" if role == "outsider" else role)
                self.identities[role] = ctx
                self.tokens[role] = create_access_token(user_id=ctx.user.id, auth_session_id=ctx.auth_session.id).token
            session.commit()
        self.pressure_id = self.assign("pressure.read")

    def cleanup_data(self):
        with SessionLocal() as session:
            session.execute(delete(Organization).where(Organization.id.in_(self.orgs)))
            session.execute(delete(User).where(User.id.in_([ctx.user.id for ctx in self.identities.values()])))
            session.execute(delete(Capability).where(Capability.id.in_(self.created_caps)))
            session.commit()

    def assign(self, code, enabled=True):
        with SessionLocal() as session:
            created = session.scalar(insert(Capability).values(id=uuid.uuid4(), code=code, name="Chart test")
                .on_conflict_do_nothing(index_elements=["code"]).returning(Capability.id))
            if created:
                self.created_caps.append(created)
            cap_id = session.scalar(select(Capability.id).where(Capability.code == code))
            session.add(DeviceCapability(device_id=self.devices[0], capability_id=cap_id, is_enabled=enabled, config={}))
            session.commit()
            return cap_id

    def message(self, seconds, values, *, device=None, sent_at=None, message_id=None, record_id=None):
        with SessionLocal() as session:
            item = TelemetryMessage(id=record_id or uuid.uuid4(), message_id=message_id or uuid.uuid4(),
                device_id=device or self.devices[0], schema_version=1, received_at=self.start + timedelta(seconds=seconds),
                sent_at=sent_at, values=values, state={})
            session.add(item)
            session.commit()
            return item.id

    def call(self, path, *, who="viewer", expected=200):
        code, body, _ = request("GET", path, headers={"authorization": f"Bearer {self.tokens[who]}"})
        self.assertEqual(code, expected, (path, code, body))
        return body

    def series(self, *, who="viewer", expected=200, device=None, **query):
        params = {"metric": "pressure.bar", "start": self.start.isoformat(),
                  "end": self.end.isoformat(), "bucket_seconds": 60, **query}
        return self.call(f"/api/v1/devices/{device or self.devices[0]}/telemetry/series?{urlencode(params)}",
                         who=who, expected=expected)

    def overview(self):
        return self.call(f"/api/v1/devices/{self.devices[0]}/overview")

    def test_empty_history_has_explicit_null_buckets_and_missing_reading(self):
        result = self.series()
        self.assertEqual(result["message_count"], 0)
        self.assertEqual(result["unit"], "bar")
        self.assertEqual(len(result["buckets"]), 5)
        for bucket in result["buckets"]:
            self.assertEqual(bucket["status"], "empty")
            self.assertIsNone(bucket["average"])
        overview = self.overview()
        self.assertEqual(overview["telemetry_freshness"]["status"], "missing")
        self.assertEqual(overview["readings"], [{"key": "pressure.bar", "unit": "bar", "value": None, "status": "missing"}])

    def test_window_boundaries_min_max_average_zero_and_partial_last_bucket(self):
        for seconds, value in ((-1, 999), (0, 0), (59, 4), (60, 8), (299, 10), (300, 999)):
            self.message(seconds, {"pressure.bar": value})
        self.message(1, {"pressure.bar": 9999}, device=self.devices[1])
        result = self.series()
        self.assertEqual((result["message_count"], result["sample_count"]), (4, 4))
        first = result["buckets"][0]
        self.assertEqual((first["minimum"], first["maximum"], first["average"]), (0, 4, 2))
        self.assertEqual(result["buckets"][1]["average"], 8)
        self.assertEqual(result["buckets"][2]["status"], "empty")
        partial = self.series(end=(self.start + timedelta(seconds=75)).isoformat())
        self.assertEqual(len(partial["buckets"]), 2)
        self.assertEqual(datetime.fromisoformat(partial["buckets"][1]["end"].replace("Z", "+00:00")),
                         self.start + timedelta(seconds=75))

    def test_invalid_missing_and_mixed_values_do_not_become_measurements(self):
        for i, value in enumerate((0, 4, True, False, "12", {}, [], None)):
            self.message(i, {"pressure.bar": value})
        self.message(10, {})
        self.message(60, {"pressure.bar": "NaN"})
        self.message(120, {})
        result = self.series()
        first = result["buckets"][0]
        self.assertEqual((first["sample_count"], first["invalid_count"], first["missing_count"]), (2, 5, 2))
        self.assertEqual((first["status"], first["average"]), ("partial", 2))
        self.assertEqual(result["buckets"][1]["status"], "invalid")
        self.assertEqual(result["buckets"][2]["status"], "missing")
        self.assertIsNone(result["buckets"][1]["average"])

    def test_large_numbers_do_not_overflow_aggregate_or_json_response(self):
        self.message(0, {"pressure.bar": 1e308})
        self.message(1, {"pressure.bar": 1e308})
        # JSONB підтримує більше, ніж float; текстовий SQL потрібний лише fixture.
        item_id = self.message(2, {"pressure.bar": 1})
        with SessionLocal() as session:
            session.execute(text('UPDATE telemetry_messages SET "values" = CAST(:value AS jsonb) WHERE id = :id'),
                            {"value": '{"pressure.bar": 1e1000}', "id": item_id})
            session.commit()
        first = self.series()["buckets"][0]
        self.assertEqual(first["sample_count"], 2)
        self.assertEqual(first["invalid_count"], 1)
        self.assertEqual(first["average"], 1e308)

    def test_timezone_and_server_received_time_do_not_follow_device_clock(self):
        self.message(30, {"pressure.bar": 2}, sent_at=self.start - timedelta(days=30))
        first = self.series()
        offset = timezone(timedelta(hours=3))
        other = self.series(start=self.start.astimezone(offset).isoformat(), end=self.end.astimezone(offset).isoformat())
        self.assertEqual(first["buckets"], other["buckets"])
        self.assertEqual(first["time_basis"], "server_received_at")
        self.assertEqual(first["sample_count"], 1)

    def test_unknown_disabled_and_unassigned_metric_are_rejected(self):
        for metric in ("unknown", "pump_running", "pressure.bar'); DROP TABLE users;--"):
            self.series(metric=metric, expected=422)
        self.series(metric="vfd.current_a", expected=409)
        self.assign("vfd.frequency.read", enabled=False)
        self.series(metric="vfd.frequency_hz", expected=409)
        self.message(0, {"pressure.bar": 4})
        with SessionLocal() as session:
            assignment = session.scalar(select(DeviceCapability).where(DeviceCapability.device_id == self.devices[0],
                                                                        DeviceCapability.capability_id == self.pressure_id))
            assignment.is_enabled = False
            session.commit()
        self.series(expected=409)
        self.assertEqual(self.overview()["readings"], [])
        with SessionLocal() as session:
            self.assertIsNotNone(session.scalar(select(TelemetryMessage.id).where(TelemetryMessage.device_id == self.devices[0])))

    def test_tenant_isolation_revocation_and_narrowed_permissions(self):
        other = self.series(who="outsider", expected=404)
        absent = self.series(device=uuid.uuid4(), expected=404)
        self.assertEqual(other, absent)
        for removed in (Permission.TELEMETRY_READ, Permission.CAPABILITY_READ, Permission.DEVICE_READ):
            with patch.dict(ORGANIZATION_ROLE_PERMISSIONS,
                            {OrganizationRole.VIEWER: ORGANIZATION_ROLE_PERMISSIONS[OrganizationRole.VIEWER] - {removed}}):
                self.series(expected=403)
        with SessionLocal() as session:
            session.execute(delete(OrganizationMembership).where(OrganizationMembership.user_id == self.identities["viewer"].user.id))
            session.commit()
        self.series(expected=404)

    def test_http_validation_rejects_naive_reversed_and_oversized_range(self):
        for changes in ({"start": "2026-09-20T12:00:00"}, {"end": self.start.isoformat()},
                        {"end": (self.start + timedelta(days=8)).isoformat()}, {"bucket_seconds": 0},
                        {"end": (self.start + timedelta(seconds=1001)).isoformat(), "bucket_seconds": 1},
                        {"unexpected": "parameter"}):
            self.series(expected=422, **changes)

    def test_row_budget_refuses_partial_success_and_connection_timeout_resets(self):
        for seconds in range(4):
            self.message(seconds, {"pressure.bar": seconds})
        with patch("app.repositories.telemetry_series.SERIES_MAX_MESSAGES", 3), \
             patch("app.services.telemetry_series.SERIES_MAX_MESSAGES", 3):
            self.series(expected=422)
        self.assertEqual(self.series()["sample_count"], 4)
        with SessionLocal() as session:
            self.assertEqual(session.scalar(text("SHOW statement_timeout")), "0")

    def test_storage_failure_returns_controlled_503(self):
        with patch("app.repositories.telemetry_series.TelemetrySeriesRepository.aggregate",
                   side_effect=OperationalError("test-only", {}, Exception("injected"))):
            with self.assertLogs("app.api.v1.frontend", level="ERROR"):
                self.series(expected=503)

    def test_dashboard_online_does_not_freshen_old_or_previous_session_values(self):
        now = datetime.now(timezone.utc)
        with SessionLocal() as session:
            session.get(Device, self.devices[0]).last_seen_at = now
            session.add(DeviceState(device_id=self.devices[0], last_received_at=now - timedelta(hours=1),
                                    values={"pressure.bar": 0}, state={}))
            session.commit()
        result = self.overview()
        self.assertTrue(result["availability"]["online"])
        self.assertEqual(result["telemetry_freshness"]["reason"], "timeout")
        self.assertEqual((result["readings"][0]["value"], result["readings"][0]["status"]), (0, "stale"))
        with SessionLocal() as session:
            session.get(DeviceState, self.devices[0]).last_received_at = now
            session.get(Device, self.devices[0]).last_observed_session_id = uuid.uuid4()
            session.commit()
        self.assertEqual(self.overview()["telemetry_freshness"]["reason"], "session_changed")

    def test_dashboard_filters_invalid_readings_without_mutating_snapshot(self):
        now = datetime.now(timezone.utc)
        self.assign("vfd.state.read")
        with SessionLocal() as session:
            session.add(DeviceState(device_id=self.devices[0], last_received_at=now,
                                    values={"pressure.bar": True}, state={"pump_running": False}))
            session.commit()
        result = self.overview()
        self.assertEqual(result["readings"][0]["status"], "invalid")
        self.assertIsNone(result["snapshot"]["values"]["pressure.bar"])
        self.assertIs(result["snapshot"]["state"]["pump_running"], False)
        with SessionLocal() as session:
            self.assertIs(session.get(DeviceState, self.devices[0]).values["pressure.bar"], True)

    def test_raw_history_uses_uuid_tie_breaker(self):
        ids = [uuid.UUID(int=90001), uuid.UUID(int=90002)]
        # UUID залишається унікальним між паралельними наборами тестів.
        ids = [uuid.UUID(int=(self.devices[0].int & ~0xfffff) + item.int) for item in ids]
        for record_id in ids:
            self.message(0, {"pressure.bar": 1}, record_id=record_id)
        base = f"/api/v1/devices/{self.devices[0]}/telemetry?limit=1"
        self.assertEqual(self.call(base)[0]["id"], str(ids[1]))
        self.assertEqual(self.call(base + "&offset=1")[0]["id"], str(ids[0]))

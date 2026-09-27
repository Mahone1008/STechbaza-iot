"""H-04: єдиний каталог підтримки та типізовані state-показники для UI."""

import unittest
from types import SimpleNamespace as NS
from typing import get_args

from app.device_contract import COMMAND_REQUIRED_CAPABILITY, STATE_CHANNELS, TELEMETRY_CHANNELS
from app.main import app
from app.schemas.command import CommandType
from app.schemas.telemetry_read import TelemetryFreshnessRead
from app.services.telemetry_policy import validate_telemetry_capabilities
from app.services.telemetry_quality import state_readings


def quality(status="fresh", reason="recent"):
    return TelemetryFreshnessRead(status=status, reason=reason, received_at=None,
        reported_at=None, received_age_seconds=None, stale_after_seconds=120)


class ModuleContractTests(unittest.TestCase):
    def test_registry_covers_ingress_and_public_commands_without_duplicate_channels(self):
        self.assertEqual(set(COMMAND_REQUIRED_CAPABILITY), set(get_args(CommandType)))
        identities = [(item.source, item.key) for item in TELEMETRY_CHANNELS]
        self.assertEqual(len(identities), len(set(identities)))
        for channel in TELEMETRY_CHANNELS:
            keys = {"value_keys": set(), "state_keys": set()}
            keys["value_keys" if channel.source == "values" else "state_keys"] = {channel.key}
            self.assertTrue(validate_telemetry_capabilities(**keys,
                enabled_capabilities={channel.capability_code}).allowed)
            self.assertFalse(validate_telemetry_capabilities(**keys, enabled_capabilities=set()).allowed)
            self.assertEqual(channel.supports_series, channel.source == "values")
            self.assertEqual(channel.unit is not None, channel.supports_series)

    def test_false_zero_and_missing_remain_distinct(self):
        result = {item.key: item.model_dump() for item in state_readings(sorted(STATE_CHANNELS),
            NS(state={"pump_running": False, "vfd_fault_code": 0, "local_mode": None}), quality())}
        self.assertIs(result["pump_running"]["value"], False)
        self.assertIs(type(result["vfd_fault_code"]["value"]), int)
        self.assertEqual(result["vfd_fault_code"]["value"], 0)
        self.assertEqual(result["pump_running"]["status"], "fresh")
        for key in ("local_mode", "emergency_stop"):
            self.assertEqual((result[key]["value"], result[key]["status"]), (None, "missing"))

    def test_invalid_state_does_not_coerce_to_off_or_ok(self):
        for key, values in (
            ("pump_running", (0, 1, "false", [], {}, 1.0)),
            ("vfd_fault_code", (False, True, "0", 0.0, [], 2**53, -(2**53), 10**400, float("inf"), float("nan"))),
        ):
            for raw in values:
                with self.subTest(key=key, raw_type=type(raw).__name__):
                    reading = state_readings([key], NS(state={key: raw}), quality())[0]
                    self.assertIsNone(reading.value)
                    self.assertEqual(reading.status, "invalid")

    def test_state_integer_limits_round_trip_exactly(self):
        for value in (-(2**53 - 1), 2**53 - 1, 42):
            reading = state_readings(["vfd_fault_code"], NS(state={"vfd_fault_code": value}), quality())[0]
            self.assertEqual(reading.value, value)
            self.assertIs(type(reading.value), int)

    def test_stale_and_no_telemetry_do_not_become_current_values(self):
        for reason in ("session_changed", "timeout", "future_timestamp", "delayed_report"):
            reading = state_readings(["pump_running"], NS(state={"pump_running": True}), quality("stale", reason))[0]
            self.assertIs(reading.value, True)
            self.assertEqual(reading.status, "stale")
        reading = state_readings(["pump_running"], None, quality("missing", "no_telemetry"))[0]
        self.assertEqual((reading.value, reading.status), (None, "missing"))

    def test_openapi_exposes_required_modules_and_strict_state_types(self):
        schemas = app.openapi()["components"]["schemas"]
        overview = schemas["DeviceOverviewRead"]
        for key in ("modules", "state_readings"):
            self.assertIn(key, overview["required"])
        self.assertEqual(overview["properties"]["modules"]["items"]["$ref"], "#/components/schemas/DeviceModuleRead")
        channel = schemas["TelemetryChannelRead"]["properties"]
        self.assertEqual(set(channel["source"]["enum"]), {"values", "state"})
        self.assertEqual(set(channel["data_type"]["enum"]), {"number", "boolean", "integer"})
        types = {item["type"] for item in schemas["StateReadingRead"]["properties"]["value"]["anyOf"]}
        self.assertEqual(types, {"boolean", "integer", "null"})

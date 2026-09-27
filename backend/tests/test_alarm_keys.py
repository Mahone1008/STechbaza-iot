"""H-03: reserved namespace write guards та legacy runtime isolation."""

import unittest
import uuid
from types import SimpleNamespace as NS
from unittest.mock import Mock

from pydantic import ValidationError

from app.schemas.alarm_rule import parse_alarm_rules
from app.schemas.capability import DeviceCapabilityAssign, DeviceCapabilityUpdate
from app.services.alarm_rule_engine import TelemetryAlarmRuleEngine


def rule(key="test.pressure", **changes):
    return {"rule_key": key, "alarm_type": "pressure.low", "metric": "pressure.bar",
            "kind": "low", "threshold": 1, "clear_threshold": 2, "debounce_samples": 1,
            "severity": "warning", "title": "Test pressure", **changes}


class AlarmKeyTests(unittest.TestCase):
    def test_assign_and_patch_reject_reserved_keys_even_when_disabled(self):
        for key in ("device", "command", "device.offline", "device.reboot", "device.future",
                    "command.failed.vfd.start", f"command.result_unknown.{uuid.uuid4()}"):
            for schema in (DeviceCapabilityAssign, DeviceCapabilityUpdate):
                for enabled in (False, True):
                    with self.subTest(key=key, schema=schema, enabled=enabled):
                        with self.assertRaisesRegex(ValidationError, "зарезервовані"):
                            schema(is_enabled=enabled, config={"alarm_rules": [rule(key, enabled=enabled)]})

    def test_nonreserved_names_and_empty_configuration_remain_compatible(self):
        for key in ("pressure.low", "demo.pressure.low", "my.device.offline", "device_pressure.low",
                    "devices.offline", "command-center.pressure", "test:pressure"):
            config = {"alarm_rules": [rule(key)]}
            self.assertEqual(DeviceCapabilityAssign(config=config).config, config)
            self.assertEqual(DeviceCapabilityUpdate(config=config).config, config)
        self.assertEqual(parse_alarm_rules({}), [])
        with self.assertRaises(ValueError):
            parse_alarm_rules([])

    def test_legacy_reserved_rule_does_not_hide_valid_rule_in_same_assignment(self):
        engine = TelemetryAlarmRuleEngine(Mock())
        engine._capabilities = Mock()
        engine._capabilities.get_enabled_assignments_for_device.return_value = [NS(
            capability_id=uuid.uuid4(), capability=NS(code="pressure.read"),
            config={"alarm_rules": [rule("device.offline"), rule()]},
        )]
        with self.assertLogs("app.services.alarm_rule_engine", "ERROR") as logs:
            loaded = engine._load_rules(uuid.uuid4())
        self.assertEqual([r.rule_key for _, r in loaded], ["test.pressure"])
        self.assertIn("Reserved alarm rule skipped", logs.output[0])


if __name__ == "__main__":
    unittest.main()

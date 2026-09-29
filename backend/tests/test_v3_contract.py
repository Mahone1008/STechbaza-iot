"""Physical V3 channels and installation subsets must preserve modularity and null quality."""
import unittest
from types import SimpleNamespace
from app.bench.su600 import CAPABILITIES, CONTROL_CONFIG, UID
from app.demo.catalog import DEVICES, uid
from app.device_contract import selected_channels
from app.schemas.capability import DeviceCapabilityAssign, DeviceCapabilityUpdate
from app.schemas.telemetry import TelemetryEnvelope
from app.services.telemetry_policy import validate_telemetry_capabilities
from app.services.telemetry_quality import readings, state_readings
from app.schemas.telemetry_read import TelemetryFreshnessRead


class V3ContractTests(unittest.TestCase):
    def test_physical_identity_and_channels_do_not_claim_optional_sensors(self):
        self.assertNotIn(UID, [uid(key) for key in DEVICES])
        envelope = TelemetryEnvelope(schema_version=1, message_id="12b88b70-d0f6-4c77-b461-247229542727",
            session_id="4d596a63-f561-4518-8738-0cb3b0c84d3f", sequence=0,
            values={"vfd.frequency_hz": 0, "vfd.set_frequency_hz": 19, "vfd.current_a": 0, "vfd.voltage_v": 0},
            state={"pump_running": False, "vfd_fault_code": 0, "vfd_link": True,
                   "vfd_configuration_valid": True, "control_armed": False})
        policy = validate_telemetry_capabilities(value_keys=set(envelope.values), state_keys=set(envelope.state), enabled_capabilities=set(CAPABILITIES))
        self.assertTrue(policy.allowed)
        policy = validate_telemetry_capabilities(value_keys={"pressure.bar"}, state_keys=set(), enabled_capabilities=set(CAPABILITIES))
        self.assertFalse(policy.allowed)
        self.assertEqual(CONTROL_CONFIG["frequency_limits"], {"min_hz": 0, "max_hz": 50})

    def test_installation_subset_cannot_add_an_uninstalled_switch_or_foreign_channel(self):
        channels = selected_channels("vfd.state.read", {"telemetry_keys": ["pump_running", "vfd_fault_code"]})
        self.assertEqual({item.key for item in channels}, {"pump_running", "vfd_fault_code"})
        for invalid in (["pressure.bar"], ["pump_running", "pump_running"], "pump_running"):
            self.assertEqual(selected_channels("vfd.state.read", {"telemetry_keys": invalid}), ())
        self.assertEqual(len(selected_channels("vfd.state.read", {})), 4)
        for invalid in (None, ["fake.channel"], [123], ["pump_running", "pump_running"]):
            with self.assertRaises(ValueError):
                DeviceCapabilityAssign(config={"telemetry_keys": invalid})
        self.assertIsNone(DeviceCapabilityUpdate(config=None).config)

    def test_vfd_disconnected_snapshot_does_not_show_zero_measurements_or_running_false(self):
        snapshot = SimpleNamespace(values={}, state={"vfd_link": False, "control_armed": False})
        quality = TelemetryFreshnessRead(status="fresh", reason="recent", received_at=None,
            reported_at=None, received_age_seconds=0, stale_after_seconds=20)
        metrics = readings(["vfd.frequency_hz", "vfd.set_frequency_hz", "vfd.current_a", "vfd.voltage_v"], snapshot, quality)
        self.assertTrue(all(item.value is None and item.status == "missing" for item in metrics))
        states = {item.key: item for item in state_readings(["vfd_link", "pump_running", "vfd_fault_code"], snapshot, quality)}
        self.assertIs(states["vfd_link"].value, False)
        self.assertIsNone(states["pump_running"].value)
        self.assertIsNone(states["vfd_fault_code"].value)

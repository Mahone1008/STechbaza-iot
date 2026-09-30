"""Physical V3 channels and installation subsets must preserve modularity and null quality."""
import unittest
import copy
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from app.bench.su600 import CAPABILITIES, CONTROL_CONFIG, EXTENDED_CONTROL_CONFIG, UID, DEVICE_ID, SITE_ID, prepare
from app.models.device import Device
from app.models.site import Site
from app.models.organization import Organization
from app.demo.catalog import DEVICES, uid
from app.device_contract import selected_channels
from app.schemas.capability import DeviceCapabilityAssign, DeviceCapabilityUpdate
from app.schemas.telemetry import TelemetryEnvelope
from app.services.telemetry_policy import validate_telemetry_capabilities
from app.services.telemetry_quality import readings, state_readings
from app.schemas.telemetry_read import TelemetryFreshnessRead


class V3ContractTests(unittest.TestCase):
    def test_explicit_test_mode_switch_preserves_identity_and_refuses_foreign_profile(self):
        org = SimpleNamespace(id=uuid.uuid4(), slug="techbaza-demo-a", is_active=True)
        site = SimpleNamespace(id=SITE_ID, organization_id=org.id, code="v3-su600-bench")
        device = SimpleNamespace(id=DEVICE_ID, site_id=SITE_ID, uid=UID)
        control = SimpleNamespace(config=copy.deepcopy(CONTROL_CONFIG), is_enabled=False)
        session = MagicMock()
        session.get.side_effect = lambda model, key: {Organization: org, Site: site, Device: device}[model]

        def run(**kwargs):
            rows = []
            for code, name in CAPABILITIES.items():
                rows += [SimpleNamespace(id=uuid.uuid4(), name=name), control if code == "vfd.control" else SimpleNamespace()]
            session.scalar.side_effect = rows
            with patch("app.bench.su600.SessionLocal") as factory, patch("app.bench.su600.assert_database"):
                factory.begin.return_value.__enter__.return_value = session
                return prepare(**kwargs)

        result = run(enable_control=True, extended_test=True)
        self.assertEqual(result["device_id"], str(DEVICE_ID))
        self.assertEqual(result["site_id"], str(SITE_ID))
        self.assertEqual(control.config, EXTENDED_CONTROL_CONFIG)
        self.assertTrue(control.is_enabled)
        run()  # A read-only enrollment call must not downgrade an existing profile.
        self.assertEqual(control.config, EXTENDED_CONTROL_CONFIG)
        run(enable_control=False)
        self.assertFalse(control.is_enabled)
        self.assertEqual(control.config, EXTENDED_CONTROL_CONFIG)
        run(enable_control=True)
        self.assertEqual(control.config, CONTROL_CONFIG)
        session.add.assert_not_called()
        session.delete.assert_not_called()
        control.config = {**CONTROL_CONFIG, "frequency_limits": {"min_hz": 20, "max_hz": 40}}
        before = copy.deepcopy(control.config)
        with self.assertRaises(RuntimeError):
            run(enable_control=True, extended_test=True)
        self.assertEqual(control.config, before)
        with self.assertRaises(ValueError):
            prepare(extended_test=True)

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

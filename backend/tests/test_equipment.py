import json
import hashlib
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from pydantic import ValidationError

from app.schemas.command import CommandEnvelope
from app.schemas.equipment import ConfigurationCreate, EquipmentManifest, EquipmentReport, EquipmentTarget
from app.services.equipment import configuration_state, equipment_rejection
from app.services.equipment_profiles import canonical_json, configuration_hash, get_profile, profiles
from app.tools.equipment_manifest import header
from app.demo.state import DemoState


def manifest_fixture():
    return (Path(__file__).parent / "fixtures/equipment_manifest.json").read_text(encoding="ascii")


def report_for(manifest, digest):
    fields = {key: value for key, value in manifest.items() if key in EquipmentReport.model_fields}
    return {**fields, "configuration_hash": digest, "command_protocol": 3, "compatible": True}


class EquipmentTests(unittest.TestCase):
    def test_existing_simulator_v2_fingerprint_is_unchanged(self):
        raw = dict(schema_version=2, control_sequence=7,
            command_id="11111111-1111-4111-8111-111111111111", request_id="22222222-2222-4222-8222-222222222222",
            issued_at="2026-10-02T00:00:00Z", expires_at="2026-10-02T00:00:30Z", ttl_seconds=30,
            command_type="vfd.stop", payload={})
        historical = hashlib.sha256(json.dumps(raw, sort_keys=True).encode()).hexdigest()
        with tempfile.TemporaryDirectory() as folder:
            state = DemoState(Path(folder) / "ledger.sqlite3")
            try:
                now = datetime(2026, 10, 2, 0, 0, 5, tzinfo=timezone.utc)
                state.command("pump", raw, now=now)
                self.assertEqual(state.db.execute("SELECT fingerprint FROM commands").fetchone()[0], historical)
                self.assertFalse(state.command("pump", raw, now=now))
            finally:
                state.close()

    def setUp(self):
        self.text = manifest_fixture()
        self.manifest = EquipmentManifest.model_validate_json(self.text)
        self.now = datetime.now(timezone.utc)
        self.device = SimpleNamespace(id=uuid.uuid4(), last_observed_session_id=uuid.uuid4())
        self.row = SimpleNamespace(canonical_manifest=self.text, configuration_hash=configuration_hash(self.text),
            created_at=self.now, actor_user_id=uuid.uuid4())
        self.report = report_for(self.manifest.model_dump(mode="json"), self.row.configuration_hash)
        self.snapshot = SimpleNamespace(diagnostics={"equipment": self.report}, last_received_at=self.now,
            last_reported_at=self.now, last_session_id=self.device.last_observed_session_id)

    def test_catalog_does_not_advertise_unimplemented_models(self):
        catalog = profiles()
        self.assertEqual({item.series for item in catalog}, {"SU100", "SU300", "SU600", "SU700", "SU800", "SU900", "SU1000"})
        self.assertEqual([item.series for item in catalog if item.driver_id], ["SU600"])
        self.assertTrue(all(item.manual_sha256 and item.manual_pages for item in catalog))
        self.assertIsNone(get_profile("other-brand.su600", 1))
        self.assertIsNone(get_profile("suswe.su600.modbus", 2))
        catalog[0].notes.clear()
        self.assertTrue(profiles()[0].notes)  # Callers cannot mutate the cached catalog.

    def test_shared_firmware_fixture_and_safe_header(self):
        self.assertEqual(canonical_json(self.manifest.model_dump(mode="json")), self.text)
        profile = get_profile(self.manifest.profile_id, self.manifest.profile_version)
        self.assertEqual(profile.profile_hash, self.manifest.profile_hash)
        line = next(line for line in header(self.text).splitlines() if line.startswith("#define "))
        self.assertEqual(json.loads(line.split(" ", 2)[2]), self.text)
        for bad in (self.text + "\n", self.text.replace("suswe.su600.modbus", "suswe.su100.modbus")):
            with self.assertRaises(ValueError):
                header(bad)

    def test_confirmation_requires_every_identity_and_current_boot(self):
        self.assertEqual(configuration_state(self.device, self.row, self.snapshot, self.now), "verified")
        for key, value in {"module_id": str(uuid.uuid4()), "binding_id": str(uuid.uuid4()), "revision": 4,
                           "binding_generation": 3, "configuration_hash": "b" * 64, "profile_hash": "b" * 64,
                           "profile_id": "suswe.su100.modbus", "profile_version": 2, "driver_version": 2}.items():
            with self.subTest(key=key):
                self.snapshot.diagnostics = {"equipment": {**self.report, key: value}}
                self.assertEqual(configuration_state(self.device, self.row, self.snapshot, self.now), "mismatch")
        self.snapshot.diagnostics = {"equipment": {**self.report, "compatible": False}}
        self.assertEqual(configuration_state(self.device, self.row, self.snapshot, self.now), "incompatible")
        self.snapshot.diagnostics = {"equipment": self.report}
        self.assertEqual(configuration_state(self.device, self.row, self.snapshot, self.now + timedelta(minutes=5)), "stale")
        self.snapshot.last_session_id = uuid.uuid4()
        self.assertEqual(configuration_state(self.device, self.row, self.snapshot, self.now), "stale")
        self.assertEqual(configuration_state(self.device, self.row, None, self.now), "awaiting")
        self.assertEqual(configuration_state(self.device, None, self.snapshot, self.now), "mismatch")

    def test_old_command_and_legacy_envelope_cannot_cross_binding(self):
        target = EquipmentTarget.model_validate({key: self.report[key] for key in EquipmentTarget.model_fields}).model_dump(mode="json")
        command = SimpleNamespace(command_type="vfd.start", equipment_target=target)
        with patch("app.services.equipment.desired_configuration", return_value=self.row), patch("app.services.equipment.TelemetryRepository") as telemetry:
            telemetry.return_value.get_state.return_value = self.snapshot
            self.assertIsNone(equipment_rejection(None, self.device, command, self.now))
            command.equipment_target = None
            self.assertEqual(equipment_rejection(None, self.device, command, self.now), "equipment_binding_changed")
            command.equipment_target = {**target, "revision": 2}
            self.assertEqual(equipment_rejection(None, self.device, command, self.now), "equipment_binding_changed")
            command.equipment_target = target
            self.assertEqual(equipment_rejection(None, self.device, command, self.now + timedelta(minutes=5)), "equipment_configuration_unconfirmed")
            command.command_type = "vfd.stop"
            self.assertIsNone(equipment_rejection(None, self.device, command, self.now + timedelta(minutes=5)))

    def test_protocol_requires_explicit_target_and_strict_revision(self):
        fields = dict(command_id=uuid.uuid4(), request_id=uuid.uuid4(), issued_at=self.now,
            expires_at=self.now + timedelta(seconds=30), ttl_seconds=30, command_type="vfd.start")
        target = {key: self.report[key] for key in EquipmentTarget.model_fields}
        self.assertEqual(CommandEnvelope(**fields, schema_version=3, control_sequence=1, equipment_target=target).schema_version, 3)
        for version, control, equipment in [(3, 1, None), (2, 1, target), (1, 1, None), (3, None, target)]:
            with self.assertRaises(ValidationError):
                CommandEnvelope(**fields, schema_version=version, control_sequence=control, equipment_target=equipment)
        for revision in (0, True, "3", 2**31):
            with self.assertRaises(ValidationError):
                EquipmentTarget(**{**target, "revision": revision})

    def test_invalid_frequency_limits_and_unknown_fields(self):
        fields = dict(expected_revision=0, module_id=self.manifest.module_id, profile_id=self.manifest.profile_id,
            profile_version=1, bus=self.manifest.bus, frequency_limits={"min_hz": 20, "max_hz": 45})
        for limits in ({"min_hz": 45, "max_hz": 20}, {"min_hz": True, "max_hz": 50},
                       {"min_hz": 20, "max_hz": float("nan")}, {"min_hz": 20, "max_hz": 45.001}):
            with self.assertRaises(ValidationError):
                ConfigurationCreate(**{**fields, "frequency_limits": limits})
        with self.assertRaises(ValidationError):
            ConfigurationCreate(**fields, force=True)

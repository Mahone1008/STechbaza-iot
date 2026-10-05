"""Життєвий цикл на PostgreSQL; брокерний ACK перевіряється окремим gateway test."""

import json
import os
import unittest
import uuid
from datetime import timedelta
from unittest.mock import patch

from sqlalchemy import delete, select

import test_onboarding_postgres as onboarding
from auth_http_helpers import request
from test_equipment import report_for
from app.db import SessionLocal
from app.models import (
    ControllerCredential,
    Device,
    DeviceCapability,
    FactoryController,
    User,
    OrganizationMembership,
    Site,
)
from app.models.equipment import EquipmentConfiguration, EquipmentModule
from app.models.telemetry import DeviceState
from app.security.passwords import hash_password
from app.security.tokens import utc_now
from app.services.controller_broker import BrokerUnavailable
from app.services.telemetry import TelemetryService
from app.schemas.telemetry import TelemetryEnvelope
from app.operations.recovery import harden_restored_database


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class ControllerLifecycleTests(unittest.TestCase):
    call = onboarding.OnboardingPostgresTests.call
    factory = onboarding.OnboardingPostgresTests.factory
    claim_body = onboarding.OnboardingPostgresTests.claim_body

    def setUp(self):
        self.lifecycle_devices = []
        onboarding.OnboardingPostgresTests.setUp(self)
        self.broker = self.enterContext(
            patch("app.services.controller_credentials.ControllerBroker")
        )
        self.enterContext(patch.dict(os.environ, {"CONTROLLER_MQTT_PUBLIC_HOST": "192.168.1.10"}))
        self.password = "Stage2-test-password-2026"
        with SessionLocal.begin() as session:
            session.get(User, self.contexts["owner"].user.id).password_hash = hash_password(
                self.password
            )
            session.get(User, self.contexts["viewer"].user.id).password_hash = hash_password(
                self.password
            )
        self.kit = self.factory()
        self.controller_id = self.kit["controller"]["id"]
        self.connect = f"/api/v1/connect/{self.controller_id}"
        self.connection = self.call(
            self.connect + "/claim", method="POST", body=self.claim_body(self.kit)
        )
        self.device_id = uuid.UUID(self.connection["device_id"])
        self.lifecycle_devices.append(self.device_id)
        with SessionLocal.begin() as session:
            site = session.get(Site, uuid.UUID(self.connection["site_id"]))
            session.add(
                OrganizationMembership(
                    organization_id=site.organization_id,
                    user_id=self.contexts["viewer"].user.id,
                    role="viewer",
                    is_active=True,
                )
            )
        self.equipment = f"/api/v1/devices/{self.device_id}/equipment"

    def cleanup_data(self):
        with SessionLocal.begin() as session:
            session.execute(
                delete(ControllerCredential).where(
                    ControllerCredential.controller_id.in_(self.controllers)
                )
            )
            session.execute(
                delete(EquipmentConfiguration).where(
                    EquipmentConfiguration.device_id.in_(self.lifecycle_devices)
                )
            )
            session.execute(
                delete(EquipmentModule).where(EquipmentModule.device_id.in_(self.lifecycle_devices))
            )
        onboarding.OnboardingPostgresTests.cleanup_data(self)

    def bootstrap(self, key=None, expected=200):
        code, result, headers = request(
            "POST",
            f"/api/v1/bootstrap/{self.controller_id}/configuration",
            body={"firmware_version": "0.7.0"},
            headers={"authorization": f"Bearer {key or self.kit['bootstrap_key']}"},
            ip=self.ip,
        )
        self.assertEqual(code, expected, result)
        if expected == 200:
            self.assertEqual(headers.get("cache-control"), "no-store")
        return result

    def configure(self):
        module = self.call(
            self.connect + "/equipment",
            method="PUT",
            body={
                "profile_id": "suswe.su600.modbus",
                "profile_version": 1,
                "model": "SU600A-5RG1-B",
                "nameplate_confirmed": True,
            },
        )
        self.config_body = dict(
            expected_revision=0,
            module_id=module["id"],
            profile_id="suswe.su600.modbus",
            profile_version=1,
            bus=dict(transport="modbus_rtu", address=1, baud=9600, parity="none", stop_bits=1),
            frequency_limits=dict(min_hz=0, max_hz=50),
        )
        return self.call(
            self.equipment + "/configurations", method="POST", body=self.config_body, expected=201
        )

    def fresh(self, configuration=None, *, running=False, age=0):
        now = utc_now() - timedelta(seconds=age)
        with SessionLocal.begin() as session:
            device = session.get(Device, self.device_id)
            device.last_seen_at, device.last_observed_session_id = now, self.boot
            state = session.get(DeviceState, self.device_id) or DeviceState(
                device_id=self.device_id
            )
            state.last_received_at = state.last_reported_at = now
            state.last_session_id = self.boot
            state.state = dict(pump_running=running, control_armed=False)
            state.values = {"vfd.frequency_hz": 35 if running else 0}
            state.diagnostics = (
                {
                    "equipment": report_for(
                        configuration["manifest"], configuration["configuration_hash"]
                    )
                }
                if configuration
                else {}
            )
            session.add(state)

    def operation(self, action, *, expected=200, **changes):
        status = self.call(self.connect + "/status")
        return self.call(
            self.connect + f"/access/{action}",
            method="POST",
            expected=expected,
            body=dict(
                password=self.password,
                expected_generation=1,
                expected_credential_revision=status["credential_revision"],
                reason="Lifecycle test",
                stopped_and_isolated=True,
                **changes,
            ),
        )

    def test_enrollment_retries_same_secret_and_never_accepts_browser_jwt_as_device_key(self):
        self.bootstrap(
            self.tokens["owner"], expected=422
        )  # Header bounds reject oversized JWT before parsing.
        self.bootstrap("wrong" * 8, expected=401)
        first = self.bootstrap()
        self.assertEqual(first["state"], "configured")
        self.assertIsNone(first["manifest"])
        self.assertEqual(first, self.bootstrap())
        with SessionLocal() as session:
            credential = session.get(ControllerCredential, self.device_id)
            self.assertNotIn(first["mqtt_password"], credential.secret)
            self.assertEqual(credential.revision, credential.applied_revision)
        self.assertEqual(self.broker.return_value.__enter__.return_value.apply.call_count, 1)

    def test_replacement_archives_module_blocks_old_control_and_creates_new_binding(self):
        config = self.configure()
        self.assertEqual(json.loads(self.bootstrap()["manifest"]), config["manifest"])
        self.fresh(config)
        passport = self.call(self.equipment)
        old = passport["modules"][0]
        replacement = {
            key: value for key, value in old.items() if key not in ("id", "device_id", "retired_at")
        }
        replacement["serial_number"] = "NEW-DRIVE"
        payload = dict(
            expected_module_id=old["id"],
            expected_revision=1,
            replacement=replacement,
            stopped_and_isolated=True,
            reason="Physical drive replacement",
        )
        for values in ({"age": 300}, {"running": True}):
            self.fresh(config, **values)
            self.call(self.equipment + "/replacement", method="POST", body=payload, expected=409)
        self.fresh(config)
        new = self.call(self.equipment + "/replacement", method="POST", body=payload, expected=201)
        self.call(self.equipment + "/replacement", method="POST", body=payload, expected=409)
        self.assertNotEqual(new["id"], old["id"])
        self.assertIsNone(self.bootstrap()["manifest"])
        passport = self.call(self.equipment)
        self.assertEqual(passport["configuration_state"], "incompatible")
        self.assertTrue(
            next(item for item in passport["modules"] if item["id"] == old["id"])["retired_at"]
        )
        updated = self.call(
            self.equipment + "/configurations",
            method="POST",
            expected=201,
            body={**self.config_body, "module_id": new["id"], "expected_revision": 1},
        )
        self.assertNotEqual(updated["manifest"]["binding_id"], config["manifest"]["binding_id"])
        self.assertEqual(updated["manifest"]["binding_generation"], 2)
        self.fresh(updated)
        self.call(
            self.equipment + "/commission",
            method="POST",
            body=dict(expected_revision=1, installation_checked=True),
            expected=409,
        )
        self.call(
            self.equipment + "/commission",
            method="POST",
            body=dict(expected_revision=2, installation_checked=True),
        )
        with SessionLocal() as session:
            self.assertEqual(session.get(Device, self.device_id).lifecycle_status, "active")

    def test_restore_revokes_controller_key_once_before_broker_reconciliation(self):
        self.bootstrap()
        with SessionLocal() as session:
            credential = session.get(ControllerCredential, self.device_id)
            applied = credential.applied_revision
            counts = harden_restored_database(session)
            self.assertEqual(counts["revoked_controller_keys"], 1)
            self.assertTrue(credential.revoked)
            self.assertEqual(credential.revision, applied + 1)
            controller = session.get(FactoryController, uuid.UUID(self.controller_id))
            self.assertTrue(controller.access_revoked)
            self.assertEqual(controller.credential_revision, credential.revision)
            self.assertEqual(harden_restored_database(session)["revoked_controller_keys"], 0)
            # Roll back this isolated restore probe, including unrelated auth sessions.
            session.rollback()

    def test_rotation_and_release_wait_for_broker_and_keep_old_history_private(self):
        first = self.bootstrap()
        self.fresh()
        self.operation("rotate")
        second = self.bootstrap()
        self.assertNotEqual(first["mqtt_password"], second["mqtt_password"])
        self.broker.return_value.__enter__.return_value.apply.side_effect = BrokerUnavailable(
            "Шлюз недоступний"
        )
        self.operation("release", expected=503)
        with SessionLocal() as session:
            self.assertEqual(
                session.get(FactoryController, uuid.UUID(self.controller_id)).status, "releasing"
            )
            self.assertEqual(session.get(Device, self.device_id).lifecycle_status, "retired")
        self.assertEqual(self.bootstrap()["state"], "revoked")
        self.call(
            self.connect + "/claim",
            method="POST",
            who="other",
            body=self.claim_body(self.kit),
            expected=404,
        )
        self.broker.return_value.__enter__.return_value.apply.side_effect = None
        handover = self.operation("release")
        self.assertNotIn("bootstrap_key", handover)
        self.call(
            self.connect + "/claim",
            method="POST",
            who="other",
            body=self.claim_body(self.kit),
            expected=404,
        )
        claimed = self.call(
            self.connect + "/claim",
            method="POST",
            who="other",
            body=self.claim_body({"activation_code": handover["activation_code"]}),
        )
        new_id = uuid.UUID(claimed["device_id"])
        self.lifecycle_devices.append(new_id)
        self.assertNotEqual(self.device_id, new_id)
        self.call(self.equipment, who="other", expected=404)
        with SessionLocal() as session:
            user = session.get(User, self.contexts["owner"].user.id)
            user.platform_role = "user"
            session.commit()
        self.call(f"/api/v1/devices/{new_id}/equipment", expected=404)
        with SessionLocal() as session:
            self.assertFalse(
                any(
                    session.scalars(
                        select(DeviceCapability.is_enabled).where(
                            DeviceCapability.device_id == self.device_id
                        )
                    )
                )
            )
            self.assertEqual(session.get(ControllerCredential, self.device_id).revoked, True)

    def test_unauthorized_replacement_and_device_key_revocation(self):
        self.bootstrap()
        self.fresh()
        self.call(
            self.connect + "/access/release",
            method="POST",
            who="viewer",
            body=dict(
                password=self.password,
                expected_generation=1,
                expected_credential_revision=1,
                reason="Forbidden transfer",
                stopped_and_isolated=True,
            ),
            expected=403,
        )
        self.call(
            f"/api/v1/factory/controllers/{self.controller_id}/quarantine",
            method="POST",
            body={"reason": "Compromised controller identity"},
        )
        self.bootstrap(expected=401)
        with SessionLocal() as session:
            self.assertTrue(session.get(ControllerCredential, self.device_id).revoked)

    def test_factory_return_rekeys_bootstrap_and_archives_previous_device(self):
        self.bootstrap()
        self.call(
            f"/api/v1/factory/controllers/{self.controller_id}/reset",
            method="POST",
            expected=409,
            body=dict(
                expected_generation=1,
                reason="Returned controller",
                test_reference="factory-retest",
                factory_test_passed=True,
            ),
        )
        self.call(
            f"/api/v1/factory/controllers/{self.controller_id}/quarantine",
            method="POST",
            body={"reason": "Returned controller"},
        )
        new = self.call(
            f"/api/v1/factory/controllers/{self.controller_id}/reset",
            method="POST",
            body=dict(
                expected_generation=1,
                reason="Returned controller",
                test_reference="factory-retest",
                factory_test_passed=True,
            ),
        )
        self.bootstrap(expected=401)
        self.assertEqual(self.bootstrap(new["bootstrap_key"])["state"], "waiting")
        self.assertNotEqual(new["bootstrap_key"], self.kit["bootstrap_key"])
        with SessionLocal() as session:
            self.assertEqual(session.get(Device, self.device_id).lifecycle_status, "retired")

    def test_real_ingestion_confirms_manifest_and_offline_revoke_can_recover_read_access(self):
        configuration = self.configure()
        enrollment = self.bootstrap()
        envelope = TelemetryEnvelope(
            schema_version=1,
            message_id=uuid.uuid4(),
            session_id=self.boot,
            sequence=1,
            sent_at=utc_now(),
            values={
                "vfd.frequency_hz": 0,
                "vfd.set_frequency_hz": 0,
                "vfd.current_a": 0,
                "vfd.voltage_v": 230,
            },
            state={
                "pump_running": False,
                "control_armed": False,
                "vfd_link": True,
                "vfd_configuration_valid": True,
                "vfd_fault_code": 0,
            },
            diagnostics={
                "version": 1,
                "firmware_version": "0.7.0",
                "uptime_ms": 10000,
                "reset_reason": "power_on",
                "connection": {"transport": "wifi"},
                "equipment": report_for(
                    configuration["manifest"], configuration["configuration_hash"]
                ),
            },
        )
        with SessionLocal() as session:
            self.assertTrue(
                TelemetryService(session)
                .ingest(device_uid=enrollment["device_uid"], payload=envelope)
                .state_updated
            )
        self.assertEqual(self.call(self.equipment)["configuration_state"], "verified")
        self.fresh(configuration, age=300)
        self.operation("revoke")
        self.operation("release", expected=409)
        self.operation("rotate")
        refreshed = envelope.model_copy(
            update={"message_id": uuid.uuid4(), "sequence": 2, "sent_at": utc_now()}
        )
        with SessionLocal() as session:
            self.assertTrue(
                TelemetryService(session)
                .ingest(device_uid=enrollment["device_uid"], payload=refreshed)
                .state_updated
            )
        self.call(
            self.equipment + "/commission",
            method="POST",
            body=dict(expected_revision=1, installation_checked=True),
        )

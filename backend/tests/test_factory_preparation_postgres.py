"""Real transactions exercise prepared claims, installer scopes and control grants."""
import os
import unittest
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch

from sqlalchemy import select

from onboarding_helpers import OnboardingFixtures
from auth_http_helpers import request
from test_equipment import report_for
from app.db import SessionLocal
from app.models import Capability, Device, DeviceCapability, User, AuthSession, OrganizationMembership, Site, FactoryController
from app.models.telemetry import DeviceState
from app.security.tokens import utc_now
from app.services.equipment import command_target, EquipmentConflict


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class FactoryPreparationTests(OnboardingFixtures, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(patch("app.services.controller_credentials.ControllerBroker"))
        self.enterContext(patch.dict(os.environ, {"CONTROLLER_MQTT_PUBLIC_HOST": "example.test"}))
        self.setup_equipment = dict(profile_id="suswe.su600.modbus", profile_version=1,
            model="SU600A-5RG1-B", serial_number="VFD-TEST", motor={"rated_frequency_hz": 50},
            frequency_limits={"min_hz": 10, "max_hz": 50})

    def create_claim(self, *, prepared=True):
        kit = self.factory(network_transport="lte", hardware_model="KERUMO V4",
            equipment=self.setup_equipment if prepared else None)
        controller_id = kit["controller"]["id"]
        connection = self.call(f"/api/v1/connect/{controller_id}/claim", method="POST", who="other", body=self.claim_body(kit))
        return kit, connection

    def contact(self, kit, capability="full"):
        code, result, _ = request("POST", f"/api/v1/bootstrap/{kit['controller']['id']}/configuration",
            body={"firmware_version": "0.12.0", "network_transport": "lte", "control_capability": capability},
            headers={"authorization": f"Bearer {kit['bootstrap_key']}"}, ip=self.ip)
        self.assertEqual(code, 200, result)
        return result

    def fresh(self, connection, configuration, *, grant=None, age=0, armed=False):
        now = utc_now() - timedelta(seconds=age)
        with SessionLocal.begin() as session:
            device = session.get(Device, uuid.UUID(connection["device_id"]))
            device.last_observed_session_id, device.last_seen_at = self.boot, now
            state = session.get(DeviceState, device.id) or DeviceState(device_id=device.id)
            state.last_session_id, state.last_received_at, state.last_reported_at = self.boot, now, now
            state.state = {"pump_running": False, "control_armed": armed, "vfd_link": True, "vfd_fault_code": 0}
            state.values = {"vfd.frequency_hz": 0}
            state.diagnostics = {"equipment": report_for(configuration["manifest"], configuration["configuration_hash"]),
                "control_grant": grant, "vfd_settings": {"version": 1, "driver_id": "su600", "ready": True,
                    "command_sequence": 0, "run_source": 0, "frequency_source": 0,
                    "parameters": {"F0.10": 100, "F0.11": 100}}}
            session.add(state)

    def test_prepared_claim_is_atomic_uid_specific_and_never_enables_control(self):
        kit, connection = self.create_claim()
        self.assertFalse(connection["can_install"])
        self.assertEqual(connection["readiness"]["state"], "awaiting_controller")
        passport = self.call(f"/api/v1/devices/{connection['device_id']}/equipment", who="other")
        self.assertEqual(passport["modules"][0]["serial_number"], "VFD-TEST")
        self.assertEqual(passport["desired"]["manifest"]["device_uid"], passport["controller_uid"])
        with SessionLocal() as session:
            enabled = session.scalars(select(DeviceCapability).join(Capability).where(
                DeviceCapability.device_id == uuid.UUID(connection["device_id"]), DeviceCapability.is_enabled,
                Capability.code.in_(("vfd.control", "vfd.program", "vfd.schedule")))).all()
            self.assertEqual(enabled, [])
            self.assertEqual(session.get(Device, uuid.UUID(connection["device_id"])).lifecycle_status, "provisioning")
        grant = self.contact(kit)
        self.assertFalse(grant["commissioned"])
        self.assertEqual(grant["control_mode"], "read_only")

    def test_template_requires_tested_model_limits_and_compare_and_swap(self):
        kit = self.factory()
        path = f"/api/v1/factory/controllers/{kit['controller']['id']}/equipment"
        body = dict(expected_generation=1, expected_preparation_revision=0, equipment=self.setup_equipment)
        self.call(path, method="PATCH", body={**body, "equipment": {**self.setup_equipment, "model": "Made-up-model"}}, expected=422)
        self.call(path, method="PATCH", body={**body, "equipment": {**self.setup_equipment, "frequency_limits": {"min_hz": 10, "max_hz": 51}}}, expected=422)
        self.call(path, method="PATCH", body=body, who="other", expected=403)
        prepared = self.call(path, method="PATCH", body=body)
        self.assertEqual(prepared["preparation_revision"], 1)
        self.call(path, method="PATCH", body=body, expected=409)
        connection = self.call(f"/api/v1/connect/{kit['controller']['id']}/claim", method="POST", body=self.claim_body(kit))
        self.call(path, method="PATCH", body={**body, "expected_preparation_revision": 1}, expected=409)
        passport = self.call(f"/api/v1/devices/{connection['device_id']}/equipment")
        self.assertEqual(passport["desired"]["manifest"]["revision"], 1)

    def test_customer_cannot_change_equipment_and_service_admin_requires_exact_scope(self):
        kit, connection = self.create_claim()
        root = f"/api/v1/devices/{connection['device_id']}/equipment"
        passport = self.call(root, who="other")
        selection = dict(profile_id="suswe.su600.modbus", profile_version=1, model="SU600A-5RG1-B", nameplate_confirmed=True)
        self.call(f"/api/v1/connect/{kit['controller']['id']}/equipment", method="PUT", who="other", body=selection, expected=403)
        self.call(root + "/commission", method="POST", who="other", body={"expected_revision": 1, "installation_checked": True}, expected=403)
        module = passport["modules"][0]
        config = dict(expected_revision=1, module_id=module["id"], profile_id="suswe.su600.modbus", profile_version=1,
            bus=passport["desired"]["manifest"]["bus"], frequency_limits=self.setup_equipment["frequency_limits"])
        self.call(root + "/configurations", method="POST", who="other", body=config, expected=403)
        with SessionLocal.begin() as session:
            session.get(User, self.contexts["operator"].user.id).platform_role = "service_admin"
            session.get(AuthSession, self.contexts["operator"].auth_session.id).mfa_verified_at = utc_now()
        self.call(root, who="operator", expected=404)
        with SessionLocal.begin() as session:
            site = session.get(Site, uuid.UUID(connection["site_id"]))
            session.add(OrganizationMembership(organization_id=site.organization_id,
                user_id=self.contexts["operator"].user.id, role="service", site_ids=[str(site.id)], is_active=True))
        self.assertTrue(self.call(root, who="operator")["can_install"])

    def test_full_grant_requires_commission_and_board_ack_and_revokes_on_firmware_downgrade(self):
        kit, connection = self.create_claim()
        path = f"/api/v1/devices/{connection['device_id']}/equipment"
        config = self.call(path)["desired"]
        self.contact(kit, "read_only")
        self.fresh(connection, config)
        request_body = {"expected_revision": 1, "installation_checked": True, "control_mode": "extended_test"}
        self.call(path + "/commission", method="POST", body=request_body, expected=409)
        self.contact(kit)
        commissioned = self.call(path + "/commission", method="POST", body=request_body)
        self.assertEqual(commissioned["readiness"]["state"], "needs_commissioning")
        grant = self.contact(kit)
        self.assertTrue(grant["commissioned"])
        self.assertEqual(grant["control_mode"], "extended_test")
        self.fresh(connection, config, grant={"revision": grant["control_revision"] - 1, "mode": "extended_test", "accepted": True})
        self.assertNotEqual(self.call(path)["readiness"]["state"], "ready")
        self.fresh(connection, config, grant={"revision": grant["control_revision"], "mode": "extended_test", "accepted": True})
        self.assertEqual(self.call(path)["readiness"]["state"], "ready")
        # A stale bus sample never changes the policy tuple at the same revision.
        self.fresh(connection, config, age=300)
        repeated = self.contact(kit)
        self.assertEqual((repeated["commissioned"], repeated["control_mode"], repeated["control_revision"]),
            (True, "extended_test", grant["control_revision"]))
        self.assertEqual(self.call(path)["readiness"]["state"], "offline")
        code, _, _ = request("POST", f"/api/v1/bootstrap/{kit['controller']['id']}/contact",
            body={"firmware_version": "0.12.0", "network_transport": "lte", "control_capability": "read_only"},
            headers={"authorization": f"Bearer {kit['bootstrap_key']}"}, ip=self.ip)
        self.assertEqual(code, 200)
        denied = self.contact(kit, "read_only")
        self.assertFalse(denied["commissioned"])
        self.assertGreater(denied["control_revision"], grant["control_revision"])
        self.assertEqual(self.contact(kit)["control_revision"], denied["control_revision"])
        self.assertFalse(self.contact(kit)["commissioned"])

    def test_stop_can_use_same_binding_before_grant_ack_but_start_cannot(self):
        kit, connection = self.create_claim()
        path = f"/api/v1/devices/{connection['device_id']}/equipment"
        config = self.call(path)["desired"]
        self.contact(kit)
        self.fresh(connection, config)
        with SessionLocal() as session:
            device = session.get(Device, uuid.UUID(connection["device_id"]))
            with self.assertRaises(EquipmentConflict):
                command_target(session, device, utc_now())
            self.assertIsNotNone(command_target(session, device, utc_now(), stop=True))

    def test_installer_invitation_is_qualified_temporary_and_only_for_claimed_object(self):
        _, connection = self.create_claim()
        controller_id = connection["controller_id"]
        path = f"/api/v1/connect/{controller_id}/installer-invitations"
        headers = {"authorization": f"Bearer {self.tokens['other']}", "origin": "http://127.0.0.1:3000", "x-techbaza-csrf": "1"}
        def invite(email, expected, **changes):
            code, body, _ = request("POST", path, body={"email": email, **changes}, headers=headers, ip=self.ip)
            self.assertEqual(code, expected, body)
            return body
        invite(self.contexts["operator"].user.email, 422)
        invite("unknown-installer@example.test", 422)
        with SessionLocal.begin() as session:
            installer = session.get(User, self.contexts["operator"].user.id)
            installer.platform_role = "service_admin"
            installer.email_verified_at = utc_now()
        with patch("app.services.invitations.send_account_mail") as mail:
            body = invite(self.contexts["operator"].user.email, 201)
        self.assertEqual(body["role"], "service")
        self.assertEqual(body["site_ids"], [connection["site_id"]])
        self.assertIsNotNone(body["access_expires_at"])
        self.assertIn("Доступ лише до об’єктів", mail.call_args.args[2])
        self.assertIn("Доступ діє до", mail.call_args.args[2])
        self.assertIn("http://127.0.0.1:3001/invite#token=", mail.call_args.args[2])
        invite(self.contexts["operator"].user.email, 422, expires_in_days=31)

    def test_concurrent_preparation_edits_have_one_revision_winner(self):
        kit = self.factory()
        path = f"/api/v1/factory/controllers/{kit['controller']['id']}/equipment"
        barrier = threading.Barrier(2)
        def submit(minimum):
            barrier.wait()
            return request("PATCH", path, body={"expected_generation": 1, "expected_preparation_revision": 0,
                "equipment": {**self.setup_equipment, "frequency_limits": {"min_hz": minimum, "max_hz": 50}}},
                headers={"authorization": f"Bearer {self.tokens['owner']}"}, ip=self.ip)[0]
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(submit, minimum) for minimum in (10, 20)]
            self.assertEqual(sorted(future.result(timeout=15) for future in futures), [200, 409])
        rows = self.call("/api/v1/factory/controllers")
        row = next(item for item in rows if item["id"] == kit["controller"]["id"])
        self.assertEqual(row["preparation_revision"], 1)

    def test_archived_factory_generation_cannot_be_recommissioned_or_reconfigured(self):
        kit, connection = self.create_claim()
        path = f"/api/v1/devices/{connection['device_id']}/equipment"
        passport = self.call(path)
        self.contact(kit)
        self.fresh(connection, passport["desired"])
        with SessionLocal.begin() as session:
            session.get(Device, uuid.UUID(connection["device_id"])).lifecycle_status = "retired"
            factory = session.get(FactoryController, uuid.UUID(kit["controller"]["id"]))
            factory.device_id, factory.status = None, "ready"
        self.call(path + "/commission", method="POST", body={"expected_revision": 1, "installation_checked": True}, expected=409)
        manifest = passport["desired"]["manifest"]
        self.call(path + "/configurations", method="POST", expected=409, body={"expected_revision": 1,
            "module_id": manifest["module_id"], "profile_id": manifest["profile_id"], "profile_version": manifest["profile_version"],
            "bus": manifest["bus"], "frequency_limits": manifest["frequency_limits"]})
        with SessionLocal() as session:
            device = session.get(Device, uuid.UUID(connection["device_id"]))
            self.assertEqual(device.lifecycle_status, "retired")
            with self.assertRaises(EquipmentConflict):
                command_target(session, device, utc_now(), stop=True)

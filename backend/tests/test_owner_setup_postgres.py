"""Первинна підготовка через справжні HTTP/PostgreSQL транзакції."""
import os
import unittest
import uuid
import threading
import importlib.util
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import select, text

from onboarding_helpers import OnboardingFixtures
import test_factory_preparation_postgres as factory_preparation_tests
from auth_http_helpers import request
from app.db import SessionLocal
from app.models import Capability, Device, DeviceCommand, FactoryController, OrganizationMembership, Site
from app.models.equipment import EquipmentConfiguration
from app.models.owner_setup import DeviceSetupDraft
from app.models.telemetry import DeviceState
from app.models.onboarding import FactoryAudit


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class OwnerSetupTests(OnboardingFixtures, unittest.TestCase):
    create_claim = factory_preparation_tests.FactoryPreparationTests.create_claim
    contact = factory_preparation_tests.FactoryPreparationTests.contact
    fresh = factory_preparation_tests.FactoryPreparationTests.fresh

    def setUp(self):
        with SessionLocal() as session:
            self.initial_capabilities = set(session.scalars(select(Capability.id)))
        super().setUp()
        self.enterContext(patch("app.services.controller_credentials.ControllerBroker"))
        self.enterContext(patch.dict(os.environ, {"CONTROLLER_MQTT_PUBLIC_HOST": "example.test"}))
        self.setup_equipment = dict(profile_id="suswe.su600.modbus", profile_version=1,
            model="SU600A-5RG1-B", serial_number="VFD-OWNER", motor={"rated_frequency_hz": 50,
                "rated_current_a": 3, "rated_voltage_v": 230, "rated_power_kw": 0.75},
            frequency_limits={"min_hz": 10, "max_hz": 50})

    def cleanup_data(self):
        with SessionLocal() as session:
            introduced = set(session.scalars(select(Capability.id))) - self.initial_capabilities
        self.created_caps.extend(introduced - set(self.created_caps))
        super().cleanup_data()

    def path(self, kit):
        return f"/api/v1/connect/{kit['controller']['id']}/setup"

    def setup_read(self, kit):
        return self.call(self.path(kit), who="other")

    def scope(self, state):
        return dict(expected_generation=state["generation"], expected_credential_revision=state["credential_revision"],
            expected_configuration_revision=state["configuration_revision"], expected_draft_revision=state["draft_revision"])

    def accept_body(self, state, mode="extended_test"):
        return {**self.scope(state), "expected_configuration_hash": state["configuration_hash"],
            "installation_checked": True, "control_mode": mode}

    def ready(self):
        kit, connection = self.create_claim()
        self.contact(kit)
        config = self.call(f"/api/v1/devices/{connection['device_id']}/equipment", who="other")["desired"]
        self.fresh(connection, config)
        return kit, connection, config

    def test_prepared_owner_accepts_without_staff_and_retry_never_reissues_grant(self):
        kit, connection, config = self.ready()
        state = self.setup_read(kit)
        self.assertTrue(state["can_accept_control"])
        self.assertFalse(state["needs_apply"])
        self.assertEqual(state["draft_revision"], 0)
        body = self.accept_body(state)
        response = self.call(self.path(kit) + "/accept", method="POST", who="other", body=body)
        self.assertFalse(response["initial_setup_open"])
        self.assertEqual(response["progress"], "connected")
        grant = self.contact(kit)
        self.assertTrue(grant["commissioned"])
        self.call(self.path(kit) + "/accept", method="POST", who="other", body=body)
        self.assertEqual(self.contact(kit)["control_revision"], grant["control_revision"])
        self.fresh(connection, config, grant={"revision": grant["control_revision"], "mode": "extended_test", "accepted": True})
        self.assertEqual(self.setup_read(kit)["progress"], "ready")
        with SessionLocal() as session:
            device = session.get(Device, uuid.UUID(connection["device_id"]))
            self.assertIsNotNone(device.initial_setup_completed_at)
            self.assertIsNone(session.scalar(select(DeviceCommand.id).where(DeviceCommand.device_id == device.id)))
        self.call(self.path(kit) + "/draft", method="PUT", who="other",
            body={**self.scope(response), "equipment": response["equipment"]}, expected=409)

    def test_draft_is_proposal_only_and_owner_apply_requires_exact_reviewed_revision(self):
        kit, connection = self.create_claim(prepared=False)
        state = self.setup_read(kit)
        draft = {**self.scope(state), "equipment": self.setup_equipment}
        saved = self.call(self.path(kit) + "/draft", method="PUT", who="other", body=draft)
        self.assertEqual(saved["draft_revision"], 1)
        self.assertEqual(saved["configuration_revision"], 0)
        self.assertTrue(saved["can_apply"])
        with SessionLocal() as session:
            self.assertIsNone(session.scalar(select(EquipmentConfiguration).where(
                EquipmentConfiguration.device_id == uuid.UUID(connection["device_id"]))))
        self.call(self.path(kit) + "/draft", method="PUT", who="other", body=draft, expected=409)
        self.call(self.path(kit) + "/apply", method="POST", who="other",
            body={**self.scope(state), "nameplate_checked": True}, expected=409)
        applied = self.call(self.path(kit) + "/apply", method="POST", who="other",
            body={**self.scope(saved), "nameplate_checked": True})
        self.assertEqual(applied["configuration_revision"], 1)
        self.assertFalse(applied["can_accept_control"])
        self.assertFalse(self.contact(kit)["commissioned"])
        config = self.call(f"/api/v1/devices/{connection['device_id']}/equipment", who="other")["desired"]
        self.fresh(connection, config)
        body = self.accept_body(self.setup_read(kit))
        self.call(self.path(kit) + "/accept", method="POST", who="other", body=body)
        grant = self.contact(kit)
        self.call(self.path(kit) + "/accept", method="POST", who="other", body=body)
        self.assertEqual(self.contact(kit)["control_revision"], grant["control_revision"])

    def test_unsupported_model_can_be_proposed_but_cannot_be_applied(self):
        kit, connection = self.create_claim(prepared=False)
        state = self.setup_read(kit)
        equipment = {**self.setup_equipment, "profile_id": "suswe.su300.modbus", "model": "SU300-UNKNOWN"}
        saved = self.call(self.path(kit) + "/draft", method="PUT", who="other",
            body={**self.scope(state), "equipment": equipment})
        self.assertFalse(saved["can_apply"])
        self.call(self.path(kit) + "/apply", method="POST", who="other",
            body={**self.scope(saved), "nameplate_checked": True}, expected=422)
        self.assertFalse(self.contact(kit)["commissioned"])

    def test_owner_role_is_exact_and_existing_staff_technical_routes_stay_closed(self):
        kit, connection, config = self.ready()
        with SessionLocal.begin() as session:
            site = session.get(Site, uuid.UUID(connection["site_id"]))
            member = OrganizationMembership(organization_id=site.organization_id,
                user_id=self.contexts["operator"].user.id, role="admin", is_active=True)
            session.add(member)
        for who in ("operator", "viewer", "owner"):
            self.call(self.path(kit), who=who, expected=404)
        self.call(f"/api/v1/devices/{connection['device_id']}/equipment/commission", method="POST", who="other",
            body={"expected_revision": 1, "installation_checked": True, "control_mode": "extended_test"}, expected=403)
        with SessionLocal.begin() as session:
            own = session.scalar(select(OrganizationMembership).where(OrganizationMembership.organization_id == site.organization_id,
                OrganizationMembership.user_id == self.contexts["other"].user.id))
            own.role = "admin"
        self.call(self.path(kit), who="other", expected=404)

    def test_each_physical_guard_and_complete_motor_nameplate_is_required(self):
        kit, connection, config = self.ready()
        device_id = uuid.UUID(connection["device_id"])
        for changes in ({"pump_running": True}, {"control_armed": True}, {"vfd_fault_code": 3}, {"vfd_link": False}):
            self.fresh(connection, config)
            with SessionLocal.begin() as session:
                state = session.get(DeviceState, device_id)
                state.state = {**state.state, **changes}
            self.call(self.path(kit) + "/accept", method="POST", who="other",
                body=self.accept_body(self.setup_read(kit)), expected=409)
        self.fresh(connection, config, age=300)
        self.assertFalse(self.setup_read(kit)["can_accept_control"])
        self.fresh(connection, config)
        with SessionLocal.begin() as session:
            state = session.get(DeviceState, device_id)
            state.diagnostics = {**state.diagnostics, "equipment": {**state.diagnostics["equipment"], "compatible": False}}
        setup = self.setup_read(kit)
        self.assertEqual(next(check for check in setup["checks"] if check["code"] == "local_confirmation")["status"], "pending")
        self.assertFalse(setup["can_accept_control"])
        self.fresh(connection, config)
        self.contact(kit, "read_only")
        setup = self.setup_read(kit)
        self.assertFalse(setup["can_accept_control"])
        self.assertTrue(setup["can_accept_read_only"])
        self.call(self.path(kit) + "/accept", method="POST", who="other", body=self.accept_body(setup), expected=409)
        self.call(self.path(kit) + "/accept", method="POST", who="other", body=self.accept_body(setup, "read_only"))

    def test_missing_motor_fields_block_control_but_allow_explicit_observation(self):
        self.setup_equipment["motor"] = {"rated_frequency_hz": 50}
        kit, connection, config = self.ready()
        setup = self.setup_read(kit)
        self.assertEqual(set(setup["missing_fields"]), {"motor.rated_current_a", "motor.rated_voltage_v", "motor.rated_power_kw"})
        self.assertFalse(setup["can_accept_control"])
        self.assertTrue(setup["can_accept_read_only"])
        self.call(self.path(kit) + "/accept", method="POST", who="other", body=self.accept_body(setup), expected=409)

    def test_staff_commission_and_later_reconfiguration_never_reopen_initial_setup(self):
        kit, connection, config = self.ready()
        self.call(f"/api/v1/devices/{connection['device_id']}/equipment/commission", method="POST",
            body={"expected_revision": 1, "installation_checked": True, "control_mode": "extended_test"})
        with SessionLocal.begin() as session:
            device = session.get(Device, uuid.UUID(connection["device_id"]))
            self.assertIsNotNone(device.initial_setup_completed_at)
            device.lifecycle_status = "provisioning"
            factory = session.get(FactoryController, uuid.UUID(kit["controller"]["id"]))
            factory.control_mode = factory.control_configuration_hash = None
            factory.credential_revision += 1
        setup = self.setup_read(kit)
        self.assertFalse(setup["initial_setup_open"])
        self.call(self.path(kit) + "/draft", method="PUT", who="other",
            body={**self.scope(setup), "equipment": self.setup_equipment}, expected=409)
        self.assertFalse(setup["can_accept_control"])

    def test_revoke_after_owner_accept_does_not_reissue_from_retry(self):
        kit, connection, config = self.ready()
        body = self.accept_body(self.setup_read(kit))
        self.call(self.path(kit) + "/accept", method="POST", who="other", body=body)
        with SessionLocal.begin() as session:
            factory = session.get(FactoryController, uuid.UUID(kit["controller"]["id"]))
            old_revision = factory.control_revision
            factory.access_revoked = True
            factory.control_mode = factory.control_configuration_hash = None
        self.call(self.path(kit) + "/accept", method="POST", who="other", body=body, expected=409)
        with SessionLocal() as session:
            factory = session.get(FactoryController, uuid.UUID(kit["controller"]["id"]))
            self.assertEqual(factory.control_revision, old_revision)
            self.assertIsNone(factory.control_mode)
            self.assertIsNotNone(session.get(DeviceSetupDraft, uuid.UUID(connection["device_id"])))

    def test_concurrent_proposals_have_one_revision_winner(self):
        kit, _ = self.create_claim(prepared=False)
        state = self.setup_read(kit)
        barrier = threading.Barrier(2)

        def save(serial):
            barrier.wait()
            code, body, _ = request("PUT", self.path(kit) + "/draft", body={**self.scope(state),
                "equipment": {**self.setup_equipment, "serial_number": serial}},
                headers={"authorization": f"Bearer {self.tokens['other']}"}, ip=self.ip)
            return code, body

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(save, ("FIRST", "SECOND")))
        self.assertEqual(sorted(code for code, _ in results), [200, 409])
        stored = self.setup_read(kit)
        self.assertEqual(stored["draft_revision"], 1)
        self.assertEqual(stored["equipment"]["serial_number"], next(body["equipment"]["serial_number"] for code, body in results if code == 200))

    def test_backfill_closes_used_generation_but_not_next_owner_generation(self):
        kit, connection, _ = self.ready()
        next_kit, next_connection = self.create_claim()
        self.call(f"/api/v1/devices/{connection['device_id']}/equipment/commission", method="POST",
            body={"expected_revision": 1, "installation_checked": True})
        migration_path = Path(__file__).parents[1] / "alembic/versions/20261013_0032_owner_setup.py"
        spec = importlib.util.spec_from_file_location("owner_setup_migration", migration_path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with SessionLocal() as session:
            used = session.get(Device, uuid.UUID(connection["device_id"]))
            used.initial_setup_completed_at = None
            used.lifecycle_status = "provisioning"
            new = session.get(Device, uuid.UUID(next_connection["device_id"]))
            factory = session.get(FactoryController, uuid.UUID(next_kit["controller"]["id"]))
            session.add(FactoryAudit(controller_id=factory.id, action="commissioned", details={},
                occurred_at=factory.claimed_at - timedelta(days=1)))
            session.flush()
            # Виконуємо точний SQL backfill міграції на вже створених таблицях.
            with patch.object(migration.op, "add_column"), patch.object(migration.op, "create_table"), \
                    patch.object(migration.op, "execute", side_effect=lambda sql: session.execute(text(sql))):
                migration.upgrade()
            session.refresh(used)
            session.refresh(new)
            self.assertIsNotNone(used.initial_setup_completed_at)
            self.assertIsNone(new.initial_setup_completed_at)
            session.rollback()

    def test_refreshed_scope_cannot_silently_retarget_an_old_proposal(self):
        for change in ("configuration", "credential"):
            kit, connection, config = self.ready()
            before = self.setup_read(kit)
            proposal = {**before["equipment"], "frequency_limits": {"min_hz": 10, "max_hz": 45}}
            saved = self.call(self.path(kit) + "/draft", method="PUT", who="other",
                body={**self.scope(before), "equipment": proposal})
            if change == "configuration":
                self.call(f"/api/v1/devices/{connection['device_id']}/equipment/configurations", method="POST", expected=201,
                    body={"expected_revision": config["manifest"]["revision"],
                        "module_id": config["manifest"]["module_id"], "profile_id": config["manifest"]["profile_id"],
                        "profile_version": 1, "bus": config["manifest"]["bus"],
                        "frequency_limits": {"min_hz": 10, "max_hz": 40}})
            else:
                with SessionLocal.begin() as session:
                    session.get(FactoryController, uuid.UUID(kit["controller"]["id"])).credential_revision += 1
            refreshed = self.setup_read(kit)
            self.assertTrue(refreshed["draft_stale"])
            self.assertFalse(refreshed["can_apply"])
            self.call(self.path(kit) + "/apply", method="POST", who="other",
                body={**self.scope(refreshed), "nameplate_checked": True}, expected=409)
            reviewed = self.call(self.path(kit) + "/draft", method="PUT", who="other",
                body={**self.scope(refreshed), "equipment": proposal})
            self.assertFalse(reviewed["draft_stale"])
            self.assertEqual(reviewed["draft_revision"], saved["draft_revision"] + 1)
            applied = self.call(self.path(kit) + "/apply", method="POST", who="other",
                body={**self.scope(reviewed), "nameplate_checked": True})
            self.assertFalse(applied["draft_stale"])
            self.assertFalse(applied["needs_apply"])

"""Анонімні HTTP/RLS запити перевіряють межі допомоги та конкурентні пропозиції."""
import os
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch

from sqlalchemy import create_engine, event, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from auth_http_helpers import request
from customer_rls_helpers import IsolatedCustomerRls
from onboarding_helpers import OnboardingFixtures
import test_factory_preparation_postgres as prepared
from app.db import SessionLocal, get_db_session
from app.main import app
from app.models import Capability, Device, DeviceCommand, DeviceSetupDraft, DeviceSetupHelper, FactoryController, OrganizationMembership, User
from app.models.onboarding import FactoryAudit
from app.security.browser_config import AUTH_BROWSER_ORIGINS
from app.security.tokens import utc_now


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class SetupHelperTests(IsolatedCustomerRls, OnboardingFixtures, unittest.TestCase):
    create_claim = prepared.FactoryPreparationTests.create_claim
    contact = prepared.FactoryPreparationTests.contact
    fresh = prepared.FactoryPreparationTests.fresh

    def setUp(self):
        with SessionLocal() as session:
            self.initial_capabilities = set(session.scalars(select(Capability.id)))
        super().setUp()
        self.enterContext(patch("app.services.controller_credentials.ControllerBroker"))
        self.enterContext(patch.dict(os.environ, {"CONTROLLER_MQTT_PUBLIC_HOST": "example.test"}))
        self.setup_equipment = dict(profile_id="suswe.su600.modbus", profile_version=1,
            model="SU600A-5RG1-B", serial_number="VFD-TEST", motor={"rated_frequency_hz": 50},
            frequency_limits={"min_hz": 10, "max_hz": 50})
        self.kit, self.connection = self.create_claim(prepared=False)
        self.controller_id = uuid.UUID(self.kit["controller"]["id"])
        self.device_id = uuid.UUID(self.connection["device_id"])
        self.setup_path = f"/api/v1/connect/{self.controller_id}/setup"
        self.customer_engine = create_engine(self.rls_engine.url, poolclass=NullPool)
        self.addCleanup(self.customer_engine.dispose)

        @event.listens_for(self.customer_engine, "connect")
        def set_role(connection, record):
            with connection.cursor() as cursor:
                cursor.execute("SET ROLE kerumo_customer")
            connection.commit()

        self.customer_sessions = sessionmaker(bind=self.customer_engine, autoflush=False, expire_on_commit=False)

        def customer_db():
            with self.customer_sessions() as session:
                self.assertEqual(session.scalar(text("SELECT current_user")), "kerumo_customer")
                yield session

        previous = app.dependency_overrides.get(get_db_session)
        app.dependency_overrides[get_db_session] = customer_db

        def restore():
            if previous is None:
                app.dependency_overrides.pop(get_db_session, None)
            else:
                app.dependency_overrides[get_db_session] = previous

        self.addCleanup(restore)
        self.enterContext(patch("app.security.current_user.APP_PLANE", "customer"))
        self.equipment = {**self.setup_equipment, "motor": {
            "rated_frequency_hz": 50, "rated_current_a": 4, "rated_voltage_v": 380, "rated_power_kw": 1.5}}

    def cleanup_data(self):
        with SessionLocal() as session:
            introduced = set(session.scalars(select(Capability.id))) - self.initial_capabilities
        self.created_caps.extend(introduced - set(self.created_caps))
        super().cleanup_data()

    def owner(self, suffix="", *, body=None, method="GET", who="other", expected=200):
        return self.call(self.setup_path + suffix, body=body, method=method, who=who, expected=expected)

    @staticmethod
    def scope(state):
        return {"expected_generation": state["generation"],
            "expected_credential_revision": state["credential_revision"],
            "expected_configuration_revision": state["configuration_revision"],
            "expected_draft_revision": state["draft_revision"]}

    def issue(self):
        return self.owner("/helpers", method="POST", body=self.scope(self.owner()), expected=201)

    def public(self, path, body, *, method="POST", expected=200, headers=None):
        code, result, response_headers = request(method, "/api/v1/setup-help/" + path, body=body,
            headers=headers if headers is not None else {
                "origin": AUTH_BROWSER_ORIGINS[0], "x-techbaza-csrf": "1"}, ip=self.ip)
        self.assertEqual(code, expected, result)
        self.assertEqual(response_headers.get("cache-control"), "no-store")
        return result, response_headers

    def inspect(self, token, *, expected=200):
        return self.public("inspect", {"token": token}, expected=expected)[0]

    def test_link_is_hashed_short_lived_single_device_and_returns_narrow_context(self):
        link = self.issue()
        self.assertEqual(len(link["token"].split(".")[1]), 43)
        with SessionLocal() as session:
            row = session.get(DeviceSetupHelper, uuid.UUID(link["id"]))
            self.assertNotIn(link["token"].split(".")[1], row.token_hash)
            self.assertEqual(row.expires_at - row.created_at, timedelta(hours=2))
            self.assertEqual(row.device_id, self.device_id)
        state = self.inspect(link["token"])
        self.assertEqual(set(state), {"helper_id", "expires_at", "serial_number", "generation",
            "credential_revision", "configuration_revision", "draft_revision", "equipment",
            "missing_fields", "checks", "progress", "profiles"})
        self.assertEqual(state["serial_number"], self.kit["controller"]["serial_number"])
        self.assertTrue(state["profiles"])
        self.assertEqual(set(state["profiles"][0]), {"id", "version", "manufacturer", "series", "support", "tested_model"})
        rows = self.owner("/helpers")
        self.assertTrue(rows[0]["active"])
        self.assertNotIn("token", rows[0])
        with self.customer_sessions() as session:
            self.assertIsNone(session.get(User, self.contexts["owner"].user.id))

    def test_anonymous_write_is_only_a_shared_proposal_and_audits_helper_identity(self):
        link = self.issue()
        state = self.inspect(link["token"])
        result, _ = self.public("draft", {"token": link["token"], **self.scope(state),
            "equipment": self.equipment}, method="PUT")
        self.assertEqual(result["draft_revision"], 1)
        self.assertEqual(self.owner()["equipment"], result["equipment"])
        with SessionLocal() as session:
            draft = session.get(DeviceSetupDraft, self.device_id)
            self.assertEqual(draft.updated_by_helper_id, uuid.UUID(link["id"]))
            self.assertIsNone(draft.updated_by_user_id)
            self.assertIsNone(draft.applied_revision)
            self.assertEqual(session.get(Device, self.device_id).lifecycle_status, "provisioning")
            self.assertIsNone(session.get(FactoryController, self.controller_id).control_mode)
            self.assertIsNone(session.scalar(select(DeviceCommand).where(DeviceCommand.device_id == self.device_id)))
            audit = session.scalar(select(FactoryAudit).where(FactoryAudit.controller_id == self.controller_id,
                FactoryAudit.action == "setup_draft_saved"))
            self.assertIsNone(audit.actor_user_id)
            self.assertIsNone(audit.actor_session_id)
            self.assertEqual(audit.details["helper_id"], link["id"])
            self.assertNotIn(link["token"], str(audit.details))

    def test_token_never_authenticates_commands_history_owner_actions_or_technical_writes(self):
        token = self.issue()["token"]
        paths = [("GET", f"/api/v1/devices/{self.device_id}/telemetry", None),
            ("POST", f"/api/v1/devices/{self.device_id}/commands", {"request_id": str(uuid.uuid4()), "command_type": "vfd.start"}),
            ("POST", self.setup_path + "/apply", {**self.scope(self.owner()), "nameplate_checked": True}),
            ("GET", f"/api/v1/devices/{self.device_id}/equipment", None)]
        for method, path, body in paths:
            status, _, _ = request(method, path, body=body, headers={"authorization": "Bearer " + token}, ip=self.ip)
            self.assertEqual(status, 401, path)
        self.public("draft", {"token": token, **self.scope(self.owner()), "equipment": {
            **self.equipment, "parameters": {"F0.03": 6}}}, method="PUT", expected=422)

    def test_new_link_replaces_old_and_owner_revoke_is_immediate(self):
        first, second = self.issue(), self.issue()
        self.inspect(first["token"], expected=404)
        self.inspect(second["token"])
        rows = self.owner("/helpers")
        self.assertEqual(sum(row["active"] for row in rows), 1)
        self.owner("/helpers/" + second["id"], method="DELETE", expected=204)
        self.inspect(second["token"], expected=404)
        self.owner("/helpers/" + second["id"], method="DELETE", expected=204)
        self.owner("/helpers/" + str(uuid.uuid4()), method="DELETE", expected=404)

    def test_expiry_rotation_completion_revoke_and_generation_changes_deny_link(self):
        link = self.issue()
        with SessionLocal.begin() as session:
            session.get(DeviceSetupHelper, uuid.UUID(link["id"])).expires_at = utc_now() - timedelta(seconds=1)
        self.inspect(link["token"], expected=404)
        for model, identity, field, value in (
            (FactoryController, self.controller_id, "credential_revision", 19),
            (FactoryController, self.controller_id, "generation", 19),
            (FactoryController, self.controller_id, "access_revoked", True),
            (FactoryController, self.controller_id, "device_id", self.devices[1]),
            (Device, self.device_id, "initial_setup_completed_at", utc_now()),
            (Device, self.device_id, "lifecycle_status", "maintenance"),
        ):
            with self.subTest(field=field):
                link = self.issue()
                with SessionLocal.begin() as session:
                    row = session.get(model, identity)
                    original = getattr(row, field)
                    setattr(row, field, value)
                self.inspect(link["token"], expected=404)
                with SessionLocal.begin() as session:
                    setattr(session.get(model, identity), field, original)

    def test_lost_then_restored_issuer_authority_never_revives_old_link(self):
        user_id = self.contexts["other"].user.id
        with SessionLocal() as session:
            membership_id = session.scalar(select(OrganizationMembership.id).where(
                OrganizationMembership.organization_id == uuid.UUID(self.connection["organization_id"]),
                OrganizationMembership.user_id == user_id))
        for model, identity, field, changed in (
            (User, user_id, "is_active", False),
            (OrganizationMembership, membership_id, "role", "viewer"),
            (OrganizationMembership, membership_id, "site_ids", [self.connection["site_id"]]),
        ):
            with self.subTest(field=field):
                link = self.issue()
                with SessionLocal.begin() as session:
                    row = session.get(model, identity)
                    original = getattr(row, field)
                    setattr(row, field, changed)
                self.inspect(link["token"], expected=404)
                with SessionLocal.begin() as session:
                    setattr(session.get(model, identity), field, original)
                self.inspect(link["token"], expected=404)
                self.inspect(self.issue()["token"])

    def test_owner_apply_revokes_link_and_stale_proposal_cannot_overwrite_owner(self):
        link = self.issue()
        state = self.inspect(link["token"])
        changed = self.owner("/draft", method="PUT", body={**self.scope(state), "equipment": self.equipment})
        self.public("draft", {"token": link["token"], **self.scope(state), "equipment": {}}, method="PUT", expected=409)
        self.owner("/apply", method="POST", body={**self.scope(changed), "nameplate_checked": True})
        self.inspect(link["token"], expected=404)
        with SessionLocal() as session:
            self.assertIsNotNone(session.get(DeviceSetupHelper, uuid.UUID(link["id"])).revoked_at)

    def test_concurrent_proposals_use_compare_and_swap(self):
        link = self.issue()
        body = {"token": link["token"], **self.scope(self.inspect(link["token"])), "equipment": self.equipment}
        def write(_):
            return request("PUT", "/api/v1/setup-help/draft", body=body,
                headers={"origin": AUTH_BROWSER_ORIGINS[0], "x-techbaza-csrf": "1"}, ip=self.ip)[0]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(write, range(2)))
        self.assertCountEqual(results, [200, 409])
        self.assertEqual(self.owner()["draft_revision"], 1)

    def test_applying_unchanged_configuration_also_revokes_helper(self):
        saved = self.owner("/draft", method="PUT", body={**self.scope(self.owner()), "equipment": self.equipment})
        applied = self.owner("/apply", method="POST", body={**self.scope(saved), "nameplate_checked": True})
        passport = self.call(f"/api/v1/devices/{self.device_id}/equipment", who="other")
        self.fresh(self.connection, passport["desired"])
        link = self.issue()
        repeated = self.owner("/apply", method="POST", body={**self.scope(applied), "nameplate_checked": True})
        self.assertEqual(repeated["configuration_revision"], applied["configuration_revision"])
        self.inspect(link["token"], expected=404)

    def test_public_errors_are_no_store_redacted_origin_checked_and_rate_limited(self):
        token = self.issue()["token"]
        for bad in (token + "-LEAK-ME", "secret-must-never-echo", "", 13):
            body, _ = self.public("inspect", {"token": bad}, expected=422)
            if isinstance(bad, str) and bad:
                self.assertNotIn(bad, str(body))
        self.public("inspect", {"token": token}, headers={}, expected=403)
        self.inspect("0" * 32 + "." + "A" * 43, expected=404)
        with patch("app.services.auth_throttle.AUTH_SESSION_IP_LIMIT", 1):
            self.public("inspect", {"token": token}, expected=429)

    def test_non_owner_and_stale_context_cannot_issue_helper(self):
        self.owner("/helpers", method="POST", body=self.scope(self.owner()), who="viewer", expected=404)
        self.owner("/helpers", method="POST", body={**self.scope(self.owner()), "expected_generation": 17}, expected=409)
        self.owner("/helpers", method="POST", body={**self.scope(self.owner()), "expires_in_days": 7}, expected=422)


if __name__ == "__main__":
    unittest.main()

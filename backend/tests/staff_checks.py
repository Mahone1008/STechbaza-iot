"""Run separately with APP_PLANE=staff against a disposable PostgreSQL database."""

import asyncio
import io
import json
import logging
import os
import unittest
import uuid
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import delete, select, text

from app.db import SessionLocal, engine
from app.models import AuthSession, Device, Organization, OrganizationMembership, Site, User
from app.models.onboarding import AccountSecurity
from app.models.platform_audit import PlatformAudit
from app.schemas.auth import LoginRequest
from app.security.account_keys import secret_box, totp_code
from app.security.auth_config import AUTH_TOKEN_AUDIENCE
from app.security.browser_config import AUTH_BROWSER_ORIGINS
from app.security.passwords import hash_password, verify_password
from app.security.tokens import create_access_token, create_refresh_token, utc_now
from app.services.auth import AuthService, InvalidCredentialsError, InvalidRefreshTokenError
from app.staff_main import app

PASSWORD = "staff-test-current-password-2026"
HASH = hash_password(PASSWORD)


def request(method, path, token=None, body=None):
    async def execute():
        raw = json.dumps(body).encode() if body is not None else b""
        headers = {"host": "127.0.0.1", "content-type": "application/json", "origin": AUTH_BROWSER_ORIGINS[0], "x-techbaza-csrf": "1"}
        if token:
            headers["authorization"] = "Bearer " + token
        messages = []
        scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method,
            "scheme": "http", "path": path, "raw_path": path.encode(), "root_path": "", "query_string": b"",
            "headers": [(key.encode(), value.encode()) for key, value in headers.items()],
            "client": ("198.18.20.1", 13001), "server": ("127.0.0.1", 8002)}
        async def receive():
            return {"type": "http.request", "body": raw, "more_body": False}
        async def send(message):
            messages.append(message)
        await app(scope, receive, send)
        start = next(message for message in messages if message["type"] == "http.response.start")
        raw_response = b"".join(message.get("body", b"") for message in messages if message["type"] == "http.response.body")
        return start["status"], json.loads(raw_response) if raw_response else None
    return asyncio.run(execute())


class StaffChecks(unittest.TestCase):
    def setUp(self):
        self.assertEqual(os.environ.get("APP_PLANE"), "staff", "Run this suite in the isolated staff process")
        self.ids = {key: uuid.uuid4() for key in ("admin", "service", "customer", "other")}
        self.tokens = {}
        self.secrets = {}
        self.sessions = {}
        self.org_ids = [uuid.uuid4(), uuid.uuid4()]
        self.site_ids = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]
        self.device_ids = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]
        with SessionLocal.begin() as session:
            for key, user_id in self.ids.items():
                user = User(id=user_id, email=f"staff-{key}-{user_id.hex}@example.com", display_name=key,
                            password_hash=HASH, platform_role={"admin": "superadmin", "service": "service_admin"}.get(key, "user"))
                session.add(user)
                self.secrets[key] = "JBSWY3DPEHPK3PXP"
            session.flush()
            for key in self.ids:
                verified = key in ("admin", "service")
                security = AccountSecurity(user_id=self.ids[key], totp_secret=secret_box().encrypt(self.secrets[key].encode()).decode(),
                    totp_enabled_at=utc_now() if verified else None)
                session.add(security)
                refresh = create_refresh_token()
                auth = AuthSession(id=uuid.uuid4(), user_id=self.ids[key], refresh_token_hash=refresh.token_hash,
                    expires_at=refresh.expires_at, audience=AUTH_TOKEN_AUDIENCE, mfa_verified_at=utc_now() if verified else None)
                session.add(auth)
                self.sessions[key] = auth.id
                self.tokens[key] = create_access_token(user_id=self.ids[key], auth_session_id=auth.id).token
            for index, org_id in enumerate(self.org_ids):
                session.add(Organization(id=org_id, name=f"Staff org {index}", slug=f"staff-{org_id.hex}"))
            session.flush()
            for index, site_id in enumerate(self.site_ids):
                session.add(Site(id=site_id, organization_id=self.org_ids[0 if index < 2 else 1], name=f"Site {index}", code=f"site-{index}"))
            session.flush()
            for index, device_id in enumerate(self.device_ids):
                session.add(Device(id=device_id, site_id=self.site_ids[index], name=f"Controller {index}", uid=f"staff-device-{device_id.hex}"))
            session.add(OrganizationMembership(organization_id=self.org_ids[0], user_id=self.ids["service"], role="service", site_ids=[str(self.site_ids[0])]))
            session.add(OrganizationMembership(organization_id=self.org_ids[1], user_id=self.ids["customer"], role="owner"))

    def tearDown(self):
        with SessionLocal.begin() as session:
            session.execute(delete(PlatformAudit).where(PlatformAudit.actor_user_id.in_(self.ids.values())))
            session.execute(delete(Organization).where(Organization.id.in_(self.org_ids)))
            session.execute(delete(User).where(User.id.in_(self.ids.values())))

    def email(self, key):
        return f"staff-{key}-{self.ids[key].hex}@example.com"

    def proof(self):
        return {"password": PASSWORD, "otp": totp_code(self.secrets["admin"], int(utc_now().timestamp()) // 30)}

    def body(self, **changes):
        return {"proof": self.proof(), "reason": "Staff integration acceptance", **changes}

    def test_customer_cannot_login_or_use_even_a_valid_staff_signed_token(self):
        with SessionLocal() as session:
            with self.assertRaises(InvalidCredentialsError):
                AuthService(session).login(LoginRequest(email=self.email("customer"), password=PASSWORD))
        status, _ = request("GET", "/api/v1/staff/overview", self.tokens["customer"])
        self.assertEqual(status, 401)

    def test_refresh_sessions_are_bound_to_their_plane(self):
        refresh = create_refresh_token()
        with SessionLocal.begin() as session:
            session.add(AuthSession(user_id=self.ids["admin"], audience="techbaza-api", refresh_token_hash=refresh.token_hash, expires_at=refresh.expires_at))
        with SessionLocal() as session:
            with self.assertRaises(InvalidRefreshTokenError):
                AuthService(session).refresh(refresh.token)

    def test_staff_requires_mfa_but_can_open_security_for_first_enrollment(self):
        with SessionLocal.begin() as session:
            session.get(AuthSession, self.sessions["admin"]).mfa_verified_at = None
        self.assertEqual(request("GET", "/api/v1/staff/overview", self.tokens["admin"])[0], 403)
        self.assertEqual(request("GET", "/api/v1/capabilities", self.tokens["admin"])[0], 403)
        self.assertEqual(request("GET", "/api/v1/organizations", self.tokens["admin"])[0], 403)
        self.assertEqual(request("GET", "/api/v1/auth/security", self.tokens["admin"])[0], 200)

    def test_service_cannot_read_global_controls_and_inventory_respects_scope_and_expiry(self):
        for path in ("users", "audit", "monitoring"):
            self.assertEqual(request("GET", "/api/v1/staff/"+path, self.tokens["service"])[0], 403)
        self.assertEqual(request("GET", "/api/v1/factory/controllers", self.tokens["service"])[0], 403)
        status, rows = request("GET", "/api/v1/staff/devices", self.tokens["service"])
        self.assertEqual(status, 200, rows)
        self.assertEqual([row["id"] for row in rows], [str(self.device_ids[0])])
        status, overview = request("GET", "/api/v1/staff/overview", self.tokens["service"])
        self.assertEqual(status, 200, overview)
        self.assertEqual(overview["devices"], 1)
        self.assertIsNone(overview["users"])
        with SessionLocal.begin() as session:
            member = session.scalar(select(OrganizationMembership).where(OrganizationMembership.user_id == self.ids["service"]))
            member.expires_at = utc_now()-timedelta(seconds=1)
        self.assertEqual(request("GET", "/api/v1/staff/devices", self.tokens["service"])[1], [])

    def test_role_change_revokes_sessions_and_audits_atomically_without_passwords(self):
        with SessionLocal() as session:
            updated = session.get(User, self.ids["other"]).updated_at.isoformat()
        path = f'/api/v1/staff/users/{self.ids["other"]}'
        status, row = request("PATCH", path, self.tokens["admin"], self.body(expected_updated_at=updated, platform_role="service_admin"))
        self.assertEqual(status, 200, row)
        self.assertEqual(row["platform_role"], "service_admin")
        with SessionLocal() as session:
            self.assertIsNotNone(session.get(AuthSession, self.sessions["other"]).revoked_at)
            self.assertTrue(verify_password(PASSWORD, session.get(User, self.ids["other"]).password_hash))
            audit = session.scalar(select(PlatformAudit).where(PlatformAudit.action == "user.updated", PlatformAudit.resource_id == str(self.ids["other"])))
            self.assertEqual(audit.details["before"]["platform_role"], "user")
            self.assertNotIn(PASSWORD, str(audit.details))
        # The same OTP cannot be reused for a second sensitive action.
        status, _ = request("POST", path+"/sessions/revoke", self.tokens["admin"], self.body())
        self.assertEqual(status, 401)

    def test_mfa_reset_preserves_password_role_and_revokes_session(self):
        target = self.ids["service"]
        status, result = request("POST", f"/api/v1/staff/users/{target}/security-reset", self.tokens["admin"], self.body(include_recovery=True))
        self.assertEqual(status, 204, result)
        with SessionLocal() as session:
            security = session.get(AccountSecurity, target)
            self.assertIsNone(security.totp_secret)
            self.assertIsNone(security.totp_enabled_at)
            self.assertEqual(session.get(User, target).platform_role, "service_admin")
            self.assertTrue(verify_password(PASSWORD, session.get(User, target).password_hash))
        self.assertEqual(request("GET", "/api/v1/auth/me", self.tokens["service"])[0], 401)

    def test_self_demotion_last_owner_and_device_deletion_are_blocked(self):
        with SessionLocal() as session:
            updated = session.get(User, self.ids["admin"]).updated_at.isoformat()
        status, _ = request("PATCH", f'/api/v1/staff/users/{self.ids["admin"]}', self.tokens["admin"], self.body(expected_updated_at=updated, platform_role="user"))
        self.assertEqual(status, 409)
        with SessionLocal() as session:
            updated = session.get(User, self.ids["customer"]).updated_at.isoformat()
        status, _ = request("PATCH", f'/api/v1/staff/users/{self.ids["customer"]}', self.tokens["admin"], self.body(expected_updated_at=updated, is_active=False))
        self.assertEqual(status, 409)
        status, _ = request("DELETE", f"/api/v1/staff/sites/{self.site_ids[0]}", self.tokens["admin"], self.body())
        self.assertEqual(status, 409)

    def test_missing_role_changes_are_denied_and_stale_edits_do_not_overwrite(self):
        with SessionLocal() as session:
            updated = session.get(User, self.ids["other"]).updated_at.isoformat()
        body = self.body(expected_updated_at=updated, display_name="Updated user")
        status, _ = request("PATCH", f'/api/v1/staff/users/{self.ids["other"]}', self.tokens["service"], body)
        self.assertEqual(status, 403)
        with SessionLocal.begin() as session:
            session.get(User, self.ids["other"]).display_name = "Another admin changed this"
        status, _ = request("PATCH", f'/api/v1/staff/users/{self.ids["other"]}', self.tokens["admin"], body)
        self.assertEqual(status, 409)

    def test_logs_and_validation_never_echo_credentials_or_unknown_paths(self):
        secret = "DO-NOT-LOG-PRIVATE-CREDENTIAL"
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        logger = logging.getLogger("kerumo.requests")
        level = logger.level
        logger.setLevel(logging.INFO)
        logger.addHandler(handler)
        try:
            status, result = request("POST", f'/api/v1/staff/users/{self.ids["other"]}/security-reset', self.tokens["admin"], {"proof": {"password": secret}, "reason": "x"})
            self.assertEqual(status, 422)
            request("GET", "/unknown/"+secret)
            self.assertNotIn(secret, str(result))
            self.assertNotIn(secret, stream.getvalue())
        finally:
            logger.removeHandler(handler)
            logger.setLevel(level)

    def test_transaction_failure_rolls_back_user_and_totp_counter(self):
        target = self.ids["other"]
        with SessionLocal() as session:
            updated = session.get(User, target).updated_at.isoformat()
        with patch("app.api.v1.staff.audit", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaises(RuntimeError):
                request("PATCH", f"/api/v1/staff/users/{target}", self.tokens["admin"], self.body(expected_updated_at=updated, display_name="Must roll back"))
        with SessionLocal() as session:
            self.assertEqual(session.get(User, target).display_name, "other")
            self.assertIsNone(session.get(AccountSecurity, self.ids["admin"]).totp_last_counter)

    def test_z_database_roles_protect_staff_secrets_roles_and_audit(self):
        sql = (Path(__file__).resolve().parents[2] / "infrastructure/staff/runtime-roles.sql").read_text()
        with engine.begin() as connection:
            for role in ("kerumo_customer", "kerumo_staff"):
                if not connection.scalar(text("SELECT 1 FROM pg_roles WHERE rolname=:role"), {"role": role}):
                    connection.exec_driver_sql(f"CREATE ROLE {role} NOLOGIN")
            connection.exec_driver_sql(sql[sql.index("REVOKE CREATE"):])
        with SessionLocal.begin() as session:
            session.execute(text("SET LOCAL ROLE kerumo_customer"))
            self.assertIsNone(session.get(User, self.ids["admin"]))
            self.assertIsNone(session.get(AccountSecurity, self.ids["admin"]))
            self.assertIsNone(session.get(AuthSession, self.sessions["admin"]))
            metadata = session.execute(text("SELECT * FROM public.customer_actor_metadata(:id)"), {"id": self.ids["service"]}).mappings().one()
            self.assertEqual(set(metadata), {"id", "email", "display_name", "platform_role", "is_active"})
            from app.services.schedules import schedule_actor
            schedule = SimpleNamespace(author_user_id=self.ids["service"], device_id=self.device_ids[0], organization_id=self.org_ids[0])
            with patch("app.security.actor_metadata.APP_PLANE", "customer"):
                self.assertEqual(schedule_actor(session, schedule).user_id, self.ids["service"])
                schedule.device_id = self.device_ids[1]
                self.assertIsNone(schedule_actor(session, schedule))
            with self.assertRaises(Exception):
                session.execute(text("UPDATE users SET platform_role='superadmin' WHERE id=:id"), {"id": self.ids["other"]})
            session.rollback()
        with SessionLocal.begin() as session:
            session.execute(text("SET LOCAL ROLE kerumo_staff"))
            with self.assertRaises(Exception):
                session.execute(delete(PlatformAudit))
            session.rollback()


if __name__ == "__main__":
    unittest.main()

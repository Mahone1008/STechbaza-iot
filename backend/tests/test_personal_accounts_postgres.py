"""Registration and invitations exercise real HTTP, role checks and single-use proofs."""

import os
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from sqlalchemy import delete, select

from auth_http_helpers import request
from onboarding_helpers import OnboardingFixtures
from app.db import SessionLocal
from app.models import AccountLink, AuthSession, OrganizationMembership, User
from app.security.account_keys import totp_code
from app.security.browser_config import AUTH_BROWSER_ORIGINS
from app.security.tokens import utc_now


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class PersonalAccountTests(OnboardingFixtures, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.email = f"personal-{uuid.uuid4().hex}@example.com"
        self.password = "personal-account-test-password-2026"
        self.letters = []
        for module in ("registration", "invitations"):
            patcher = patch(
                f"app.services.{module}.send_account_mail",
                side_effect=lambda *args: self.letters.append(args),
            )
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(self.clean_links)

    def clean_links(self):
        with SessionLocal.begin() as session:
            session.execute(delete(AccountLink).where(AccountLink.email == self.email))

    def http(self, path, *, body=None, who=None, token=None, expected=200, method="POST"):
        headers = {"origin": AUTH_BROWSER_ORIGINS[0], "x-techbaza-csrf": "1"}
        if who:
            headers["authorization"] = f"Bearer {self.tokens[who]}"
        if token:
            headers["authorization"] = f"Bearer {token}"
        code, result, response_headers = request(
            method, "/api/v1" + path, body=body, headers=headers, ip=self.ip
        )
        self.assertEqual(code, expected, (path, result))
        return result, response_headers

    def mail_token(self):
        return self.letters[-1][2].split("#token=")[1].split()[0]

    def test_email_proofs_require_browser_origin_and_never_echo_secret_validation_input(self):
        for path in ("/auth/registration/start", "/invitations/inspect"):
            for headers in (
                {},
                {"origin": AUTH_BROWSER_ORIGINS[0]},
                {"origin": "https://foreign.example", "x-techbaza-csrf": "1"},
            ):
                code, _, response = request(
                    "POST",
                    "/api/v1" + path,
                    body={"email": self.email},
                    headers=headers,
                    ip=self.ip,
                )
                self.assertEqual(code, 403)
                self.assertEqual(response["cache-control"], "no-store")
        for path in ("/auth/registration/complete", "/invitations/register"):
            secret = "private-invalid-token-input"
            result, headers = self.http(
                path,
                body={"token": secret, "display_name": "Buyer", "password": "private-short"},
                expected=422,
            )
            self.assertNotIn(secret, str(result))
            self.assertNotIn("private-short", str(result))
            self.assertEqual(headers["cache-control"], "no-store")

    def register(self):
        self.http("/auth/registration/start", body={"email": self.email}, expected=202)
        token = self.mail_token()
        result, headers = self.http(
            "/auth/registration/complete",
            body={"token": token, "display_name": "Buyer", "password": self.password},
        )
        self.assertEqual(headers["cache-control"], "no-store")
        with SessionLocal() as session:
            self.additional_users.append(
                session.scalar(select(User.id).where(User.email == self.email))
            )
        login, _ = self.http(
            "/auth/browser/login", body={"email": self.email, "password": self.password}
        )
        return token, result, login["access_token"]

    def test_registration_proves_email_and_claims_two_controllers_without_mfa(self):
        proof, created, token = self.register()
        self.assertEqual(created["email"], self.email)
        self.assertEqual(len(created["recovery_key"]), 43)
        with SessionLocal() as session:
            user = session.get(User, self.additional_users[-1])
            self.assertEqual(user.platform_role, "user")
            self.assertIsNotNone(user.email_verified_at)
            self.assertEqual(
                list(
                    session.scalars(
                        select(OrganizationMembership).where(
                            OrganizationMembership.user_id == user.id
                        )
                    )
                ),
                [],
            )
            link = session.scalar(select(AccountLink).where(AccountLink.email == self.email))
            self.assertNotIn(proof.split(".")[1], link.token_hash)
        self.http(
            "/auth/registration/complete",
            body={"token": proof, "display_name": "Again", "password": self.password},
            expected=404,
        )
        first = self.factory()
        second = self.factory()
        with patch.dict(os.environ, {"AUTH_REQUIRE_PRIVILEGED_MFA": "true"}):
            claimed, _ = self.http(
                f"/connect/{first['controller']['id']}/claim",
                body=self.claim_body(first),
                token=token,
            )
            another, _ = self.http(
                f"/connect/{second['controller']['id']}/claim",
                body={
                    "activation_code": second["password"],
                    "device_name": "Second controller",
                    "site_id": claimed["site_id"],
                },
                token=token,
            )
            self.assertEqual(another["site_id"], claimed["site_id"])
            self.assertNotEqual(another["device_id"], claimed["device_id"])
            state, _ = self.http("/auth/security", method="GET", token=token)
            self.assertFalse(state["mfa_enabled"])
            self.assertFalse(state["privileged_mfa_required"])

    def test_label_entry_converts_to_verified_personal_identity_and_revokes_temporary_access(self):
        factory = self.factory()
        temporary, _ = self.http(
            "/auth/browser/login", body={"email": factory["login"], "password": factory["password"]}
        )
        with SessionLocal() as session:
            user_id = session.scalar(select(User.id).where(User.login_name == factory["login"]))
            self.additional_users.append(user_id)
        self.http(
            f"/connect/{factory['controller']['id']}/account-registration",
            token=temporary["access_token"],
            body={"email": self.email},
            expected=202,
        )
        proof = self.mail_token()
        self.http(
            "/auth/registration/complete",
            body={"token": proof, "display_name": "Buyer", "password": self.password},
        )
        self.http("/auth/me", token=temporary["access_token"], method="GET", expected=401)
        self.http(
            "/auth/browser/login",
            body={"email": factory["login"], "password": factory["password"]},
            expected=401,
        )
        login, _ = self.http(
            "/auth/browser/login", body={"email": self.email, "password": self.password}
        )
        ready, _ = self.http(
            f"/connect/{factory['controller']['id']}", token=login["access_token"], method="GET"
        )
        self.assertFalse(ready["activation_required"])
        self.assertIsNone(ready["permanent_login"])
        claimed, _ = self.http(
            f"/connect/{factory['controller']['id']}/claim",
            token=login["access_token"],
            body={
                "device_name": "Verified controller",
                "new_site": {"name": "Well", "organization_name": "My company"},
            },
        )
        self.assertEqual(claimed["state"], "claimed")

    def test_existing_organization_selection_enforces_create_rights_and_scope(self):
        factory = self.factory()
        self.http(
            f"/connect/{factory['controller']['id']}/claim",
            who="viewer",
            body={
                "activation_code": factory["password"],
                "device_name": "Controller",
                "new_site": {"name": "Forbidden", "organization_id": str(self.orgs[0])},
            },
            expected=403,
        )
        self.http(
            f"/connect/{factory['controller']['id']}/claim",
            who="other",
            body={
                "activation_code": factory["password"],
                "device_name": "Controller",
                "new_site": {"name": "Foreign", "organization_id": str(self.orgs[0])},
            },
            expected=404,
        )
        with SessionLocal.begin() as session:
            membership = session.scalar(
                select(OrganizationMembership).where(
                    OrganizationMembership.user_id == self.contexts["operator"].user.id
                )
            )
            membership.role, membership.site_ids = (
                "admin",
                None,
            )  # JSON null is also an unrestricted scope.
        organizations, _ = self.http("/connect/organizations", who="operator", method="GET")
        self.assertEqual([row["id"] for row in organizations], [str(self.orgs[0])])
        self.http(
            f"/connect/{factory['controller']['id']}/claim",
            who="operator",
            body={
                "activation_code": factory["password"],
                "device_name": "Controller",
                "new_site": {"name": "Added well", "organization_id": str(self.orgs[0])},
            },
        )

    def test_old_registration_links_expiry_and_mail_failure_cannot_create_accounts(self):
        self.http("/auth/registration/start", body={"email": self.email}, expected=202)
        old = self.mail_token()
        self.http("/auth/registration/start", body={"email": self.email}, expected=202)
        new = self.mail_token()
        self.http("/auth/registration/inspect", body={"token": old}, expected=404)
        with SessionLocal.begin() as session:
            session.get(AccountLink, uuid.UUID(new.split(".")[0])).expires_at = (
                utc_now() - timedelta(seconds=1)
            )
        self.http(
            "/auth/registration/complete",
            body={"token": new, "display_name": "Buyer", "password": self.password},
            expected=404,
        )
        from fastapi import HTTPException

        with patch(
            "app.services.registration.send_account_mail",
            side_effect=HTTPException(503, "Лист не надіслано"),
        ):
            self.http("/auth/registration/start", body={"email": self.email}, expected=503)
        with SessionLocal() as session:
            self.assertIsNone(session.scalar(select(User.id).where(User.email == self.email)))
            self.assertEqual(
                len(
                    list(
                        session.scalars(select(AccountLink).where(AccountLink.email == self.email))
                    )
                ),
                2,
            )

    def test_concurrent_registration_creates_one_account_and_no_partial_session(self):
        self.http("/auth/registration/start", body={"email": self.email}, expected=202)
        token = self.mail_token()
        barrier = Barrier(2)

        def send():
            barrier.wait()
            return request(
                "POST",
                "/api/v1/auth/registration/complete",
                body={"token": token, "display_name": "Buyer", "password": self.password},
                headers={"origin": AUTH_BROWSER_ORIGINS[0], "x-techbaza-csrf": "1"},
                ip=self.ip,
            )[0]

        with ThreadPoolExecutor(max_workers=2) as executor:
            statuses = sorted(executor.map(lambda _: send(), range(2)))
        self.assertEqual(statuses[0], 200)
        self.assertIn(statuses[1], (404, 409))
        with SessionLocal() as session:
            users = list(session.scalars(select(User).where(User.email == self.email)))
            self.assertEqual(len(users), 1)
            self.additional_users.append(users[0].id)
            self.assertEqual(
                list(
                    session.scalars(select(AuthSession).where(AuthSession.user_id == users[0].id))
                ),
                [],
            )

    def test_invitation_new_account_uses_personal_password_and_consumes_exact_role(self):
        invitation, _ = self.http(
            f"/organizations/{self.orgs[0]}/invitations",
            who="owner",
            expected=201,
            body={"email": self.email, "role": "operator", "site_ids": [str(self.sites[0])]},
        )
        proof = self.mail_token()
        self.assertNotIn(proof, str(invitation))
        preview, _ = self.http("/invitations/inspect", body={"token": proof})
        self.assertEqual(preview["role"], "operator")
        created, _ = self.http(
            "/invitations/register",
            body={"token": proof, "display_name": "Staff", "password": self.password},
        )
        with SessionLocal() as session:
            user = session.scalar(select(User).where(User.email == created["email"]))
            self.additional_users.append(user.id)
            membership = session.scalar(
                select(OrganizationMembership).where(OrganizationMembership.user_id == user.id)
            )
            self.assertEqual(
                (membership.role, membership.site_ids), ("operator", [str(self.sites[0])])
            )
            self.assertEqual(user.platform_role, "user")
        self.http("/invitations/inspect", body={"token": proof}, expected=404)

    def test_invitation_cannot_replace_existing_account_or_grant_foreign_email(self):
        _, _, token = self.register()
        self.http(
            f"/organizations/{self.orgs[0]}/invitations",
            who="owner",
            expected=201,
            body={"email": self.email, "role": "viewer"},
        )
        proof = self.mail_token()
        self.http(
            "/invitations/register",
            body={
                "token": proof,
                "display_name": "Overwrite",
                "password": "different-password-test",
            },
            expected=409,
        )
        self.http("/invitations/accept", who="other", body={"token": proof}, expected=403)
        self.http("/invitations/accept", token=token, body={"token": proof})
        self.http("/invitations/accept", token=token, body={"token": proof}, expected=404)

    def test_revoked_invitation_or_lost_inviter_rights_never_grants_access(self):
        self.http(
            f"/organizations/{self.orgs[0]}/invitations",
            who="viewer",
            body={"email": self.email},
            expected=403,
        )
        invitation, _ = self.http(
            f"/organizations/{self.orgs[0]}/invitations",
            who="owner",
            expected=201,
            body={"email": self.email},
        )
        proof = self.mail_token()
        self.http(
            f"/organizations/{self.orgs[1]}/invitations/{invitation['id']}",
            who="other",
            method="DELETE",
            expected=404,
        )
        self.http(
            f"/organizations/{self.orgs[0]}/invitations/{invitation['id']}",
            who="owner",
            method="DELETE",
            expected=204,
        )
        self.http(
            "/invitations/register",
            body={"token": proof, "display_name": "Buyer", "password": self.password},
            expected=404,
        )
        with SessionLocal.begin() as session:
            session.get(User, self.contexts["owner"].user.id).platform_role = "user"
        self.http(
            f"/organizations/{self.orgs[0]}/invitations",
            who="owner",
            expected=201,
            body={"email": self.email},
        )
        proof = self.mail_token()
        with SessionLocal.begin() as session:
            membership = session.scalar(
                select(OrganizationMembership).where(
                    OrganizationMembership.user_id == self.contexts["owner"].user.id
                )
            )
            membership.role = "viewer"
        self.http(
            "/invitations/register",
            body={"token": proof, "display_name": "Buyer", "password": self.password},
            expected=404,
        )
        with SessionLocal() as session:
            self.assertIsNone(session.scalar(select(User.id).where(User.email == self.email)))

    def test_optional_mfa_disable_requires_both_proofs_and_revokes_other_sessions(self):
        _, _, token = self.register()
        another, _ = self.http(
            "/auth/browser/login", body={"email": self.email, "password": self.password}
        )
        setup, _ = self.http(
            "/auth/security/totp/setup", token=token, body={"password": self.password}
        )
        counter = int(time.time() // 30)
        self.http(
            "/auth/security/totp/confirm",
            token=token,
            body={"otp": totp_code(setup["secret"], counter)},
            expected=204,
        )
        self.http(
            "/auth/security/totp/disable",
            token=token,
            body={"password": self.password},
            expected=401,
        )
        with patch("app.security.account_keys.time.time", return_value=(counter + 2) * 30):
            code = totp_code(setup["secret"], counter + 2)
            self.http(
                "/auth/security/totp/disable",
                token=token,
                body={"password": "wrong", "otp": code},
                expected=401,
            )
            self.http(
                "/auth/security/totp/disable",
                token=token,
                body={"password": self.password, "otp": code},
                expected=204,
            )
        state, _ = self.http("/auth/security", token=token, method="GET")
        self.assertFalse(state["mfa_enabled"])
        self.assertTrue(state["recovery_available"])
        self.http("/auth/me", token=another["access_token"], method="GET", expected=401)
        self.http("/auth/browser/login", body={"email": self.email, "password": self.password})

    def test_platform_admin_cannot_disable_mfa_even_on_loopback(self):
        from app.security.passwords import hash_password

        with SessionLocal.begin() as session:
            session.get(User, self.contexts["owner"].user.id).password_hash = hash_password(
                self.password
            )
        setup = self.call(
            "/api/v1/auth/security/totp/setup", method="POST", body={"password": self.password}
        )
        counter = int(time.time() // 30)
        self.call(
            "/api/v1/auth/security/totp/confirm",
            method="POST",
            body={"otp": totp_code(setup["secret"], counter)},
            expected=204,
        )
        with patch("app.security.account_keys.time.time", return_value=(counter + 2) * 30):
            self.call(
                "/api/v1/auth/security/totp/disable",
                method="POST",
                body={"password": self.password, "otp": totp_code(setup["secret"], counter + 2)},
                expected=409,
            )
        self.assertTrue(self.call("/api/v1/auth/security")["mfa_enabled"])

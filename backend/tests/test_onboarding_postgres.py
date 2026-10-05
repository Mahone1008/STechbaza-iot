"""Isolated real transactions: no broker publication or real controller access."""

import os
import time
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from sqlalchemy import select
from onboarding_helpers import OnboardingFixtures
from auth_http_helpers import request
from app.db import SessionLocal
from app.models import AuthSession, Device, OrganizationMembership, Site, User
from app.models.onboarding import (
    AccountSecurity,
    FactoryController,
    PersonalWorkspace,
)
from app.security.account_keys import secret_box, totp_code
from app.security.browser_config import AUTH_BROWSER_ORIGINS
from app.security.tokens import utc_now
from app.security.passwords import hash_password


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class OnboardingPostgresTests(OnboardingFixtures, unittest.TestCase):
    def test_claim_consumes_secret_and_rescanning_never_leaks_another_tenant(self):
        factory = self.factory()
        path = f"/api/v1/connect/{factory['controller']['id']}"
        body = self.claim_body(factory)
        self.call(
            path + "/claim",
            method="POST",
            who="other",
            body={**body, "activation_code": "x" * 43},
            expected=404,
        )
        first = self.call(path + "/claim", method="POST", who="other", body=body)
        second = self.call(path + "/claim", method="POST", who="other", body=body)
        self.assertEqual(first["device_id"], second["device_id"])
        self.call(path, who="viewer", expected=404)
        self.call(path + "/claim", who="viewer", method="POST", body=body, expected=404)
        with SessionLocal() as session:
            row = session.get(FactoryController, uuid.UUID(factory["controller"]["id"]))
            self.assertIsNone(row.activation_hash)
            device = session.get(Device, uuid.UUID(first["device_id"]))
            self.assertTrue(device.uid.startswith("FC-"))
            self.assertEqual(device.lifecycle_status, "provisioning")
        listed = self.call("/api/v1/factory/controllers")
        self.assertNotIn(factory["bootstrap_key"], str(listed))
        self.assertNotIn(factory["activation_code"], str(listed))

    def test_concurrent_claims_have_one_owner_and_no_orphan_workspace(self):
        factory = self.factory()
        path = f"/api/v1/connect/{factory['controller']['id']}/claim"
        barrier = threading.Barrier(2)

        def send(who):
            barrier.wait()
            return request(
                "POST",
                path,
                body=self.claim_body(factory),
                headers={"authorization": f"Bearer {self.tokens[who]}"},
                ip=self.ip,
            )[0]

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(send, role) for role in ("other", "operator")]
            results = sorted(f.result(timeout=15) for f in futures)
        self.assertEqual(results, [200, 404])
        with SessionLocal() as session:
            buyers = [self.contexts[role].user.id for role in ("other", "operator")]
            self.assertEqual(
                len(
                    list(
                        session.scalars(
                            select(PersonalWorkspace).where(PersonalWorkspace.user_id.in_(buyers))
                        )
                    )
                ),
                1,
            )

    def test_factory_requires_mfa_and_buyer_cannot_change_shipments(self):
        self.call("/api/v1/factory/controllers", who="viewer", expected=403)
        with SessionLocal.begin() as session:
            session.get(AuthSession, self.contexts["owner"].auth_session.id).mfa_verified_at = None
        self.call("/api/v1/factory/controllers", expected=403)

    def test_site_scope_expiry_and_notifications_count_enforce_access(self):
        membership_id = None
        with SessionLocal.begin() as session:
            membership = session.scalar(
                select(OrganizationMembership).where(
                    OrganizationMembership.user_id == self.contexts["operator"].user.id
                )
            )
            membership.site_ids = [str(self.sites[1])]
            membership_id = membership.id
        self.call(self.base + "/overview", who="operator", expected=404)
        self.assertEqual(
            self.call(f"/api/v1/organizations/{self.orgs[0]}/sites", who="operator"), []
        )
        count = self.call(
            f"/api/v1/organizations/{self.orgs[0]}/notifications/unread-count", who="operator"
        )
        self.assertEqual(count["unread_count"], 0)
        with SessionLocal.begin() as session:
            membership = session.get(OrganizationMembership, membership_id)
            membership.site_ids = None
            membership.expires_at = utc_now() - timedelta(seconds=1)
        self.call(self.base, who="operator", expected=404)
        self.assertEqual(self.call("/api/v1/organizations", who="operator"), [])

    def test_connect_sites_filters_permissions_before_pagination(self):
        allowed = [uuid.uuid4(), uuid.uuid4()]
        with SessionLocal.begin() as session:
            membership = session.scalar(
                select(OrganizationMembership).where(
                    OrganizationMembership.user_id == self.contexts["operator"].user.id
                )
            )
            membership.role = "service"
            membership.site_ids = [str(value) for value in allowed]
            for index in range(105):
                session.add(
                    Site(
                        organization_id=self.orgs[0],
                        name=f"A denied {index:03}",
                        code=f"denied-{index}",
                    )
                )
            for index, site_id in enumerate(allowed):
                session.add(
                    Site(
                        id=site_id,
                        organization_id=self.orgs[0],
                        name=f"Z allowed {index}",
                        code=f"allowed-{index}",
                    )
                )
        first = self.call("/api/v1/connect/sites?limit=1&offset=0", who="operator")
        second = self.call("/api/v1/connect/sites?limit=1&offset=1", who="operator")
        self.assertEqual([item["id"] for item in first + second], [str(value) for value in allowed])
        self.assertEqual(self.call("/api/v1/connect/sites?limit=1&offset=2", who="operator"), [])
        self.assertEqual(self.call("/api/v1/connect/sites", who="viewer"), [])
        with SessionLocal.begin() as session:
            membership = session.scalar(
                select(OrganizationMembership).where(
                    OrganizationMembership.user_id == self.contexts["operator"].user.id
                )
            )
            membership.expires_at = utc_now() - timedelta(seconds=1)
        self.assertEqual(self.call("/api/v1/connect/sites", who="operator"), [])

    def test_bootstrap_and_claim_accept_retained_factory_key(self):
        from unittest.mock import patch
        from app.security.account_keys import digest

        old, new = "old-account-root-" + "a" * 32, "new-account-root-" + "b" * 32
        with patch("app.security.account_keys.ACCOUNT_KEYS", (old,)):
            factory = self.factory()
        controller_id = factory["controller"]["id"]
        with patch("app.security.account_keys.ACCOUNT_KEYS", (new, old)):
            code, _, _ = request(
                "POST",
                f"/api/v1/bootstrap/{controller_id}/contact",
                body={"firmware_version": "0.6.0"},
                headers={"authorization": f"Bearer {factory['bootstrap_key']}"},
                ip=self.ip,
            )
            self.assertEqual(code, 200)
            with SessionLocal() as session:
                row = session.get(FactoryController, uuid.UUID(controller_id))
                self.assertEqual(row.bootstrap_hash, digest("bootstrap", factory["bootstrap_key"]))
            self.call(
                f"/api/v1/connect/{controller_id}/claim",
                method="POST",
                who="other",
                body=self.claim_body(factory),
            )

    def test_recovery_rotates_key_revokes_sessions_and_totp_rejects_replay(self):
        import time

        email = f"security-{uuid.uuid4().hex}@example.com"
        password = "integration-only-password-123"
        headers = {"origin": AUTH_BROWSER_ORIGINS[0], "x-techbaza-csrf": "1"}
        from app.security.passwords import hash_password
        from app.security.account_keys import digest, new_key

        key = new_key()
        with SessionLocal.begin() as session:
            user = User(
                id=uuid.uuid4(),
                email=email,
                display_name="Existing buyer",
                password_hash=hash_password(password),
                is_active=True,
            )
            session.add(user)
            session.flush()
            self.additional_users.append(user.id)
            sec = AccountSecurity(
                user_id=user.id,
                recovery_hash=digest("recovery", key),
                totp_secret=secret_box().encrypt(b"GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").decode(),
                totp_enabled_at=utc_now(),
            )
            session.add(sec)
        registration = {"recovery_key": key}
        login = dict(
            email=email,
            password=password,
            otp=totp_code("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", int(time.time() // 30)),
        )
        code, tokens, _ = request("POST", "/api/v1/auth/login", body=login, ip=self.ip)
        self.assertEqual(code, 200, tokens)
        code, _, _ = request("POST", "/api/v1/auth/login", body=login, ip=self.ip)
        self.assertEqual(code, 401)
        recovery = dict(
            email=email,
            recovery_key=registration["recovery_key"],
            new_password="replacement-password-456",
        )
        code, replaced, _ = request(
            "POST", "/api/v1/auth/recover", body=recovery, headers=headers, ip=self.ip
        )
        self.assertEqual(code, 200, replaced)
        self.assertNotEqual(replaced["recovery_key"], registration["recovery_key"])
        code, _, _ = request(
            "GET",
            "/api/v1/auth/me",
            headers={"authorization": f"Bearer {tokens['access_token']}"},
            ip=self.ip,
        )
        self.assertEqual(code, 401)
        code, _, _ = request(
            "POST", "/api/v1/auth/recover", body=recovery, headers=headers, ip=self.ip
        )
        self.assertEqual(code, 401)

    def test_http_mfa_enrollment_revokes_prior_sessions_and_preserves_current(self):
        import time
        from app.security.passwords import hash_password

        context = self.contexts["operator"]
        password = "mfa-integration-only-password"
        with SessionLocal.begin() as session:
            session.get(User, context.user.id).password_hash = hash_password(password)
        code, previous, _ = request(
            "POST",
            "/api/v1/auth/login",
            body={"email": context.user.email, "password": password},
            ip=self.ip,
        )
        self.assertEqual(code, 200, previous)
        setup = self.call(
            "/api/v1/auth/security/totp/setup",
            method="POST",
            who="operator",
            body={"password": password},
        )
        self.assertIn(setup["secret"], setup["uri"])
        self.assertFalse(self.call("/api/v1/auth/security", who="operator")["mfa_enabled"])
        code = totp_code(setup["secret"], int(time.time() // 30))
        self.call(
            "/api/v1/auth/security/totp/confirm",
            method="POST",
            who="operator",
            body={"otp": code},
            expected=204,
        )
        state = self.call("/api/v1/auth/security", who="operator")
        self.assertTrue(state["mfa_enabled"])
        self.assertTrue(state["current_session_verified"])
        status, _, _ = request(
            "GET",
            "/api/v1/auth/me",
            headers={"authorization": f"Bearer {previous['access_token']}"},
            ip=self.ip,
        )
        self.assertEqual(status, 401)
        self.assertEqual(len(self.call("/api/v1/auth/sessions", who="operator")), 1)
        self.call(
            "/api/v1/auth/security/recovery",
            method="POST",
            who="operator",
            body={"password": password, "otp": code},
            expected=401,
        )

    def test_password_change_requires_mfa_keeps_factor_and_revokes_other_sessions(self):
        password = "current-password-integration-only"
        replacement = "replacement-password-integration-only"
        secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        who = "operator"
        user_id = self.contexts[who].user.id
        with SessionLocal.begin() as session:
            session.get(User, user_id).password_hash = hash_password(password)
            session.add(
                AccountSecurity(
                    user_id=user_id,
                    totp_secret=secret_box().encrypt(secret.encode()).decode(),
                    totp_enabled_at=utc_now(),
                )
            )
        current_counter = int(time.time() // 30)
        status, other, _ = request(
            "POST",
            "/api/v1/auth/login",
            body={
                "email": self.contexts[who].user.email,
                "password": password,
                "otp": totp_code(secret, current_counter),
            },
            ip=self.ip,
        )
        self.assertEqual(status, 200)
        self.call(
            "/api/v1/auth/security/password",
            method="POST",
            who=who,
            body={"password": password, "new_password": replacement},
            expected=401,
        )
        from unittest.mock import patch

        with patch("app.security.account_keys.time.time", return_value=(current_counter + 2) * 30):
            self.call(
                "/api/v1/auth/security/password",
                method="POST",
                who=who,
                body={
                    "password": password,
                    "new_password": replacement,
                    "otp": totp_code(secret, current_counter + 2),
                },
                expected=204,
            )
        status, _, _ = request(
            "GET",
            "/api/v1/auth/me",
            headers={"authorization": "Bearer " + other["access_token"]},
            ip=self.ip,
        )
        self.assertEqual(status, 401)
        self.assertTrue(self.call("/api/v1/auth/security", who=who)["mfa_enabled"])
        with patch("app.security.account_keys.time.time", return_value=(current_counter + 4) * 30):
            for candidate, expected in [(password, 401), (replacement, 200)]:
                status, _, _ = request(
                    "POST",
                    "/api/v1/auth/login",
                    body={
                        "email": self.contexts[who].user.email,
                        "password": candidate,
                        "otp": totp_code(secret, current_counter + 4),
                    },
                    ip=self.ip,
                )
                self.assertEqual(status, expected)

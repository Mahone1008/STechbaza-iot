"""The printed secret activates a buyer without a registration endpoint."""

import os
import unittest
import uuid
import time
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from sqlalchemy import select

from auth_http_helpers import request
from app.db import SessionLocal
from app.models import AuthSession, Device, User
from app.models.onboarding import AccountSecurity, FactoryController
from app.models.telemetry import DeviceState
from app.security.account_keys import totp_code
from app.security.tokens import utc_now
from app.security.browser_config import AUTH_BROWSER_ORIGINS
from onboarding_helpers import OnboardingFixtures


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires isolated PostgreSQL")
class LabelAccountPostgresTests(OnboardingFixtures, unittest.TestCase):
    def label_login(self, factory, *, qr=False, password=None, expected=200):
        identity = (
            {"controller_id": factory["controller"]["id"]} if qr else {"email": factory["login"]}
        )
        code, result, headers = request(
            "POST",
            "/api/v1/auth/browser/login",
            body={**identity, "password": password or factory["password"]},
            headers={"origin": AUTH_BROWSER_ORIGINS[0], "x-techbaza-csrf": "1"},
            ip=self.ip,
        )
        self.assertEqual(code, expected, result)
        if code == 200:
            with SessionLocal() as session:
                user = session.scalar(select(User).where(User.login_name == factory["login"]))
                if user and user.id not in self.additional_users:
                    self.additional_users.append(user.id)
        return result, headers

    def test_label_password_is_private_and_first_login_does_not_create_device(self):
        factory = self.factory()
        self.assertEqual(factory["activation_code"], factory["password"])
        self.label_login(factory, password="wrong-label-password", expected=401)
        with SessionLocal() as session:
            self.assertIsNone(
                session.scalar(select(User).where(User.login_name == factory["login"]))
            )
        result, headers = self.label_login(factory)
        self.assertEqual(result["onboarding_path"], factory["qr_path"])
        self.assertIn("HttpOnly", str(headers))
        repeated, _ = self.label_login(factory, qr=True)
        with SessionLocal() as session:
            row = session.get(FactoryController, uuid.UUID(factory["controller"]["id"]))
            self.assertIsNotNone(row.buyer_user_id)
            self.assertIsNone(row.device_id)
            self.assertEqual(
                len(list(session.scalars(select(User).where(User.login_name == factory["login"])))),
                1,
            )
        self.assertNotIn(factory["password"], str(result))
        self.assertNotIn(factory["password"], str(repeated))

    def activate(self, factory):
        tokens, _ = self.label_login(factory, qr=True)
        auth = {"authorization": f"Bearer {tokens['access_token']}"}
        path = factory["qr_path"].replace("/connect/", "/api/v1/connect/")
        code, ready, _ = request("GET", path, headers=auth, ip=self.ip)
        self.assertEqual(code, 200, ready)
        self.assertFalse(ready["activation_required"])
        body = {
            "device_name": "Label buyer pump",
            "new_site": {"name": "Label buyer site", "timezone": "Europe/Kyiv"},
        }
        code, _, _ = request("POST", path + "/claim", body=body, headers=auth, ip=self.ip)
        self.assertEqual(code, 422)
        code, access, headers = request("POST", path + "/security", headers=auth, ip=self.ip)
        self.assertEqual(code, 200, access)
        self.assertEqual(headers.get("cache-control"), "no-store")
        self.assertEqual(access["login"], ready["permanent_login"])
        code, _, _ = request(
            "POST",
            "/api/v1/auth/security/totp/confirm",
            body={"otp": totp_code(access["secret"], int(time.time() // 30))},
            headers=auth,
            ip=self.ip,
        )
        self.assertEqual(code, 409)  # Cannot bind MFA to the temporary factory password.
        body.update(
            new_password="Permanent-password-fixture-2026",
            otp=totp_code(access["secret"], int(time.time() // 30)),
        )
        code, _, _ = request(
            "POST",
            path + "/claim",
            body={**body, "new_password": factory["password"]},
            headers=auth,
            ip=self.ip,
        )
        self.assertEqual(code, 422)
        bad = {**body, "otp": str((int(body["otp"]) + 9) % 1000000).zfill(6)}
        code, _, _ = request("POST", path + "/claim", body=bad, headers=auth, ip=self.ip)
        self.assertEqual(code, 422)
        code, claimed, _ = request("POST", path + "/claim", body=body, headers=auth, ip=self.ip)
        self.assertEqual(code, 200, claimed)
        code, repeated, _ = request("POST", path + "/claim", body=body, headers=auth, ip=self.ip)
        self.assertEqual(code, 200, repeated)
        self.assertEqual(claimed["device_id"], repeated["device_id"])
        return auth, claimed, access, body["new_password"]

    def test_qr_activation_exchanges_factory_access_for_password_and_mfa_atomically(self):
        factory = self.factory()
        prior, _ = self.label_login(factory)
        with patch.dict(os.environ, {"AUTH_REQUIRE_PRIVILEGED_MFA": "true"}):
            auth, claimed, access, password = self.activate(factory)
        self.call(
            factory["qr_path"].replace("/connect/", "/api/v1/connect/"), who="other", expected=404
        )
        self.label_login(factory, expected=401)
        self.label_login(factory, qr=True, expected=401)
        code, _, _ = request(
            "GET",
            "/api/v1/auth/me",
            headers={"authorization": f"Bearer {prior['access_token']}"},
            ip=self.ip,
        )
        self.assertEqual(code, 401)
        code, me, _ = request("GET", "/api/v1/auth/me", headers=auth, ip=self.ip)
        self.assertEqual(code, 200, me)
        self.assertEqual(me["login_name"], access["login"])
        self.assertEqual(me["platform_role"], "user")
        self.assertEqual(len(me["memberships"]), 1)
        login = {"email": access["login"], "password": password}
        code, _, _ = request("POST", "/api/v1/auth/login", body=login, ip=self.ip)
        self.assertEqual(code, 401)
        future = (int(time.time() // 30) + 2) * 30
        with patch("app.security.account_keys.time.time", return_value=future):
            login["otp"] = totp_code(access["secret"], int(future // 30))
            code, _, _ = request("POST", "/api/v1/auth/login", body=login, ip=self.ip)
        self.assertEqual(code, 200)
        code, _, _ = request("GET", "/api/v1/auth/security", headers=auth, ip=self.ip)
        self.assertEqual(code, 200)

    def test_factory_reset_invalidates_pending_login_and_sessions(self):
        factory = self.factory()
        tokens, _ = self.label_login(factory)
        new = self.call(
            "/api/v1/factory/controllers/" + factory["controller"]["id"] + "/reset",
            method="POST",
            body={
                "expected_generation": 1,
                "reason": "Unclaimed return",
                "test_reference": "retest",
                "factory_test_passed": True,
            },
        )
        self.label_login(factory, expected=401)
        code, _, _ = request(
            "GET",
            "/api/v1/auth/me",
            headers={"authorization": f"Bearer {tokens['access_token']}"},
            ip=self.ip,
        )
        self.assertEqual(code, 401)
        self.label_login(new)

    def test_transfer_detaches_previous_mfa_and_keeps_each_owners_history_private(self):
        factory = self.factory()
        auth, claimed, access, password = self.activate(factory)
        device_id = uuid.UUID(claimed["device_id"])
        with SessionLocal.begin() as session:
            device = session.get(Device, device_id)
            device.last_seen_at = utc_now()
            session.add(
                DeviceState(
                    device_id=device_id,
                    last_received_at=utc_now(),
                    last_reported_at=utc_now(),
                    state={"pump_running": False, "control_armed": False},
                    values={"vfd.frequency_hz": 0},
                )
            )
        future = (int(time.time() // 30) + 2) * 30
        with patch("app.security.account_keys.time.time", return_value=future):
            code, handover, _ = request(
                "POST",
                factory["qr_path"].replace("/connect/", "/api/v1/connect/") + "/access/release",
                headers=auth,
                ip=self.ip,
                body={
                    "password": password,
                    "otp": totp_code(access["secret"], int(future // 30)),
                    "expected_generation": 1,
                    "expected_credential_revision": 0,
                    "reason": "Sale to another buyer",
                    "stopped_and_isolated": True,
                },
            )
        self.assertEqual(code, 200, handover)
        next_kit = {**handover, "controller": {"id": handover["controller_id"]}}
        new_auth, new_claim, new_access, _ = self.activate(next_kit)
        self.assertNotEqual(access["secret"], new_access["secret"])
        self.assertNotEqual(access["login"], new_access["login"])
        self.assertNotEqual(claimed["device_id"], new_claim["device_id"])
        for headers, device, expected in [
            (auth, claimed["device_id"], 200),
            (new_auth, claimed["device_id"], 404),
            (auth, new_claim["device_id"], 404),
        ]:
            code, _, _ = request(
                "GET", f"/api/v1/devices/{device}/equipment", headers=headers, ip=self.ip
            )
            self.assertEqual(code, expected)
        with SessionLocal() as session:
            old_user = session.scalar(select(User).where(User.login_name == access["login"]))
            self.assertIsNotNone(session.get(AccountSecurity, old_user.id).totp_enabled_at)

    def test_existing_customer_claim_does_not_make_label_a_password_for_their_account(self):
        factory = self.factory()
        path = "/api/v1/connect/" + factory["controller"]["id"]
        self.call(path + "/claim", method="POST", who="other", body=self.claim_body(factory))
        self.label_login(factory, expected=401)
        self.label_login(factory, qr=True, expected=401)
        self.call(path, who="other")

    def test_registration_is_removed_and_auth_requires_browser_proof(self):
        factory = self.factory()
        code, _, _ = request("POST", "/api/v1/auth/register", body={}, ip=self.ip)
        self.assertEqual(code, 404)
        code, _, _ = request(
            "POST",
            "/api/v1/auth/browser/login",
            body={"controller_id": factory["controller"]["id"], "password": factory["password"]},
            ip=self.ip,
        )
        self.assertEqual(code, 403)
        self.call(
            factory["qr_path"].replace("/connect/", "/api/v1/connect/") + "/claim",
            method="POST",
            who="other",
            body={"device_name": "No proof", "new_site": {"name": "No proof site"}},
            expected=404,
        )

    def test_concurrent_first_logins_create_one_identity(self):
        factory = self.factory()
        barrier = Barrier(2)

        def send():
            barrier.wait()
            return request(
                "POST",
                "/api/v1/auth/login",
                body={"email": factory["login"], "password": factory["password"]},
                ip=self.ip,
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: send(), range(2)))
        self.assertEqual([row[0] for row in results], [200, 200])
        with SessionLocal() as session:
            users = list(session.scalars(select(User).where(User.login_name == factory["login"])))
            self.assertEqual(len(users), 1)
            self.additional_users.append(users[0].id)
            self.assertEqual(
                len(
                    list(
                        session.scalars(
                            select(AuthSession).where(AuthSession.user_id == users[0].id)
                        )
                    )
                ),
                2,
            )

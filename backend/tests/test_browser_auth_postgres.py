"""Справжні паролі, JWT, cookie routes та конкурентні auth-ліміти PostgreSQL."""

import os
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier
from unittest.mock import patch

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models.auth_rate_limit import AuthRateLimit
from app.models.auth_session import AuthSession
from app.models.user import User
from app.security.browser_config import AUTH_BROWSER_ORIGINS, REFRESH_COOKIE_NAME
from app.security.passwords import hash_password
from app.security.tokens import decode_access_token, hash_refresh_token, utc_now
from app.services.auth import AuthService, InvalidRefreshTokenError
from app.services.auth_throttle import AuthThrottle, AuthRateLimitedError, rate_key
from auth_http_helpers import request, refresh_cookie

PASSWORD = "Test-only-browser-password!42"
PASSWORD_HASH = hash_password(PASSWORD)


@unittest.skipUnless(os.getenv("TECHBAZA_RUN_DB_TESTS") == "1", "Requires PostgreSQL opt-in")
class BrowserAuthPostgresTests(unittest.TestCase):
    def setUp(self):
        self.user_id = uuid.uuid4()
        self.email = f"browser-{self.user_id.hex}@example.com"
        self.ip = f"198.18.{self.user_id.bytes[0]}.{self.user_id.bytes[1]}"
        self.keys = {rate_key("login-account", self.email), rate_key("login-ip", self.ip),
                     rate_key("session-ip", self.ip)}
        self.addCleanup(self.cleanup_data)
        with SessionLocal() as session:
            session.add(User(id=self.user_id, email=self.email, display_name="Browser test",
                             password_hash=PASSWORD_HASH, platform_role="user", is_active=True))
            session.commit()

    def cleanup_data(self):
        with SessionLocal() as session:
            session.execute(delete(User).where(User.id == self.user_id))
            session.execute(delete(AuthRateLimit).where(AuthRateLimit.key.in_(self.keys)))
            session.commit()

    def call(self, action, *, cookie=None, body=None, expected=200, browser=True, ip=None, extra=None):
        headers = {"origin": AUTH_BROWSER_ORIGINS[0], "x-techbaza-csrf": "1"} if browser else {}
        if cookie:
            headers["cookie"] = f"{REFRESH_COOKIE_NAME}={cookie}"
        headers.update(extra or {})
        path = "/api/v1/auth/" + ("browser/" if browser else "") + action
        result = request("POST", path, headers=headers, body=body, ip=ip or self.ip)
        self.assertEqual(result[0], expected, (path, result))
        self.assertEqual(result[2]["cache-control"], "no-store")
        return result[1], result[2]

    def login(self, **kwargs):
        return self.call("login", body={"email": self.email, "password": PASSWORD}, **kwargs)

    def me(self, access, expected):
        self.assertEqual(request("GET", "/api/v1/auth/me", headers={"authorization": f"Bearer {access}"})[0], expected)

    def test_browser_login_rotation_logout_and_immediate_access_revocation(self):
        first, headers = self.login()
        token = refresh_cookie(headers).value
        self.assertNotIn("refresh_token", first)
        self.assertEqual(headers["access-control-allow-origin"], AUTH_BROWSER_ORIGINS[0])
        self.me(first["access_token"], 200)
        sid = uuid.UUID(decode_access_token(first["access_token"])["sid"])
        with SessionLocal() as session:
            stored = session.get(AuthSession, sid)
            expiry = stored.expires_at
            self.assertEqual(stored.refresh_token_hash, hash_refresh_token(token))
            self.assertNotEqual(stored.refresh_token_hash, token)
        second, headers = self.call("refresh", cookie=token)
        rotated = refresh_cookie(headers).value
        self.assertNotEqual(token, rotated)
        _, denied = self.call("refresh", cookie=token, expected=401)
        self.assertNotIn("set-cookie", denied)
        with SessionLocal() as session:
            self.assertEqual(session.get(AuthSession, sid).expires_at, expiry)
        _, headers = self.call("logout", cookie=rotated, expected=204)
        self.assertEqual(refresh_cookie(headers)["max-age"], "0")
        self.me(first["access_token"], 401)
        self.me(second["access_token"], 401)
        self.call("refresh", cookie=rotated, expected=401)
        self.call("logout", cookie=rotated, expected=204)
        self.call("logout", expected=204)

    def test_bad_credentials_unknown_email_and_disabled_user(self):
        unknown = f"missing-{uuid.uuid4().hex}@example.com"
        self.keys.add(rate_key("login-account", unknown))
        a, _ = self.call("login", body={"email": self.email, "password": "wrong"}, expected=401)
        b, _ = self.call("login", body={"email": unknown, "password": "wrong"}, expected=401)
        self.assertEqual(a, b)
        with SessionLocal() as session:
            session.get(User, self.user_id).is_active = False
            session.commit()
        self.login(expected=403)
        with SessionLocal() as session:
            self.assertIsNone(session.scalar(select(AuthSession.id).where(AuthSession.user_id == self.user_id)))

    def test_expired_session_and_disabled_account_cannot_refresh(self):
        for disabled in (False, True):
            first, headers = self.login()
            token = refresh_cookie(headers).value
            sid = uuid.UUID(decode_access_token(first["access_token"])["sid"])
            with SessionLocal() as session:
                if disabled:
                    session.get(User, self.user_id).is_active = False
                else:
                    session.get(AuthSession, sid).expires_at = utc_now() - timedelta(seconds=1)
                session.commit()
            self.call("refresh", cookie=token, expected=403 if disabled else 401)
            self.me(first["access_token"], 401)

    def test_login_again_revokes_previous_browser_session(self):
        first, headers = self.login()
        second, _ = self.login(cookie=refresh_cookie(headers).value)
        self.me(first["access_token"], 401)
        self.me(second["access_token"], 200)

    def test_no_cookie_refresh_and_cookie_does_not_authorize_regular_api(self):
        self.call("refresh", expected=401)
        self.call("refresh", cookie="short", expected=401)
        _, headers = self.login()
        cookie = refresh_cookie(headers).value
        self.assertEqual(request("GET", "/api/v1/auth/me",
                                headers={"cookie": f"{REFRESH_COOKIE_NAME}={cookie}"})[0], 401)

    def test_legacy_flow_still_rotates_and_revokes(self):
        first, headers = self.login(browser=False)
        self.assertNotIn("set-cookie", headers)
        second, _ = self.call("refresh", body={"refresh_token": first["refresh_token"]}, browser=False)
        self.call("refresh", body={"refresh_token": first["refresh_token"]}, browser=False, expected=401)
        self.call("logout", body={"refresh_token": second["refresh_token"]}, browser=False, expected=204)
        self.me(second["access_token"], 401)

    def test_account_throttle_shared_across_routes_and_expires(self):
        with patch("app.services.auth_throttle.AUTH_LOGIN_ACCOUNT_LIMIT", 2):
            for browser in (True, False):
                self.call("login", browser=browser, body={"email": self.email.upper(), "password": "bad"}, expected=401)
            _, headers = self.login(expected=429)
            self.assertGreater(int(headers["retry-after"]), 0)
            with SessionLocal() as session:
                row = session.get(AuthRateLimit, rate_key("login-account", self.email))
                row.expires_at = utc_now() - timedelta(seconds=1)
                session.commit()
            self.login()

    def test_ip_throttle_ignores_spoofed_forwarded_header_and_limits_refresh(self):
        with patch("app.services.auth_throttle.AUTH_LOGIN_IP_LIMIT", 1):
            self.login(extra={"x-forwarded-for": "1.2.3.4"})
            self.login(extra={"x-forwarded-for": "5.6.7.8"}, expected=429)
        with patch("app.services.auth_throttle.AUTH_SESSION_IP_LIMIT", 1):
            self.call("refresh", expected=401)
            self.call("refresh", expected=429)

    def test_concurrent_throttle_allows_exact_limit_across_sessions(self):
        barrier = Barrier(6)

        def attempt(_):
            with SessionLocal() as session:
                barrier.wait(timeout=10)
                try:
                    AuthThrottle(session).check(self.ip, email=self.email)
                    return True
                except AuthRateLimitedError:
                    return False

        with patch("app.services.auth_throttle.AUTH_LOGIN_ACCOUNT_LIMIT", 3):
            with ThreadPoolExecutor(max_workers=6) as pool:
                results = list(pool.map(attempt, range(6)))
        self.assertEqual(sum(results), 3)

    def test_concurrent_refresh_has_one_winner(self):
        _, headers = self.login()
        token = refresh_cookie(headers).value
        barrier = Barrier(2)

        def refresh(_):
            with SessionLocal() as session:
                barrier.wait(timeout=10)
                try:
                    return AuthService(session).refresh(token)
                except InvalidRefreshTokenError:
                    return None

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(refresh, range(2)))
        winners = [r for r in results if r is not None]
        self.assertEqual(len(winners), 1)
        self.call("refresh", cookie=winners[0].refresh_token)

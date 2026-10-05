"""Контракт, CORS, CSRF та cookie без PostgreSQL."""

import unittest
from unittest.mock import patch

from fastapi import Response
from sqlalchemy.exc import OperationalError

from app.main import app
from app.security.browser_config import parse_origins, AUTH_BROWSER_ORIGINS, REFRESH_COOKIE_PATH
from app.security.browser_auth import set_refresh_cookie, clear_refresh_cookie
from auth_http_helpers import request, refresh_cookie


class BrowserAuthTests(unittest.TestCase):
    def test_config_rejects_unsafe_origins(self):
        self.assertEqual(parse_origins("https://app.example.com", secure=True), ("https://app.example.com",))
        self.assertEqual(parse_origins("http://127.0.0.1:3000", secure=False), ("http://127.0.0.1:3000",))
        self.assertEqual(parse_origins("", secure=True), ())
        for origin in ("*", "null", "https://*.example.com", "https://app.example.com/",
                       "https://user:pass@app.example.com", "http://app.example.com",
                       "https://app.example.com?q=1"):
            with self.subTest(origin=origin), self.assertRaises((RuntimeError, ValueError)):
                parse_origins(origin, secure=True)
        with self.assertRaises(RuntimeError):
            parse_origins("https://app.example.com", secure=False)

    def test_csrf_rejects_missing_null_or_foreign_origin_and_simple_requests(self):
        origin = AUTH_BROWSER_ORIGINS[0]
        for route in ("login", "refresh", "logout"):
            for headers in ({}, {"origin": "null", "x-techbaza-csrf": "1"},
                            {"origin": "https://evil.example", "x-techbaza-csrf": "1"},
                            {"origin": origin}, {"origin": origin, "x-techbaza-csrf": "wrong"}):
                code, result, response = request("POST", f"/api/v1/auth/browser/{route}",
                    headers=headers, body={"email": "user@example.com", "password": "test"})
                self.assertEqual(code, 403)
                self.assertEqual(response["cache-control"], "no-store")
                self.assertNotIn("set-cookie", response)

    def test_cors_preflight_is_exact_and_credentialed(self):
        for origin in AUTH_BROWSER_ORIGINS:
            headers = {"origin": origin, "access-control-request-method": "POST",
                       "access-control-request-headers": "content-type,x-techbaza-csrf"}
            code, _, response = request("OPTIONS", "/api/v1/auth/browser/login", headers=headers)
            self.assertEqual(code, 200)
            self.assertEqual(response["access-control-allow-origin"], origin)
            self.assertEqual(response["access-control-allow-credentials"], "true")
            headers["origin"] = origin + ".evil.example"
            code, _, response = request("OPTIONS", "/api/v1/auth/browser/login", headers=headers)
            self.assertEqual(code, 400)
            self.assertNotIn("access-control-allow-origin", response)

    def test_cookie_flags_scope_and_deletion_match(self):
        for secure in (True, False):
            with patch("app.security.browser_auth.AUTH_COOKIE_SECURE", secure):
                response = Response()
                set_refresh_cookie(response, "random-secret", 100)
                cookie = refresh_cookie(response.headers)
                self.assertEqual(cookie["path"], REFRESH_COOKIE_PATH)
                self.assertTrue(cookie["httponly"])
                self.assertEqual(cookie["samesite"], "strict")
                self.assertEqual(bool(cookie["secure"]), secure)
                self.assertEqual(cookie["domain"], "")
                clear = Response()
                clear_refresh_cookie(clear)
                removed = refresh_cookie(clear.headers)
                self.assertEqual(removed["path"], cookie["path"])
                self.assertEqual(removed["max-age"], "0")

    def test_openapi_excludes_refresh_and_validation_does_not_echo_secrets(self):
        schema = app.openapi()["components"]["schemas"]["BrowserTokenResponse"]["properties"]
        self.assertNotIn("refresh_token", schema)
        secret = "sensitive-secret" * 20
        for path in ("/api/v1/auth/login", "/api/v1/auth/browser/login"):
            code, result, response = request("POST", path, body={"email": "bad", "password": secret},
                headers={"origin": AUTH_BROWSER_ORIGINS[0], "x-techbaza-csrf": "1"})
            self.assertEqual(code, 422)
            self.assertNotIn(secret, str(result))
            self.assertEqual(response["cache-control"], "no-store")

    def test_limiter_storage_failure_denies_login(self):
        with patch("app.api.auth_throttle.AuthThrottle.check", side_effect=OperationalError("test", {}, Exception())):
            code, _, response = request("POST", "/api/v1/auth/login",
                body={"email": "user@example.com", "password": "test"})
        self.assertEqual(code, 503)
        self.assertEqual(response["cache-control"], "no-store")

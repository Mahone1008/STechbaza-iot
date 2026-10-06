"""Явні origins та параметри cookie для браузерного клієнта."""

import os
from urllib.parse import urlsplit

from app.security.auth_config import AUTH_ACCESS_TOKEN_SECRET


def parse_origins(value: str, *, secure: bool) -> tuple[str, ...]:
    origins = tuple(dict.fromkeys(item.strip() for item in value.split(",") if item.strip()))
    for origin in origins:
        parsed = urlsplit(origin)
        if (parsed.scheme not in ("http", "https") or not parsed.hostname
                or parsed.username or parsed.password or parsed.path
                or parsed.query or parsed.fragment or "*" in origin):
            raise RuntimeError("AUTH_BROWSER_ORIGINS: потрібні точні origins без path або wildcard")
        # Незахищений HTTP дозволений лише для локального стенду.
        if (not secure or parsed.scheme == "http") and parsed.hostname not in (
            "localhost", "127.0.0.1", "::1",
        ):
            raise RuntimeError("Публічний браузерний origin потребує HTTPS та Secure cookie")
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            raise RuntimeError("Некоректний port браузерного origin")
    return origins


_secure_value = os.getenv("AUTH_COOKIE_SECURE", "true").lower()
if _secure_value not in ("true", "false"):
    raise RuntimeError("AUTH_COOKIE_SECURE має бути true або false")
AUTH_COOKIE_SECURE = _secure_value == "true"
AUTH_BROWSER_ORIGINS = parse_origins(
    os.getenv("AUTH_BROWSER_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"),
    secure=AUTH_COOKIE_SECURE,
)
if any(urlsplit(origin).hostname not in ("localhost", "127.0.0.1", "::1")
       for origin in AUTH_BROWSER_ORIGINS) and AUTH_ACCESS_TOKEN_SECRET in (
    "techbaza-local-development-only-secret-change-before-production",
    "replace_with_a_long_random_secret_for_local_development",
):
    raise RuntimeError("Публічний браузерний origin потребує власного випадкового AUTH_ACCESS_TOKEN_SECRET")
from app.security.plane import APP_PLANE
REFRESH_COOKIE_NAME = "kerumo_staff_refresh" if APP_PLANE == "staff" else "techbaza_refresh"
REFRESH_COOKIE_PATH = "/api/v1/auth/browser"
CSRF_HEADER = "X-TechBaza-CSRF"


def positive_setting(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if not 1 <= value <= 1_000_000:
        raise RuntimeError(f"{name} має бути від 1 до 1000000")
    return value


AUTH_RATE_WINDOW_SECONDS = positive_setting("AUTH_RATE_WINDOW_SECONDS", 300)
AUTH_LOGIN_IP_LIMIT = positive_setting("AUTH_LOGIN_IP_LIMIT", 30)
AUTH_LOGIN_ACCOUNT_LIMIT = positive_setting("AUTH_LOGIN_ACCOUNT_LIMIT", 10)
AUTH_SESSION_IP_LIMIT = positive_setting("AUTH_SESSION_IP_LIMIT", 120)

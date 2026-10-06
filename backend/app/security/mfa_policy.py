"""Privileged MFA is mandatory on public origins; local acceptance can opt in."""

import os
from app.security.plane import APP_PLANE
from urllib.parse import urlsplit
from fastapi import HTTPException
from app.security.browser_config import AUTH_BROWSER_ORIGINS


def privileged_mfa_required(current) -> bool:
    return current.user.platform_role in ("superadmin", "service_admin")


def require_privileged_mfa(current):
    public = any(
        urlsplit(origin).hostname not in ("localhost", "127.0.0.1", "::1")
        for origin in AUTH_BROWSER_ORIGINS
    )
    enforced = APP_PLANE == "staff" or public or os.getenv("AUTH_REQUIRE_PRIVILEGED_MFA", "false").lower() == "true"
    if (
        privileged_mfa_required(current)
        and enforced
        and current.auth_session.mfa_verified_at is None
    ):
        raise HTTPException(
            403,
            "Потрібен двоетапний вхід. Відкрийте «Безпека облікового запису», налаштуйте його та увійдіть із кодом",
        )

"""Privileged MFA is mandatory on public origins; local acceptance can opt in."""
import os
from urllib.parse import urlsplit
from fastapi import HTTPException
from app.security.browser_config import AUTH_BROWSER_ORIGINS


def privileged_mfa_required() -> bool:
    public = any(urlsplit(origin).hostname not in ("localhost", "127.0.0.1", "::1") for origin in AUTH_BROWSER_ORIGINS)
    return public or os.getenv("AUTH_REQUIRE_PRIVILEGED_MFA", "false").lower() == "true"


def require_privileged_mfa(current, organization_role=None):
    privileged = current.user.platform_role in ("superadmin", "service_admin") or organization_role in ("owner", "admin", "service")
    if privileged and privileged_mfa_required() and current.auth_session.mfa_verified_at is None:
        raise HTTPException(403, "Потрібен двоетапний вхід. Відкрийте «Безпека облікового запису», налаштуйте його та увійдіть із кодом")

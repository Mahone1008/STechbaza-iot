import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from app.security.auth_config import (
    AUTH_ACCESS_TOKEN_ALGORITHM,
    AUTH_ACCESS_TOKEN_SECRET,
    AUTH_ACCESS_TOKEN_TTL_SECONDS,
    AUTH_REFRESH_TOKEN_TTL_SECONDS,
    AUTH_TOKEN_AUDIENCE,
    AUTH_TOKEN_ISSUER,
)


@dataclass(frozen=True)
class AccessTokenData:
    token: str
    expires_in: int


@dataclass(frozen=True)
class RefreshTokenData:
    token: str
    token_hash: str
    expires_at: datetime
    expires_in: int


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(
    *,
    user_id: uuid.UUID,
    auth_session_id: uuid.UUID,
) -> AccessTokenData:
    """Створює короткоживучий signed JWT access token."""

    now = utc_now()
    expires_at = now + timedelta(seconds=AUTH_ACCESS_TOKEN_TTL_SECONDS)

    payload: dict[str, Any] = {
        "sub": str(user_id),
        "sid": str(auth_session_id),
        "type": "access",
        "jti": str(uuid.uuid4()),
        "iss": AUTH_TOKEN_ISSUER,
        "aud": AUTH_TOKEN_AUDIENCE,
        "iat": now,
        "nbf": now,
        "exp": expires_at,
    }

    token = jwt.encode(
        payload,
        AUTH_ACCESS_TOKEN_SECRET,
        algorithm=AUTH_ACCESS_TOKEN_ALGORITHM,
    )

    return AccessTokenData(
        token=token,
        expires_in=AUTH_ACCESS_TOKEN_TTL_SECONDS,
    )


def decode_access_token(token: str) -> dict[str, Any]:
    """Перевіряє signature, issuer, audience та expiry access token."""

    return jwt.decode(
        token,
        AUTH_ACCESS_TOKEN_SECRET,
        algorithms=[AUTH_ACCESS_TOKEN_ALGORITHM],
        audience=AUTH_TOKEN_AUDIENCE,
        issuer=AUTH_TOKEN_ISSUER,
        options={"require": ["sub", "sid", "type", "iat", "exp"]},
    )


def create_refresh_token() -> RefreshTokenData:
    """Створює opaque refresh token; у БД зберігається лише hash."""

    token = secrets.token_urlsafe(48)
    now = utc_now()
    expires_at = now + timedelta(seconds=AUTH_REFRESH_TOKEN_TTL_SECONDS)

    return RefreshTokenData(
        token=token,
        token_hash=hash_refresh_token(token),
        expires_at=expires_at,
        expires_in=AUTH_REFRESH_TOKEN_TTL_SECONDS,
    )


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

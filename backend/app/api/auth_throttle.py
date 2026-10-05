"""Shared HTTP adapter for authentication request limits."""

from fastapi import HTTPException, Request
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from app.services.auth_throttle import AuthThrottle, AuthRateLimitedError


def throttle_auth(request: Request, session: Session, *, email: str | None = None) -> None:
    # Беремо peer ASGI; довіра до proxy headers налаштовується лише на сервері.
    ip = request.client.host if request.client else "unknown-peer"
    try:
        AuthThrottle(session).check(ip, email=email)
    except AuthRateLimitedError as exc:
        raise HTTPException(
            429,
            "Забагато auth-спроб. Спробуйте пізніше",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(503, "Auth storage тимчасово недоступне") from exc

"""Shared HTTP adapter for authentication request limits."""

from fastapi import HTTPException, Request
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from app.services.auth_throttle import AuthThrottle, AuthRateLimitedError
from app.services.auth_throttle import rate_key
from app.repositories.auth_rate_limits import AuthRateLimitRepository


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


def throttle_bootstrap(request: Request, session: Session, controller_id) -> None:
    """Періодичний device polling не витрачає ліміт входу користувачів."""
    ip = request.client.host if request.client else "unknown-peer"
    repository = AuthRateLimitRepository(session)
    try:
        limited = None
        for scope, identity, limit in (("bootstrap-peer", ip, 600), ("bootstrap-device", str(controller_id), 12)):
            count, retry = repository.consume(rate_key(scope, identity), 60, limit)
            if count > limit:
                limited = retry
                break
        session.commit()
        if limited is not None:
            raise HTTPException(429, "Повторіть підключення пізніше", headers={"Retry-After": str(limited)})
    except SQLAlchemyError as exc:
        session.rollback()
        raise HTTPException(503, "Auth storage тимчасово недоступне") from exc

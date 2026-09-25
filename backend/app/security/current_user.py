import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import InvalidTokenError
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.models.auth_session import AuthSession
from app.models.user import User
from app.repositories.auth_sessions import AuthSessionRepository
from app.repositories.users import UserRepository
from app.security.tokens import decode_access_token, utc_now


_bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUserContext:
    """Перевірена identity поточного HTTP request."""

    user: User
    auth_session: AuthSession


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Потрібна дійсна authentication session",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user_context(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(_bearer_scheme),
    ],
    session: Annotated[Session, Depends(get_db_session)],
) -> CurrentUserContext:
    """Перевіряє JWT та server-side auth session.

    Logout/revocation має ефект одразу, навіть якщо access JWT ще не
    завершив свій короткий lifetime.
    """

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized()

    try:
        claims = decode_access_token(credentials.credentials)
    except InvalidTokenError as exc:
        raise _unauthorized() from exc

    if claims.get("type") != "access":
        raise _unauthorized()

    try:
        user_id = uuid.UUID(str(claims["sub"]))
        auth_session_id = uuid.UUID(str(claims["sid"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise _unauthorized() from exc

    auth_session = AuthSessionRepository(session).get(auth_session_id)
    if (
        auth_session is None
        or auth_session.user_id != user_id
        or auth_session.revoked_at is not None
        or auth_session.expires_at <= utc_now()
    ):
        raise _unauthorized()

    user = UserRepository(session).get(user_id)
    if user is None:
        raise _unauthorized()

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Обліковий запис вимкнено",
        )

    return CurrentUserContext(
        user=user,
        auth_session=auth_session,
    )

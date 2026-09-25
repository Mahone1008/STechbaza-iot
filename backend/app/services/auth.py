import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.auth_session import AuthSession
from app.repositories.auth_sessions import AuthSessionRepository
from app.repositories.users import UserRepository
from app.schemas.auth import LoginRequest
from app.security.passwords import (
    hash_password,
    password_hash_needs_rehash,
    verify_password,
)
from app.security.tokens import (
    create_access_token,
    create_refresh_token,
    hash_refresh_token,
    utc_now,
)


_DUMMY_PASSWORD_HASH = hash_password("TechBaza-Dummy-Password-2026!")


class InvalidCredentialsError(Exception):
    """Email або password не пройшли authentication."""


class InactiveUserError(Exception):
    """User існує, але account вимкнено."""


class InvalidRefreshTokenError(Exception):
    """Refresh token невідомий, revoked або expired."""


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    access_expires_in: int
    refresh_token: str
    refresh_expires_in: int


class AuthService:
    """Login, refresh rotation та logout для server-side auth sessions."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._users = UserRepository(session)
        self._auth_sessions = AuthSessionRepository(session)

    def login(self, payload: LoginRequest) -> TokenPair:
        email = str(payload.email).strip().lower()
        user = self._users.get_by_email(email)

        if user is None:
            # Dummy verify зменшує timing-різницю між unknown email і bad password.
            verify_password(payload.password, _DUMMY_PASSWORD_HASH)
            raise InvalidCredentialsError

        if not verify_password(payload.password, user.password_hash):
            raise InvalidCredentialsError

        if not user.is_active:
            raise InactiveUserError

        now = utc_now()

        if password_hash_needs_rehash(user.password_hash):
            user.password_hash = hash_password(payload.password)

        refresh = create_refresh_token()
        auth_session = AuthSession(
            id=uuid.uuid4(),
            user_id=user.id,
            refresh_token_hash=refresh.token_hash,
            expires_at=refresh.expires_at,
        )

        user.last_login_at = now
        self._auth_sessions.add(auth_session)
        self._session.commit()

        access = create_access_token(
            user_id=user.id,
            auth_session_id=auth_session.id,
        )

        return TokenPair(
            access_token=access.token,
            access_expires_in=access.expires_in,
            refresh_token=refresh.token,
            refresh_expires_in=refresh.expires_in,
        )

    def refresh(self, refresh_token: str) -> TokenPair:
        token_hash = hash_refresh_token(refresh_token)
        auth_session = self._auth_sessions.get_by_refresh_hash_for_update(
            token_hash
        )

        if auth_session is None:
            self._session.rollback()
            raise InvalidRefreshTokenError

        now = utc_now()

        if (
            auth_session.revoked_at is not None
            or auth_session.expires_at <= now
        ):
            self._session.rollback()
            raise InvalidRefreshTokenError

        user = self._users.get(auth_session.user_id)
        if user is None:
            self._session.rollback()
            raise InvalidRefreshTokenError

        if not user.is_active:
            auth_session.revoked_at = now
            self._session.commit()
            raise InactiveUserError

        # Refresh rotation: старий secret перестає працювати відразу після commit.
        rotated_refresh = create_refresh_token(
            expires_at=auth_session.expires_at
        )
        auth_session.refresh_token_hash = rotated_refresh.token_hash
        auth_session.last_used_at = now
        self._session.commit()

        access = create_access_token(
            user_id=user.id,
            auth_session_id=auth_session.id,
        )

        return TokenPair(
            access_token=access.token,
            access_expires_in=access.expires_in,
            refresh_token=rotated_refresh.token,
            refresh_expires_in=rotated_refresh.expires_in,
        )

    def logout(self, refresh_token: str) -> None:
        token_hash = hash_refresh_token(refresh_token)
        auth_session = self._auth_sessions.get_by_refresh_hash_for_update(
            token_hash
        )

        # Logout навмисно idempotent: unknown token не розкриває session state.
        if auth_session is None:
            self._session.rollback()
            return

        if auth_session.revoked_at is None:
            auth_session.revoked_at = utc_now()

        self._session.commit()

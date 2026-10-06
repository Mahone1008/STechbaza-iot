import uuid
from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from app.models.user import User
from app.security.plane import APP_PLANE, STAFF_ROLES
from app.security.auth_config import AUTH_TOKEN_AUDIENCE
from app.models.onboarding import AccountSecurity, FactoryController
from app.security.account_keys import verify_stored_totp
from app.services.label_accounts import create_label_account, label_session_valid

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


class MfaRequiredError(InvalidCredentialsError):
    """Пароль перевірено; для завершення входу потрібен другий фактор."""


class InvalidMfaCodeError(InvalidCredentialsError):
    """Пароль перевірено, але код другого фактора не прийнято."""


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
    onboarding_path: str | None = None


class AuthService:
    """Login, refresh rotation та logout для server-side auth sessions."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._users = UserRepository(session)
        self._auth_sessions = AuthSessionRepository(session)

    def login(self, payload: LoginRequest, *, client_ip: str | None = None, user_agent: str | None = None) -> TokenPair:
        login = str(payload.email or "").strip().lower()
        if payload.controller_id:
            factory = self._session.get(FactoryController, payload.controller_id)
            if factory is None or factory.status != "ready" or not factory.buyer_login:
                verify_password(payload.password, _DUMMY_PASSWORD_HASH)
                raise InvalidCredentialsError
            login = factory.buyer_login
        user = self._session.scalar(
            select(User).where(or_(User.email == login, User.login_name == login)).with_for_update()
        )
        if user is None and APP_PLANE != "staff":
            user = create_label_account(self._session, login, payload.password)

        if user is None:
            # Dummy verify зменшує timing-різницю між unknown email і bad password.
            verify_password(payload.password, _DUMMY_PASSWORD_HASH)
            raise InvalidCredentialsError

        if not verify_password(payload.password, user.password_hash):
            raise InvalidCredentialsError

        if (APP_PLANE == "staff" and user.platform_role not in STAFF_ROLES) or (APP_PLANE == "customer" and user.platform_role in STAFF_ROLES):
            raise InvalidCredentialsError

        if not user.is_active:
            raise InactiveUserError

        if not label_session_valid(self._session, user):
            raise InvalidCredentialsError
        security = self._session.scalar(
            select(AccountSecurity).where(AccountSecurity.user_id == user.id).with_for_update()
        )
        mfa_verified = False
        if security and security.totp_enabled_at:
            if not payload.otp:
                raise MfaRequiredError
            counter, encrypted = verify_stored_totp(
                security.totp_secret, payload.otp, security.totp_last_counter
            )
            if counter is None:
                raise InvalidMfaCodeError
            security.totp_last_counter, security.totp_secret = counter, encrypted
            mfa_verified = True
        now = utc_now()

        if password_hash_needs_rehash(user.password_hash):
            user.password_hash = hash_password(payload.password)

        refresh = create_refresh_token()
        auth_session = AuthSession(
            id=uuid.uuid4(),
            user_id=user.id,
            refresh_token_hash=refresh.token_hash,
            audience=AUTH_TOKEN_AUDIENCE,
            client_ip=(client_ip or "")[:64] or None,
            user_agent=(user_agent or "")[:240] or None,
            expires_at=refresh.expires_at,
            mfa_verified_at=now if mfa_verified else None,
        )

        user.last_login_at = now
        self._auth_sessions.add(auth_session)
        self._session.commit()

        pending = None
        if user.login_name and user.login_name.startswith("kr-"):
            pending = self._session.scalar(
                select(FactoryController.id)
                .where(FactoryController.buyer_user_id == user.id, FactoryController.status == "ready")
                .limit(1)
            )

        access = create_access_token(
            user_id=user.id,
            auth_session_id=auth_session.id,
        )

        return TokenPair(
            access_token=access.token,
            access_expires_in=access.expires_in,
            refresh_token=refresh.token,
            refresh_expires_in=refresh.expires_in,
            onboarding_path=f"/connect/{pending}" if pending else None,
        )

    def refresh(self, refresh_token: str) -> TokenPair:
        token_hash = hash_refresh_token(refresh_token)
        auth_session = self._auth_sessions.get_by_refresh_hash_for_update(token_hash)

        if auth_session is None or auth_session.audience != AUTH_TOKEN_AUDIENCE:
            self._session.rollback()
            raise InvalidRefreshTokenError

        now = utc_now()

        if auth_session.revoked_at is not None or auth_session.expires_at <= now:
            self._session.rollback()
            raise InvalidRefreshTokenError

        user = self._users.get(auth_session.user_id)
        if user is None:
            self._session.rollback()
            raise InvalidRefreshTokenError

        if not user.is_active or (APP_PLANE == "staff" and user.platform_role not in STAFF_ROLES):
            auth_session.revoked_at = now
            self._session.commit()
            raise InactiveUserError

        if not label_session_valid(self._session, user):
            auth_session.revoked_at = now
            self._session.commit()
            raise InvalidRefreshTokenError

        # Refresh rotation: старий secret перестає працювати відразу після commit.
        rotated_refresh = create_refresh_token(expires_at=auth_session.expires_at)
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
        auth_session = self._auth_sessions.get_by_refresh_hash_for_update(token_hash)

        # Logout навмисно idempotent: unknown token не розкриває session state.
        if auth_session is None or auth_session.audience != AUTH_TOKEN_AUDIENCE:
            self._session.rollback()
            return

        if auth_session.revoked_at is None:
            auth_session.revoked_at = utc_now()

        self._session.commit()

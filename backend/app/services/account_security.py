"""Account operations own their locks and transactions; HTTP stays in the API."""

import base64
import secrets
import uuid
from urllib.parse import quote

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.models import AuthSession, User
from app.models.onboarding import AccountSecurity, FactoryController
from app.schemas.onboarding import (
    RecoveryRead,
    RecoveryRequest,
    PasswordChange,
    ActivationAccessRead,
    SecurityProof,
    SecurityRead,
    SessionRead,
    TotpSetupRead,
)
from app.security.account_keys import digest, new_key, secret_box, verify_digest, verify_stored_totp
from app.security.current_user import CurrentUserContext
from app.security.mfa_policy import privileged_mfa_required
from app.security.passwords import hash_password, verify_password
from app.security.tokens import utc_now
from app.services.label_accounts import permanent_login


class AccountSecurityConflict(Exception):
    pass


class InvalidAccountProof(Exception):
    pass


class AccountSecurityService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def _locked_security(self, user_id: uuid.UUID) -> AccountSecurity:
        # Same user -> security lock order as login and account recovery.
        self._session.scalar(select(User.id).where(User.id == user_id).with_for_update())
        row = self._session.scalar(
            select(AccountSecurity)
            .where(AccountSecurity.user_id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if row is None:
            row = AccountSecurity(user_id=user_id)
            self._session.add(row)
            self._session.flush()
        return row

    def _prove(self, current: CurrentUserContext, proof: SecurityProof) -> AccountSecurity:
        row = self._locked_security(current.user.id)
        user = self._session.get(User, current.user.id, populate_existing=True)
        if (
            user is None
            or not user.is_active
            or (user.login_name and user.login_name.startswith("kr-"))
            or not verify_password(proof.password, user.password_hash)
        ):
            raise InvalidAccountProof("Не вдалося підтвердити облікові дані")
        if row.totp_enabled_at:
            counter, encrypted = verify_stored_totp(
                row.totp_secret, proof.otp or "", row.totp_last_counter
            )
            if counter is None:
                raise InvalidAccountProof("Введіть новий код із застосунку автентифікації")
            row.totp_last_counter, row.totp_secret = counter, encrypted
        return row

    def prepare_activation(
        self, current: CurrentUserContext, controller_id: uuid.UUID
    ) -> ActivationAccessRead:
        row = self._locked_security(current.user.id)
        factory = self._session.scalar(
            select(FactoryController)
            .where(
                FactoryController.id == controller_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if (
            factory is None
            or factory.status != "ready"
            or factory.buyer_user_id != current.user.id
            or current.user.login_name != factory.buyer_login
            or row.totp_enabled_at
        ):
            raise AccountSecurityConflict("Налаштування доступне лише під час першої активації")
        secret = base64.b32encode(secrets.token_bytes(20)).decode()
        recovery = new_key()
        row.totp_secret = secret_box().encrypt(secret.encode()).decode()
        row.totp_last_counter = None
        row.recovery_hash = digest("recovery", recovery)
        self._session.commit()
        login = permanent_login(current.user)
        label = quote("KERUMO:" + login, safe="")
        return ActivationAccessRead(
            login=login,
            secret=secret,
            recovery_key=recovery,
            uri=f"otpauth://totp/{label}?secret={secret}&issuer=KERUMO&algorithm=SHA1&digits=6&period=30",
        )

    def prove(self, current: CurrentUserContext, proof: SecurityProof) -> None:
        self._prove(current, proof)

    def recover(self, payload: RecoveryRequest) -> RecoveryRead:
        user = self._session.scalar(
            select(User)
            .where(
                or_(
                    User.email == payload.email.strip().lower(),
                    User.login_name == payload.email.strip().lower(),
                )
            )
            .with_for_update()
        )
        row = self._locked_security(user.id) if user else None
        valid = verify_digest("recovery", payload.recovery_key, row.recovery_hash if row else None)
        if (
            user is None
            or not user.is_active
            or row is None
            or not valid
            or (user.login_name and user.login_name.startswith("kr-"))
        ):
            raise InvalidAccountProof("Не вдалося підтвердити ключ відновлення")
        key = new_key()
        user.password_hash = hash_password(payload.new_password)
        row.recovery_hash = digest("recovery", key)
        row.totp_secret, row.totp_enabled_at, row.totp_last_counter = None, None, None
        self._session.execute(
            update(AuthSession)
            .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=utc_now())
        )
        self._session.commit()
        return RecoveryRead(recovery_key=key)

    def read(self, current: CurrentUserContext) -> SecurityRead:
        row = self._session.get(AccountSecurity, current.user.id)
        return SecurityRead(
            mfa_enabled=bool(row and row.totp_enabled_at),
            privileged_mfa_required=privileged_mfa_required(),
            current_session_verified=current.auth_session.mfa_verified_at is not None,
            recovery_available=bool(row and row.recovery_hash),
        )

    def rotate_recovery(self, current: CurrentUserContext, proof: SecurityProof) -> RecoveryRead:
        row = self._prove(current, proof)
        key = new_key()
        row.recovery_hash = digest("recovery", key)
        self._session.commit()
        return RecoveryRead(recovery_key=key)

    def setup_totp(self, current: CurrentUserContext, proof: SecurityProof) -> TotpSetupRead:
        row = self._prove(current, proof)
        if row.totp_enabled_at:
            raise AccountSecurityConflict("Двоетапний вхід уже налаштовано")
        secret = base64.b32encode(secrets.token_bytes(20)).decode()
        row.totp_secret = secret_box().encrypt(secret.encode()).decode()
        row.totp_last_counter = None
        self._session.commit()
        label = quote("KERUMO:" + (current.user.login_name or current.user.email), safe="")
        return TotpSetupRead(
            secret=secret,
            uri=(
                f"otpauth://totp/{label}?secret={secret}&issuer=KERUMO&algorithm=SHA1&digits=6&period=30"
            ),
        )

    def confirm_totp(self, current: CurrentUserContext, otp: str) -> None:
        row = self._locked_security(current.user.id)
        if current.user.login_name and current.user.login_name.startswith("kr-"):
            raise AccountSecurityConflict(
                "Підтвердьте код у майстрі активації разом із постійним паролем"
            )
        if not row.totp_secret or row.totp_enabled_at:
            raise AccountSecurityConflict("Почніть налаштування двоетапного входу")
        counter, encrypted = verify_stored_totp(row.totp_secret, otp, row.totp_last_counter)
        if counter is None:
            raise InvalidAccountProof("Код не підтверджено")
        row.totp_last_counter, row.totp_enabled_at, row.totp_secret = counter, utc_now(), encrypted
        # A stolen pre-MFA session cannot survive enrollment.
        self._session.execute(
            update(AuthSession)
            .where(
                AuthSession.user_id == current.user.id,
                AuthSession.id != current.auth_session.id,
                AuthSession.revoked_at.is_(None),
            )
            .values(revoked_at=utc_now())
        )
        current.auth_session.mfa_verified_at = utc_now()
        self._session.commit()

    def change_password(self, current: CurrentUserContext, payload: PasswordChange) -> None:
        self._prove(current, payload)
        user = self._session.get(User, current.user.id)
        if user is None:
            raise InvalidAccountProof("Не вдалося підтвердити облікові дані")
        user.password_hash = hash_password(payload.new_password)
        self._session.execute(
            update(AuthSession)
            .where(
                AuthSession.user_id == user.id,
                AuthSession.id != current.auth_session.id,
                AuthSession.revoked_at.is_(None),
            )
            .values(revoked_at=utc_now())
        )
        self._session.commit()

    def list_sessions(self, current: CurrentUserContext) -> list[SessionRead]:
        rows = self._session.scalars(
            select(AuthSession)
            .where(
                AuthSession.user_id == current.user.id,
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > utc_now(),
            )
            .order_by(AuthSession.created_at.desc())
            .limit(100)
        )
        return [
            SessionRead(
                id=row.id,
                created_at=row.created_at,
                expires_at=row.expires_at,
                last_used_at=row.last_used_at,
                current=row.id == current.auth_session.id,
            )
            for row in rows
        ]

    def revoke_session(self, current: CurrentUserContext, session_id: uuid.UUID) -> None:
        row = self._session.scalar(
            select(AuthSession)
            .where(
                AuthSession.id == session_id,
                AuthSession.user_id == current.user.id,
            )
            .with_for_update()
        )
        if row:
            row.revoked_at = utc_now()
            self._session.commit()

"""Registration, TOTP and recovery without emailing secrets or logging them."""
import base64
import hmac
import secrets
import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.auth import _throttle
from app.db import get_db_session
from app.models import AuthSession, User
from app.models.onboarding import AccountSecurity
from app.schemas.onboarding import RecoveryRead, RecoveryRequest, RegisterRequest, SecurityProof, SecurityRead, SessionRead, TotpConfirm, TotpSetupRead
from app.security.account_keys import digest, new_key, secret_box, verify_totp
from app.security.browser_auth import require_browser_request
from app.security.current_user import CurrentUserContext, get_current_user_context
from app.security.mfa_policy import privileged_mfa_required
from app.security.passwords import hash_password, verify_password
from app.security.tokens import utc_now

router = APIRouter(prefix="/auth", tags=["account-security"])
Db = Annotated[Session, Depends(get_db_session)]
Current = Annotated[CurrentUserContext, Depends(get_current_user_context)]


def no_store(response: Response):
    response.headers["Cache-Control"] = "no-store"


def security_row(session: Session, user_id: uuid.UUID) -> AccountSecurity:
    # Consistent user -> security lock order with login and recovery.
    session.scalar(select(User.id).where(User.id == user_id).with_for_update())
    row = session.scalar(select(AccountSecurity).where(AccountSecurity.user_id == user_id).with_for_update().execution_options(populate_existing=True))
    if row is None:
        row = AccountSecurity(user_id=user_id)
        session.add(row)
        session.flush()
    return row


def prove(session: Session, current: CurrentUserContext, proof: SecurityProof) -> AccountSecurity:
    row = security_row(session, current.user.id)
    user = session.get(User, current.user.id, populate_existing=True)
    if not verify_password(proof.password, user.password_hash):
        raise HTTPException(401, "Не вдалося підтвердити облікові дані")
    if row.totp_enabled_at:
        counter = verify_totp(secret_box().decrypt(row.totp_secret.encode()).decode(), proof.otp or "", row.totp_last_counter)
        if counter is None:
            raise HTTPException(401, "Введіть новий код із застосунку автентифікації")
        row.totp_last_counter = counter
    return row


@router.post("/register", response_model=RecoveryRead, status_code=201, dependencies=[Depends(require_browser_request)])
def register(payload: RegisterRequest, request: Request, response: Response, session: Db):
    _throttle(request, session, email=str(payload.email))
    key = new_key()
    user = User(id=uuid.uuid4(), email=str(payload.email).lower(), display_name=payload.display_name,
                password_hash=hash_password(payload.password), platform_role="user", is_active=True)
    session.add(user)
    try:
        session.flush()
        session.add(AccountSecurity(user_id=user.id, recovery_hash=digest("recovery", key)))
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(409, "Реєстрацію не виконано. Скористайтесь входом або відновленням доступу") from exc
    no_store(response)
    return RecoveryRead(recovery_key=key)


@router.post("/recover", response_model=RecoveryRead, dependencies=[Depends(require_browser_request)])
def recover(payload: RecoveryRequest, request: Request, response: Response, session: Db):
    _throttle(request, session, email=str(payload.email))
    user = session.scalar(select(User).where(User.email == str(payload.email).lower()).with_for_update())
    row = security_row(session, user.id) if user else None
    candidate = digest("recovery", payload.recovery_key)
    if user is None or not user.is_active or row is None or not hmac.compare_digest(row.recovery_hash or "0"*64, candidate):
        raise HTTPException(401, "Не вдалося підтвердити ключ відновлення")
    key = new_key()
    user.password_hash = hash_password(payload.new_password)
    row.recovery_hash, row.totp_secret, row.totp_enabled_at, row.totp_last_counter = digest("recovery", key), None, None, None
    session.execute(update(AuthSession).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)).values(revoked_at=utc_now()))
    session.commit()
    no_store(response)
    return RecoveryRead(recovery_key=key)


@router.get("/security", response_model=SecurityRead)
def security(current: Current, response: Response, session: Db):
    row = session.get(AccountSecurity, current.user.id)
    no_store(response)
    return SecurityRead(mfa_enabled=bool(row and row.totp_enabled_at),
                        privileged_mfa_required=privileged_mfa_required(),
                        current_session_verified=current.auth_session.mfa_verified_at is not None,
                        recovery_available=bool(row and row.recovery_hash))


@router.post("/security/recovery", response_model=RecoveryRead)
def rotate_recovery(payload: SecurityProof, current: Current, request: Request, response: Response, session: Db):
    _throttle(request, session, email=current.user.email)
    row = prove(session, current, payload)
    key = new_key()
    row.recovery_hash = digest("recovery", key)
    session.commit()
    no_store(response)
    return RecoveryRead(recovery_key=key)


@router.post("/security/totp/setup", response_model=TotpSetupRead)
def setup_totp(payload: SecurityProof, current: Current, request: Request, response: Response, session: Db):
    _throttle(request, session, email=current.user.email)
    row = prove(session, current, payload)
    if row.totp_enabled_at:
        raise HTTPException(409, "Двоетапний вхід уже налаштовано")
    secret = base64.b32encode(secrets.token_bytes(20)).decode()
    row.totp_secret = secret_box().encrypt(secret.encode()).decode()
    row.totp_last_counter = None
    session.commit()
    no_store(response)
    return TotpSetupRead(secret=secret, uri=f"otpauth://totp/{quote('KERUMO:'+current.user.email, safe='')}?secret={secret}&issuer=KERUMO&algorithm=SHA1&digits=6&period=30")


@router.post("/security/totp/confirm", status_code=204)
def confirm_totp(payload: TotpConfirm, current: Current, request: Request, session: Db):
    _throttle(request, session, email=current.user.email)
    row = security_row(session, current.user.id)
    if not row.totp_secret or row.totp_enabled_at:
        raise HTTPException(409, "Почніть налаштування двоетапного входу")
    counter = verify_totp(secret_box().decrypt(row.totp_secret.encode()).decode(), payload.otp, row.totp_last_counter)
    if counter is None:
        raise HTTPException(401, "Код не підтверджено")
    row.totp_last_counter, row.totp_enabled_at = counter, utc_now()
    # A stolen pre-MFA session cannot survive enrollment.
    session.execute(update(AuthSession).where(AuthSession.user_id == current.user.id, AuthSession.id != current.auth_session.id,
                                              AuthSession.revoked_at.is_(None)).values(revoked_at=utc_now()))
    current.auth_session.mfa_verified_at = utc_now()
    session.commit()
    return Response(status_code=204)


@router.get("/sessions", response_model=list[SessionRead])
def sessions(current: Current, session: Db):
    rows = session.scalars(select(AuthSession).where(AuthSession.user_id == current.user.id, AuthSession.revoked_at.is_(None),
                                                    AuthSession.expires_at > utc_now()).order_by(AuthSession.created_at.desc()).limit(100))
    return [SessionRead(id=row.id, created_at=row.created_at, expires_at=row.expires_at, last_used_at=row.last_used_at,
                        current=row.id == current.auth_session.id) for row in rows]


@router.delete("/sessions/{session_id}", status_code=204)
def revoke_session(session_id: uuid.UUID, current: Current, session: Db):
    row = session.scalar(select(AuthSession).where(AuthSession.id == session_id, AuthSession.user_id == current.user.id).with_for_update())
    if row:
        row.revoked_at = utc_now()
        session.commit()
    return Response(status_code=204)

"""Single-use email links and a common lock for concurrent account creation."""

import hashlib
import uuid
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models import AccountLink, User
from app.models.onboarding import AccountSecurity
from app.security.account_keys import digest, new_key, verify_digest
from app.security.passwords import hash_password
from app.security.tokens import utc_now


def lock_email(session: Session, email: str) -> None:
    key = int.from_bytes(
        hashlib.sha256(("account-email:" + email).encode()).digest()[:8], signed=True
    )
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def create_link(session: Session, purpose: str, email: str, *, hours: int, **context):
    row_id, secret = uuid.uuid4(), new_key()
    row = AccountLink(
        id=row_id,
        purpose=purpose,
        email=email,
        token_hash=digest("account-link", secret),
        expires_at=utc_now() + timedelta(hours=hours),
        **context,
    )
    session.add(row)
    session.flush()
    return row, f"{row_id.hex}.{secret}"


def read_link(session: Session, token: str, purpose: str, *, lock=False) -> AccountLink:
    try:
        row_id, secret = token.split(".")
        query = select(AccountLink).where(AccountLink.id == uuid.UUID(row_id))
    except ValueError:
        raise HTTPException(404, "Посилання недійсне або вже використане") from None
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    row = session.scalar(query)
    if (
        row is None
        or row.purpose != purpose
        or row.used_at
        or row.revoked_at
        or row.expires_at <= utc_now()
        or not verify_digest("account-link", secret, row.token_hash)
    ):
        raise HTTPException(404, "Посилання недійсне або вже використане")
    return row


def create_person(session: Session, email: str, name: str, password: str):
    user = User(
        email=email,
        display_name=name,
        password_hash=hash_password(password),
        platform_role="user",
        is_active=True,
        email_verified_at=utc_now(),
    )
    session.add(user)
    session.flush()
    recovery = new_key()
    session.add(AccountSecurity(user_id=user.id, recovery_hash=digest("recovery", recovery)))
    return user, recovery

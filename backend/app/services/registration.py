"""A personal identity requires proof of its mailbox, separate from equipment."""

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import AccountLink, AuthSession, User
from app.models.onboarding import AccountSecurity, FactoryController
from app.schemas.personal_accounts import AccountCreated, RegistrationComplete, RegistrationStart
from app.security.account_keys import digest, new_key
from app.security.passwords import hash_password, verify_password
from app.security.tokens import utc_now
from app.services.account_links import create_link, create_person, lock_email, read_link
from app.services.account_mail import public_url, send_account_mail


def start_registration(session: Session, payload: RegistrationStart, current=None) -> None:
    email = str(payload.email).lower()
    lock_email(session, email)
    if payload.controller_id and session.get(FactoryController, payload.controller_id) is None:
        raise HTTPException(404, "Контролер недоступний. Перевірте QR на шильдику.")
    target_id = None
    if current:
        user = session.scalar(select(User).where(User.id == current.user.id).with_for_update())
        factory = session.scalar(
            select(FactoryController)
            .where(FactoryController.id == payload.controller_id)
            .with_for_update()
        )
        if (
            not user
            or not factory
            or factory.status != "ready"
            or factory.buyer_user_id != user.id
            or user.login_name != factory.buyer_login
        ):
            raise HTTPException(409, "Увійдіть у свій особистий обліковий запис")
        target_id = user.id
    # The response does not disclose whether a mailbox is already registered.
    if session.scalar(select(User.id).where(User.email == email)):
        return
    # A fresh request invalidates previous pending links for this mailbox.
    session.execute(
        update(AccountLink)
        .where(
            AccountLink.email == email,
            AccountLink.purpose == "registration",
            AccountLink.used_at.is_(None),
        )
        .values(revoked_at=utc_now())
    )
    _, token = create_link(
        session,
        "registration",
        email,
        hours=1,
        controller_id=payload.controller_id,
        target_user_id=target_id,
    )
    path = "/register" + (f"?controller={payload.controller_id}" if payload.controller_id else "")
    send_account_mail(
        email,
        "Підтвердьте пошту для KERUMO",
        "Ви почали створення особистого облікового запису KERUMO.\n\n"
        f"Відкрийте посилання протягом години:\n{public_url()}{path}#token={token}\n\n"
        "Якщо це були не ви, просто ігноруйте лист. Ваші дані не зміняться.",
    )
    session.commit()


def complete_registration(session: Session, payload: RegistrationComplete) -> AccountCreated:
    initial = read_link(session, payload.token, "registration")
    lock_email(session, initial.email)
    if session.scalar(select(User.id).where(User.email == initial.email)):
        raise HTTPException(409, "Обліковий запис уже існує. Увійдіть зі своїм паролем.")
    user = (
        session.scalar(select(User).where(User.id == initial.target_user_id).with_for_update())
        if initial.target_user_id
        else None
    )
    row = read_link(session, payload.token, "registration", lock=True)
    if initial.target_user_id:
        factory = session.scalar(
            select(FactoryController)
            .where(FactoryController.id == row.controller_id)
            .with_for_update()
        )
        if (
            not user
            or not user.is_active
            or not factory
            or factory.status != "ready"
            or factory.buyer_user_id != user.id
            or user.login_name != factory.buyer_login
        ):
            raise HTTPException(
                409, "Заводський доступ змінився. Почніть підключення контролера знову."
            )
        if verify_password(payload.password, user.password_hash):
            raise HTTPException(422, "Особистий пароль має відрізнятися від пароля на етикетці")
        user.email, user.login_name = row.email, None
        user.display_name, user.password_hash = (
            payload.display_name,
            hash_password(payload.password),
        )
        user.email_verified_at = utc_now()
        recovery = new_key()
        security = session.get(AccountSecurity, user.id)
        if security is None:
            security = AccountSecurity(user_id=user.id)
            session.add(security)
        security.recovery_hash = digest("recovery", recovery)
        security.totp_secret, security.totp_enabled_at, security.totp_last_counter = (
            None,
            None,
            None,
        )
        session.execute(
            update(AuthSession).where(AuthSession.user_id == user.id).values(revoked_at=utc_now())
        )
    else:
        user, recovery = create_person(session, row.email, payload.display_name, payload.password)
    row.used_at = utc_now()
    session.commit()
    return AccountCreated(email=user.email, recovery_key=recovery, controller_id=row.controller_id)

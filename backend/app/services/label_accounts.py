"""A private label creates an ordinary buyer identity on its first use."""

import uuid

from sqlalchemy import select

from app.models import User
from app.models.onboarding import FactoryController
from app.security.account_keys import verify_digest
from app.security.passwords import hash_password


def label_login(row: FactoryController) -> str:
    return f"kr-{row.id.hex}-g{row.generation}"


def renew_label(row: FactoryController) -> None:
    row.buyer_login, row.buyer_user_id = label_login(row), None


def permanent_login(user: User) -> str:
    return f"ku-{user.id.hex}"


def label_session_valid(session, user: User) -> bool:
    if not user.login_name or not user.login_name.startswith("kr-"):
        return True
    return (
        session.scalar(
            select(FactoryController.id)
            .where(
                FactoryController.buyer_login == user.login_name,
                FactoryController.buyer_user_id == user.id,
                FactoryController.status == "ready",
            )
            .limit(1)
        )
        is not None
    )


def create_label_account(session, login: str, password: str) -> User | None:
    row = session.scalar(
        select(FactoryController)
        .where(FactoryController.buyer_login == login, FactoryController.status == "ready")
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is None or not verify_digest("activation", password, row.activation_hash):
        return None
    if row.buyer_user_id:
        # A concurrent first login won. Release the factory lock before taking
        # the existing user lock: claim/security always lock user -> factory.
        user_id = row.buyer_user_id
        session.rollback()
        return session.scalar(select(User).where(User.id == user_id).with_for_update())
    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        login_name=login,
        # Legacy membership/audit contracts use an email-shaped identity. This
        # internal identifier is never a mailbox or an input required from the buyer.
        email=f"{user_id.hex}@accounts.kerumo.example.com",
        display_name=f"Власник {row.serial_number}",
        password_hash=hash_password(password),
        platform_role="user",
        is_active=True,
    )
    session.add(user)
    session.flush()
    row.buyer_user_id = user.id
    session.flush()
    return user

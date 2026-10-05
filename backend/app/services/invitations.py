"""Organization invitations carry explicit roles and never replace existing access."""

import uuid

from fastapi import HTTPException
from sqlalchemy import select, func, update
from sqlalchemy.orm import Session

from app.models import AccountLink, Organization, OrganizationMembership, User
from app.schemas.personal_accounts import AccountCreated, InvitationCreate, RegistrationComplete
from app.security.authorization import AccessControl
from app.security.roles import OrganizationRole, Permission, role_has_permission
from app.security.tokens import utc_now
from app.services.account_links import create_link, create_person, lock_email, read_link
from app.services.account_mail import public_url, send_account_mail
from app.services.memberships import MembershipService


def lock_organization(session: Session, organization_id: uuid.UUID):
    org = session.scalar(
        select(Organization)
        .where(Organization.id == organization_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not org or not org.is_active:
        raise HTTPException(404, "Організація недоступна")
    return org


def create_invitation(
    session: Session, current, organization_id: uuid.UUID, payload: InvitationCreate
):
    org = lock_organization(session, organization_id)
    session.expire_all()
    access = AccessControl(session, current)
    access.require_organization(organization_id, Permission.MEMBERSHIP_MANAGE)
    service = MembershipService(session)
    if payload.role == OrganizationRole.OWNER and not service._actor_is_owner(
        organization_id, current.user.id, actor_is_superadmin=access.is_superadmin
    ):
        raise HTTPException(403, "Призначати власника може лише власник організації")
    service._validate_scope(
        organization_id, payload.role.value, payload.site_ids, payload.expires_at
    )
    email = str(payload.email).lower()
    if session.scalar(
        select(OrganizationMembership.id)
        .join(User)
        .where(
            OrganizationMembership.organization_id == organization_id,
            User.email == email,
        )
    ):
        raise HTTPException(
            409, "Цей користувач уже має запис доступу. Змініть його права у списку учасників."
        )
    session.execute(
        update(AccountLink)
        .where(
            AccountLink.organization_id == organization_id,
            AccountLink.email == email,
            AccountLink.purpose == "invitation",
            AccountLink.used_at.is_(None),
        )
        .values(revoked_at=utc_now())
    )
    if (
        session.scalar(
            select(func.count())
            .select_from(AccountLink)
            .where(
                AccountLink.organization_id == organization_id,
                AccountLink.used_at.is_(None),
                AccountLink.revoked_at.is_(None),
                AccountLink.expires_at > utc_now(),
            )
        )
        >= 50
    ):
        raise HTTPException(
            409, "Спочатку скасуйте або дочекайтеся завершення попередніх запрошень"
        )
    row, token = create_link(
        session,
        "invitation",
        email,
        hours=72,
        organization_id=organization_id,
        role=payload.role.value,
        site_ids=[str(site) for site in payload.site_ids] if payload.site_ids else None,
        access_expires_at=payload.expires_at,
        created_by_user_id=current.user.id,
    )
    send_account_mail(
        email,
        "Запрошення до організації в KERUMO",
        f"Вас запрошують до організації «{org.name}».\n\n"
        f"Відкрийте посилання протягом трьох днів:\n{public_url()}/invite#token={token}\n\n"
        "Увійдіть у свій обліковий запис або створіть особистий пароль. Нікому не передавайте його.",
    )
    session.commit()
    return row


def validate_inviter(session: Session, row: AccountLink) -> None:
    actor = session.get(User, row.created_by_user_id) if row.created_by_user_id else None
    if actor is not None and actor.is_active and actor.platform_role == "superadmin":
        return
    membership = session.scalar(
        select(OrganizationMembership)
        .where(
            OrganizationMembership.organization_id == row.organization_id,
            OrganizationMembership.user_id == row.created_by_user_id,
            OrganizationMembership.is_active.is_(True),
        )
        .execution_options(populate_existing=True)
    )
    if (
        actor is None
        or not actor.is_active
        or membership is None
        or membership.site_ids is not None
        or (membership.expires_at and membership.expires_at <= utc_now())
        or not role_has_permission(membership.role, Permission.MEMBERSHIP_MANAGE)
        or (row.role == "owner" and membership.role != "owner")
    ):
        raise HTTPException(404, "Запрошення більше недоступне")


def accept_invitation(
    session: Session, token: str, *, current=None, registration: RegistrationComplete | None = None
):
    initial = read_link(session, token, "invitation")
    lock_email(session, initial.email)
    if current:
        user = session.scalar(
            select(User)
            .where(User.id == current.user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if not user or not user.is_active or user.email != initial.email:
            raise HTTPException(403, "Увійдіть із поштою, на яку надіслано запрошення")
        recovery = None
    else:
        if registration is None or session.scalar(
            select(User.id).where(User.email == initial.email)
        ):
            raise HTTPException(
                409, "Для цієї пошти вже є обліковий запис. Увійдіть зі своїм паролем."
            )
        user, recovery = create_person(
            session, initial.email, registration.display_name, registration.password
        )
    lock_organization(session, initial.organization_id)
    row = read_link(session, token, "invitation", lock=True)
    validate_inviter(session, row)
    MembershipService(session)._validate_scope(
        row.organization_id, row.role, row.site_ids, row.access_expires_at
    )
    if session.scalar(
        select(OrganizationMembership.id).where(
            OrganizationMembership.organization_id == row.organization_id,
            OrganizationMembership.user_id == user.id,
        )
    ):
        raise HTTPException(409, "Ви вже маєте запис доступу до цієї організації")
    session.add(
        OrganizationMembership(
            organization_id=row.organization_id,
            user_id=user.id,
            role=row.role,
            is_active=True,
            site_ids=row.site_ids,
            expires_at=row.access_expires_at,
        )
    )
    if user.email_verified_at is None:
        user.email_verified_at = utc_now()
    row.used_at = utc_now()
    session.commit()
    return (
        AccountCreated(email=user.email, recovery_key=recovery) if recovery else row.organization_id
    )

"""Mailbox registration and invitations use the browser CSRF boundary."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth_throttle import throttle_auth
from app.db import get_db_session
from app.models import AccountLink, Organization
from app.schemas.personal_accounts import (
    AccountCreated,
    EmailLinkProof,
    InvitationAccepted,
    InvitationCreate,
    InvitationPreview,
    InvitationRead,
    RegistrationComplete,
    RegistrationStart,
    RegistrationPreview,
)
from app.security.authorization import AccessControl
from app.security.browser_auth import require_browser_request
from app.security.current_user import CurrentUserContext, get_current_user_context
from app.security.roles import Permission
from app.security.tokens import utc_now
from app.services.account_links import read_link
from app.services.invitations import (
    accept_invitation,
    create_invitation,
    lock_organization,
    validate_inviter,
)
from app.services.registration import complete_registration, start_registration

router = APIRouter(tags=["personal-accounts"], dependencies=[Depends(require_browser_request)])
Db = Annotated[Session, Depends(get_db_session)]
Current = Annotated[CurrentUserContext, Depends(get_current_user_context)]


@router.post("/auth/registration/start", status_code=202)
def register_start(payload: RegistrationStart, request: Request, session: Db):
    throttle_auth(request, session, email="register:" + str(payload.email))
    start_registration(session, payload)
    return Response(status_code=202, headers={"Cache-Control": "no-store"})


@router.post("/connect/{controller_id}/account-registration", status_code=202)
def label_register_start(
    controller_id: uuid.UUID,
    payload: RegistrationStart,
    current: Current,
    request: Request,
    session: Db,
):
    throttle_auth(request, session, email="register:" + str(payload.email))
    start_registration(
        session, payload.model_copy(update={"controller_id": controller_id}), current
    )
    return Response(status_code=202, headers={"Cache-Control": "no-store"})


@router.post("/auth/registration/complete", response_model=AccountCreated)
def register_complete(
    payload: RegistrationComplete, request: Request, response: Response, session: Db
):
    throttle_auth(request, session)
    response.headers["Cache-Control"] = "no-store"
    return complete_registration(session, payload)


@router.post("/auth/registration/inspect", response_model=RegistrationPreview)
def register_inspect(payload: EmailLinkProof, request: Request, response: Response, session: Db):
    throttle_auth(request, session)
    response.headers["Cache-Control"] = "no-store"
    return RegistrationPreview(email=read_link(session, payload.token, "registration").email)


@router.get("/organizations/{organization_id}/invitations", response_model=list[InvitationRead])
def invitation_list(organization_id: uuid.UUID, current: Current, response: Response, session: Db):
    AccessControl(session, current).require_organization(
        organization_id, Permission.MEMBERSHIP_READ
    )
    response.headers["Cache-Control"] = "no-store"
    return list(
        session.scalars(
            select(AccountLink)
            .where(
                AccountLink.organization_id == organization_id,
                AccountLink.purpose == "invitation",
                AccountLink.used_at.is_(None),
                AccountLink.revoked_at.is_(None),
                AccountLink.expires_at > utc_now(),
            )
            .order_by(AccountLink.created_at.desc())
            .limit(50)
        )
    )


@router.post(
    "/organizations/{organization_id}/invitations", response_model=InvitationRead, status_code=201
)
def invitation_create(
    organization_id: uuid.UUID,
    payload: InvitationCreate,
    current: Current,
    request: Request,
    response: Response,
    session: Db,
):
    AccessControl(session, current).require_organization(
        organization_id, Permission.MEMBERSHIP_MANAGE
    )
    throttle_auth(request, session, email="invite:" + str(current.user.id))
    response.headers["Cache-Control"] = "no-store"
    return create_invitation(session, current, organization_id, payload)


@router.delete("/organizations/{organization_id}/invitations/{invitation_id}", status_code=204)
def invitation_revoke(
    organization_id: uuid.UUID, invitation_id: uuid.UUID, current: Current, session: Db
):
    AccessControl(session, current).require_organization(
        organization_id, Permission.MEMBERSHIP_MANAGE
    )
    lock_organization(session, organization_id)
    session.expire_all()
    AccessControl(session, current).require_organization(
        organization_id, Permission.MEMBERSHIP_MANAGE
    )
    row = session.scalar(
        select(AccountLink)
        .where(
            AccountLink.id == invitation_id,
            AccountLink.organization_id == organization_id,
            AccountLink.purpose == "invitation",
        )
        .with_for_update()
    )
    if row is None:
        raise HTTPException(404, "Запрошення недоступне")
    if not row.used_at:
        row.revoked_at = utc_now()
        session.commit()
    return Response(status_code=204)


@router.post("/invitations/inspect", response_model=InvitationPreview)
def invitation_inspect(payload: EmailLinkProof, request: Request, response: Response, session: Db):
    throttle_auth(request, session)
    row = read_link(session, payload.token, "invitation")
    validate_inviter(session, row)
    organization = session.get(Organization, row.organization_id)
    if organization is None or not organization.is_active:
        raise HTTPException(404, "Організація недоступна")
    response.headers["Cache-Control"] = "no-store"
    return InvitationPreview(email=row.email, organization_name=organization.name, role=row.role)


@router.post("/invitations/accept", response_model=InvitationAccepted)
def invitation_accept(
    payload: EmailLinkProof, current: Current, request: Request, response: Response, session: Db
):
    throttle_auth(request, session, email="accept:" + str(current.user.id))
    response.headers["Cache-Control"] = "no-store"
    return InvitationAccepted(
        organization_id=accept_invitation(session, payload.token, current=current)
    )


@router.post("/invitations/register", response_model=AccountCreated)
def invitation_register(
    payload: RegistrationComplete, request: Request, response: Response, session: Db
):
    throttle_auth(request, session)
    response.headers["Cache-Control"] = "no-store"
    return accept_invitation(session, payload.token, registration=payload)

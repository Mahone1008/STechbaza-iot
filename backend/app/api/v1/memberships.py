import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.models.organization_membership import OrganizationMembership
from app.schemas.membership import (
    MembershipCreate,
    MembershipRead,
    MembershipUpdate,
)
from app.security.authorization import AccessControl
from app.security.current_user import (
    CurrentUserContext,
    get_current_user_context,
)
from app.security.roles import Permission
from app.services.memberships import (
    MembershipAlreadyExistsError,
    MembershipLastOwnerError,
    MembershipNotFoundError,
    MembershipOwnerProtectedError,
    MembershipPermissionError,
    MembershipService,
    MembershipUserNotFoundError,
)

router = APIRouter(tags=["memberships"])

DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[
    CurrentUserContext,
    Depends(get_current_user_context),
]


def _read(item: OrganizationMembership) -> MembershipRead:
    return MembershipRead(
        id=item.id,
        organization_id=item.organization_id,
        user_id=item.user_id,
        user_email=item.user.email,
        user_display_name=item.user.display_name,
        role=item.role,
        is_active=item.is_active,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get(
    "/organizations/{organization_id}/memberships",
    response_model=list[MembershipRead],
)
def list_memberships(
    organization_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
) -> list[MembershipRead]:
    AccessControl(session, current).require_organization(
        organization_id,
        Permission.MEMBERSHIP_READ,
    )

    items = MembershipService(session).list_for_organization(organization_id)
    return [_read(item) for item in items]


@router.post(
    "/organizations/{organization_id}/memberships",
    response_model=MembershipRead,
    status_code=status.HTTP_201_CREATED,
)
def create_membership(
    organization_id: uuid.UUID,
    payload: MembershipCreate,
    session: DbSession,
    current: CurrentUser,
) -> MembershipRead:
    access = AccessControl(session, current)
    access.require_organization(
        organization_id,
        Permission.MEMBERSHIP_MANAGE,
    )

    try:
        item = MembershipService(session).create(
            organization_id,
            payload,
            actor_user_id=current.user.id,
            actor_is_superadmin=access.is_superadmin,
        )
    except MembershipNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Ресурс не знайдено") from exc
    except MembershipPermissionError as exc:
        raise HTTPException(status_code=403, detail="Недостатньо прав для цієї дії") from exc
    except MembershipUserNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Користувача не знайдено або вимкнено",
        ) from exc
    except MembershipAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Membership для цього користувача вже існує",
        ) from exc
    except MembershipOwnerProtectedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Лише owner може призначати роль owner",
        ) from exc

    return _read(item)


@router.patch(
    "/organizations/{organization_id}/memberships/{membership_id}",
    response_model=MembershipRead,
)
def update_membership(
    organization_id: uuid.UUID,
    membership_id: uuid.UUID,
    payload: MembershipUpdate,
    session: DbSession,
    current: CurrentUser,
) -> MembershipRead:
    access = AccessControl(session, current)
    access.require_organization(
        organization_id,
        Permission.MEMBERSHIP_MANAGE,
    )

    try:
        item = MembershipService(session).update(
            organization_id,
            membership_id,
            payload,
            actor_user_id=current.user.id,
            actor_is_superadmin=access.is_superadmin,
        )
    except MembershipNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Membership не знайдено",
        ) from exc
    except MembershipOwnerProtectedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Лише owner може керувати роллю owner",
        ) from exc
    except MembershipLastOwnerError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Не можна прибрати останнього активного owner організації",
        ) from exc
    except MembershipPermissionError as exc:
        raise HTTPException(status_code=403, detail="Недостатньо прав для цієї дії") from exc

    return _read(item)

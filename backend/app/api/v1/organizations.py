import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.schemas.organization import OrganizationCreate, OrganizationRead
from app.security.authorization import AccessControl
from app.security.current_user import (
    CurrentUserContext,
    get_current_user_context,
)
from app.security.roles import Permission, PlatformRole
from app.services.organizations import (
    OrganizationAlreadyExistsError,
    OrganizationNotFoundError,
    OrganizationService,
)

router = APIRouter(prefix="/organizations", tags=["organizations"])

DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[
    CurrentUserContext,
    Depends(get_current_user_context),
]


@router.get("", response_model=list[OrganizationRead])
def list_organizations(
    session: DbSession,
    current: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[OrganizationRead]:
    organizations = AccessControl(
        session,
        current,
    ).list_visible_organizations(
        limit=limit,
        offset=offset,
    )
    return [OrganizationRead.model_validate(item) for item in organizations]


@router.get("/{organization_id}", response_model=OrganizationRead)
def get_organization(
    organization_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
) -> OrganizationRead:
    AccessControl(session, current).require_organization(
        organization_id,
        Permission.ORGANIZATION_READ,
    )

    try:
        organization = OrganizationService(session).get(organization_id)
    except OrganizationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Організацію не знайдено",
        ) from exc

    return OrganizationRead.model_validate(organization)


@router.post(
    "",
    response_model=OrganizationRead,
    status_code=status.HTTP_201_CREATED,
)
def create_organization(
    payload: OrganizationCreate,
    session: DbSession,
    current: CurrentUser,
) -> OrganizationRead:
    # Створення нового tenant — platform-level операція.
    AccessControl(session, current).require_platform_role(
        PlatformRole.SUPERADMIN,
    )

    try:
        organization = OrganizationService(session).create(payload)
    except OrganizationAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Організація з таким slug уже існує",
        ) from exc

    return OrganizationRead.model_validate(organization)

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.schemas.site import SiteCreate, SiteRead
from app.security.authorization import AccessControl
from app.security.current_user import (
    CurrentUserContext,
    get_current_user_context,
)
from app.security.roles import Permission
from app.services.sites import (
    ParentOrganizationNotFoundError,
    SiteAlreadyExistsError,
    SiteNotFoundError,
    SiteService,
)

router = APIRouter(tags=["sites"])

DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[
    CurrentUserContext,
    Depends(get_current_user_context),
]


@router.get(
    "/organizations/{organization_id}/sites",
    response_model=list[SiteRead],
)
def list_sites(
    organization_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[SiteRead]:
    AccessControl(session, current).require_organization(
        organization_id,
        Permission.SITE_READ,
    )

    try:
        sites = SiteService(session).list_for_organization(
            organization_id,
            limit=limit,
            offset=offset,
        )
    except ParentOrganizationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Організацію не знайдено",
        ) from exc

    return [SiteRead.model_validate(item) for item in sites]


@router.post(
    "/organizations/{organization_id}/sites",
    response_model=SiteRead,
    status_code=status.HTTP_201_CREATED,
)
def create_site(
    organization_id: uuid.UUID,
    payload: SiteCreate,
    session: DbSession,
    current: CurrentUser,
) -> SiteRead:
    AccessControl(session, current).require_organization(
        organization_id,
        Permission.SITE_CREATE,
    )

    try:
        site = SiteService(session).create(organization_id, payload)
    except ParentOrganizationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Організацію не знайдено",
        ) from exc
    except SiteAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Об'єкт з таким code уже існує в цій організації",
        ) from exc

    return SiteRead.model_validate(site)


@router.get("/sites/{site_id}", response_model=SiteRead)
def get_site(
    site_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
) -> SiteRead:
    AccessControl(session, current).require_site(
        site_id,
        Permission.SITE_READ,
    )

    try:
        site = SiteService(session).get(site_id)
    except SiteNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Об'єкт не знайдено",
        ) from exc

    return SiteRead.model_validate(site)

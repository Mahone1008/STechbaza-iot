import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.schemas.organization import OrganizationCreate, OrganizationRead
from app.services.organizations import (
    OrganizationAlreadyExistsError,
    OrganizationNotFoundError,
    OrganizationService,
)

router = APIRouter(prefix="/organizations", tags=["organizations"])

DbSession = Annotated[Session, Depends(get_db_session)]


@router.get("", response_model=list[OrganizationRead])
def list_organizations(
    session: DbSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[OrganizationRead]:
    organizations = OrganizationService(session).list(
        limit=limit,
        offset=offset,
    )
    return [OrganizationRead.model_validate(item) for item in organizations]


@router.get("/{organization_id}", response_model=OrganizationRead)
def get_organization(
    organization_id: uuid.UUID,
    session: DbSession,
) -> OrganizationRead:
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
) -> OrganizationRead:
    try:
        organization = OrganizationService(session).create(payload)
    except OrganizationAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Організація з таким slug уже існує",
        ) from exc

    return OrganizationRead.model_validate(organization)

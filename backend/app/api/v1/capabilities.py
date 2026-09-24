import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.schemas.capability import (
    CapabilityCreate,
    CapabilityRead,
    DeviceCapabilityAssign,
    DeviceCapabilityRead,
)
from app.services.capabilities import (
    CapabilityAlreadyExistsError,
    CapabilityNotFoundError,
    CapabilityService,
    DeviceCapabilityAlreadyExistsError,
    ParentDeviceNotFoundError,
)

router = APIRouter(tags=["capabilities"])

DbSession = Annotated[Session, Depends(get_db_session)]


@router.get("/capabilities", response_model=list[CapabilityRead])
def list_capabilities(
    session: DbSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[CapabilityRead]:
    items = CapabilityService(session).list_catalog(limit=limit, offset=offset)
    return [CapabilityRead.model_validate(item) for item in items]


@router.post(
    "/capabilities",
    response_model=CapabilityRead,
    status_code=status.HTTP_201_CREATED,
)
def create_capability(
    payload: CapabilityCreate,
    session: DbSession,
) -> CapabilityRead:
    try:
        item = CapabilityService(session).create_catalog_item(payload)
    except CapabilityAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Capability з таким code уже існує",
        ) from exc

    return CapabilityRead.model_validate(item)


@router.get(
    "/devices/{device_id}/capabilities",
    response_model=list[DeviceCapabilityRead],
)
def list_device_capabilities(
    device_id: uuid.UUID,
    session: DbSession,
) -> list[DeviceCapabilityRead]:
    try:
        items = CapabilityService(session).list_for_device(device_id)
    except ParentDeviceNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пристрій не знайдено",
        ) from exc

    return [
        DeviceCapabilityRead(
            id=item.id,
            device_id=item.device_id,
            capability_id=item.capability_id,
            is_enabled=item.is_enabled,
            config=item.config,
            capability=CapabilityRead.model_validate(item.capability),
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item in items
    ]


@router.post(
    "/devices/{device_id}/capabilities/{capability_id}",
    response_model=DeviceCapabilityRead,
    status_code=status.HTTP_201_CREATED,
)
def assign_capability(
    device_id: uuid.UUID,
    capability_id: uuid.UUID,
    payload: DeviceCapabilityAssign,
    session: DbSession,
) -> DeviceCapabilityRead:
    try:
        item = CapabilityService(session).assign_to_device(
            device_id,
            capability_id,
            payload,
        )
    except ParentDeviceNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пристрій не знайдено",
        ) from exc
    except CapabilityNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Capability не знайдено",
        ) from exc
    except DeviceCapabilityAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Capability уже прив'язаний до цього пристрою",
        ) from exc

    return DeviceCapabilityRead(
        id=item.id,
        device_id=item.device_id,
        capability_id=item.capability_id,
        is_enabled=item.is_enabled,
        config=item.config,
        capability=CapabilityRead.model_validate(item.capability),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )

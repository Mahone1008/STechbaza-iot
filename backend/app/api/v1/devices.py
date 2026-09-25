import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.schemas.availability import DeviceAvailabilityRead
from app.schemas.device import DeviceCreate, DeviceRead
from app.security.authorization import AccessControl
from app.security.current_user import (
    CurrentUserContext,
    get_current_user_context,
)
from app.security.roles import Permission
from app.services.device_presence import (
    DevicePresenceService,
    PresenceDeviceNotFoundError,
)
from app.services.devices import (
    DeviceAlreadyExistsError,
    DeviceNotFoundError,
    DeviceService,
    ParentSiteNotFoundError,
)

router = APIRouter(tags=["devices"])

DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[
    CurrentUserContext,
    Depends(get_current_user_context),
]


@router.get(
    "/sites/{site_id}/devices",
    response_model=list[DeviceRead],
)
def list_devices(
    site_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[DeviceRead]:
    AccessControl(session, current).require_site(
        site_id,
        Permission.DEVICE_READ,
    )

    try:
        devices = DeviceService(session).list_for_site(
            site_id,
            limit=limit,
            offset=offset,
        )
    except ParentSiteNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Об'єкт не знайдено",
        ) from exc

    return [DeviceRead.model_validate(item) for item in devices]


@router.post(
    "/sites/{site_id}/devices",
    response_model=DeviceRead,
    status_code=status.HTTP_201_CREATED,
)
def create_device(
    site_id: uuid.UUID,
    payload: DeviceCreate,
    session: DbSession,
    current: CurrentUser,
) -> DeviceRead:
    AccessControl(session, current).require_site(
        site_id,
        Permission.DEVICE_CREATE,
    )

    try:
        device = DeviceService(session).create(site_id, payload)
    except ParentSiteNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Об'єкт не знайдено",
        ) from exc
    except DeviceAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Пристрій з таким uid уже зареєстрований",
        ) from exc

    return DeviceRead.model_validate(device)


@router.get("/devices/{device_id}", response_model=DeviceRead)
def get_device(
    device_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
) -> DeviceRead:
    AccessControl(session, current).require_device(
        device_id,
        Permission.DEVICE_READ,
    )

    try:
        device = DeviceService(session).get(device_id)
    except DeviceNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пристрій не знайдено",
        ) from exc

    return DeviceRead.model_validate(device)


@router.get(
    "/devices/{device_id}/availability",
    response_model=DeviceAvailabilityRead,
)
def get_device_availability(
    device_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
) -> DeviceAvailabilityRead:
    AccessControl(session, current).require_device(
        device_id,
        Permission.DEVICE_READ,
    )

    try:
        availability = DevicePresenceService(session).get_availability(
            device_id=device_id
        )
    except PresenceDeviceNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пристрій не знайдено",
        ) from exc

    return DeviceAvailabilityRead(
        device_id=availability.device_id,
        uid=availability.uid,
        online=availability.online,
        last_seen_at=availability.last_seen_at,
        timeout_seconds=availability.timeout_seconds,
        seconds_since_seen=availability.seconds_since_seen,
    )

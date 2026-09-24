import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.schemas.device import DeviceCreate, DeviceRead
from app.services.devices import (
    DeviceAlreadyExistsError,
    DeviceNotFoundError,
    DeviceService,
    ParentSiteNotFoundError,
)

router = APIRouter(tags=["devices"])

DbSession = Annotated[Session, Depends(get_db_session)]


@router.get(
    "/sites/{site_id}/devices",
    response_model=list[DeviceRead],
)
def list_devices(
    site_id: uuid.UUID,
    session: DbSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[DeviceRead]:
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
) -> DeviceRead:
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
) -> DeviceRead:
    try:
        device = DeviceService(session).get(device_id)
    except DeviceNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пристрій не знайдено",
        ) from exc

    return DeviceRead.model_validate(device)

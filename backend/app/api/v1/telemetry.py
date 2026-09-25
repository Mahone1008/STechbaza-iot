import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.repositories.devices import DeviceRepository
from app.repositories.telemetry import TelemetryRepository
from app.schemas.telemetry import DeviceStateRead, TelemetryMessageRead
from app.security.authorization import AccessControl
from app.security.current_user import (
    CurrentUserContext,
    get_current_user_context,
)
from app.security.roles import Permission

router = APIRouter(tags=["telemetry"])

DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[
    CurrentUserContext,
    Depends(get_current_user_context),
]


@router.get(
    "/devices/{device_id}/telemetry",
    response_model=list[TelemetryMessageRead],
)
def list_device_telemetry(
    device_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[TelemetryMessageRead]:
    AccessControl(session, current).require_device(
        device_id,
        Permission.TELEMETRY_READ,
    )

    if DeviceRepository(session).get(device_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пристрій не знайдено",
        )

    items = TelemetryRepository(session).list_for_device(
        device_id,
        limit=limit,
        offset=offset,
    )
    return [TelemetryMessageRead.model_validate(item) for item in items]


@router.get(
    "/devices/{device_id}/state",
    response_model=DeviceStateRead,
)
def get_device_state(
    device_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
) -> DeviceStateRead:
    AccessControl(session, current).require_device(
        device_id,
        Permission.TELEMETRY_READ,
    )

    if DeviceRepository(session).get(device_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пристрій не знайдено",
        )

    snapshot = TelemetryRepository(session).get_state(device_id)
    if snapshot is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Телеметрію для пристрою ще не отримано",
        )

    return DeviceStateRead.model_validate(snapshot)

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.repositories.events import EventRepository
from app.schemas.event import DeviceEventRead
from app.security.authorization import AccessControl
from app.security.current_user import (
    CurrentUserContext,
    get_current_user_context,
)
from app.security.roles import Permission

router = APIRouter(tags=["events"])

DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[
    CurrentUserContext,
    Depends(get_current_user_context),
]
SeverityQuery = Annotated[
    Literal["info", "warning", "critical"] | None,
    Query(),
]
SourceQuery = Annotated[
    Literal["telemetry", "presence", "command", "device", "system"] | None,
    Query(),
]


@router.get(
    "/devices/{device_id}/events",
    response_model=list[DeviceEventRead],
)
def list_device_events(
    device_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    event_type: Annotated[str | None, Query(min_length=1, max_length=96)] = None,
    severity: SeverityQuery = None,
    source: SourceQuery = None,
    occurred_from: Annotated[datetime | None, Query()] = None,
    occurred_to: Annotated[datetime | None, Query()] = None,
) -> list[DeviceEventRead]:
    """Повернути tenant-scoped timeline подій конкретного Device."""

    AccessControl(session, current).require_device(
        device_id,
        Permission.EVENT_READ,
    )

    items = EventRepository(session).list_for_device(
        device_id,
        limit=limit,
        offset=offset,
        event_type=event_type,
        severity=severity,
        source=source,
        occurred_from=occurred_from,
        occurred_to=occurred_to,
    )
    return [DeviceEventRead.model_validate(item) for item in items]


@router.get(
    "/events/{event_id}",
    response_model=DeviceEventRead,
)
def get_event(
    event_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
) -> DeviceEventRead:
    """Повернути Event лише якщо User має доступ до tenant його Device."""

    event = AccessControl(session, current).require_event(
        event_id,
        Permission.EVENT_READ,
    )
    return DeviceEventRead.model_validate(event)

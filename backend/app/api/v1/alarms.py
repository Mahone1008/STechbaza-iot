import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.repositories.alarms import AlarmRepository
from app.schemas.alarm import AlarmTransitionRead, DeviceAlarmRead
from app.security.authorization import AccessControl
from app.security.current_user import (
    CurrentUserContext,
    get_current_user_context,
)
from app.security.roles import Permission

router = APIRouter(tags=["alarms"])

DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[
    CurrentUserContext,
    Depends(get_current_user_context),
]
StateQuery = Annotated[
    Literal["active", "resolved"] | None,
    Query(),
]
SeverityQuery = Annotated[
    Literal["warning", "critical"] | None,
    Query(),
]


@router.get(
    "/devices/{device_id}/alarms",
    response_model=list[DeviceAlarmRead],
)
def list_device_alarms(
    device_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    state: StateQuery = None,
    severity: SeverityQuery = None,
    alarm_type: Annotated[str | None, Query(min_length=1, max_length=96)] = None,
) -> list[DeviceAlarmRead]:
    """Повернути tenant-scoped список Alarm incidents Device."""

    AccessControl(session, current).require_device(
        device_id,
        Permission.ALARM_READ,
    )
    items = AlarmRepository(session).list_for_device(
        device_id,
        limit=limit,
        offset=offset,
        state=state,
        severity=severity,
        alarm_type=alarm_type,
    )
    return [DeviceAlarmRead.model_validate(item) for item in items]


@router.get(
    "/alarms/{alarm_id}",
    response_model=DeviceAlarmRead,
)
def get_alarm(
    alarm_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
) -> DeviceAlarmRead:
    """Повернути Alarm лише в межах доступного tenant."""

    alarm = AccessControl(session, current).require_alarm(
        alarm_id,
        Permission.ALARM_READ,
    )
    return DeviceAlarmRead.model_validate(alarm)


@router.get(
    "/alarms/{alarm_id}/transitions",
    response_model=list[AlarmTransitionRead],
)
def list_alarm_transitions(
    alarm_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[AlarmTransitionRead]:
    """Повернути append-only lifecycle history одного Alarm."""

    AccessControl(session, current).require_alarm(
        alarm_id,
        Permission.ALARM_READ,
    )
    items = AlarmRepository(session).list_transitions(
        alarm_id,
        limit=limit,
        offset=offset,
    )
    return [AlarmTransitionRead.model_validate(item) for item in items]

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.schemas.command import DeviceCommandCreate, DeviceCommandRead
from app.security.authorization import AccessControl
from app.security.current_user import (
    CurrentUserContext,
    get_current_user_context,
)
from app.security.roles import Permission
from app.services.command_dispatch import CommandDispatchService
from app.services.commands import (
    CommandCapabilityViolationError,
    CommandDeviceNotFoundError,
    CommandNotFoundError,
    CommandRequestConflictError,
    CommandService,
)

router = APIRouter(tags=["commands"])

DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[
    CurrentUserContext,
    Depends(get_current_user_context),
]


@router.post(
    "/devices/{device_id}/commands",
    response_model=DeviceCommandRead,
    status_code=status.HTTP_201_CREATED,
)
def create_command(
    device_id: uuid.UUID,
    payload: DeviceCommandCreate,
    response: Response,
    session: DbSession,
    current: CurrentUser,
) -> DeviceCommandRead:
    AccessControl(session, current).require_device(
        device_id,
        Permission.COMMAND_EXECUTE,
    )

    try:
        command, created = CommandService(session).create(device_id, payload)
    except CommandDeviceNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пристрій не знайдено",
        ) from exc
    except CommandCapabilityViolationError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Команда недоступна для цього пристрою: "
                f"потрібна capability {exc.capability_code}"
            ),
        ) from exc
    except CommandRequestConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "request_id уже використано для іншої команди або "
                "іншого payload"
            ),
        ) from exc

    if not created:
        response.status_code = status.HTTP_200_OK
        return DeviceCommandRead.model_validate(command)

    # Durable record уже закомічено. MQTT publish — окремий крок:
    # при тимчасовій помилці брокера команда залишається queued, а не губиться.
    dispatch = CommandDispatchService(session).dispatch(command.id)
    return DeviceCommandRead.model_validate(dispatch.command)


@router.get(
    "/devices/{device_id}/commands",
    response_model=list[DeviceCommandRead],
)
def list_device_commands(
    device_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[DeviceCommandRead]:
    AccessControl(session, current).require_device(
        device_id,
        Permission.COMMAND_READ,
    )

    try:
        commands = CommandService(session).list_for_device(
            device_id,
            limit=limit,
            offset=offset,
        )
    except CommandDeviceNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пристрій не знайдено",
        ) from exc

    return [DeviceCommandRead.model_validate(item) for item in commands]


@router.get(
    "/commands/{command_id}",
    response_model=DeviceCommandRead,
)
def get_command(
    command_id: uuid.UUID,
    session: DbSession,
    current: CurrentUser,
) -> DeviceCommandRead:
    AccessControl(session, current).require_command(
        command_id,
        Permission.COMMAND_READ,
    )

    try:
        command = CommandService(session).get(command_id)
    except CommandNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Команду не знайдено",
        ) from exc

    return DeviceCommandRead.model_validate(command)

import uuid
from datetime import datetime
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
from app.services.equipment import EquipmentConflict
from app.services.vfd_settings import MESSAGES, STAFF_ROLES
from app.services.commands import (
    CommandActorSnapshot,
    CommandCapabilityViolationError,
    CommandDeviceNotFoundError,
    CommandNotFoundError,
    CommandRequestConflictError,
    CommandFrequencyProfileError,
    CommandProgramError,
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
    access = AccessControl(session, current)
    device_access = access.require_device_context(
        device_id,
        Permission.COMMAND_EXECUTE,
    )
    if payload.command_type == "vfd.parameter.set":
        if current.user.platform_role not in STAFF_ROLES:
            raise HTTPException(status_code=403, detail=MESSAGES["vfd_settings_staff_only"])
        access.require_device_context(device_id, Permission.CAPABILITY_MANAGE)

    actor = CommandActorSnapshot(
        user_id=current.user.id,
        auth_session_id=current.auth_session.id,
        organization_id=device_access.organization_id,
        platform_role=current.user.platform_role,
        organization_role=device_access.organization_role,
        email=current.user.email,
        display_name=current.user.display_name,
    )

    try:
        command, created = CommandService(session).create(
            device_id,
            payload,
            actor=actor,
        )
    except EquipmentConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
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
    except CommandFrequencyProfileError as exc:
        raise HTTPException(status_code=409, detail="Частота поза налаштованими межами або профіль обладнання ще не задано") from exc
    except CommandProgramError as exc:
        messages = {
            **MESSAGES,
            "schedule_requires_calendar": "Календарний запуск створюється лише через збережений розклад.",
            "schedule_firmware_unavailable": "Контролер ще не підтримує календарні запуски.",
            "schedule_window_expired": "Календарне вікно запуску минуло.",
            "program_active": "Програма вже виконується. Спочатку зупиніть її кнопкою STOP.",
            "program_control_disabled": "Керування частотником вимкнено.",
            "program_firmware_unavailable": "Потрібна свіжа телеметрія контролера з підтримкою програм v1.",
            "program_requires_stopped_device": "Перед запуском програми потрібна підтверджена зупинка частотника.",
            "program_frequency_profile_changed": "Частота етапу поза робочими межами або профіль обладнання не задано.",
        }
        raise HTTPException(status_code=409, detail=messages[str(exc)]) from exc
    except CommandRequestConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "request_id уже використано для іншої команди, "
                "іншого payload або іншого actor"
            ),
        ) from exc

    if not created:
        response.status_code = status.HTTP_200_OK
        return DeviceCommandRead.model_validate(command)

    # Durable record уже закомічено. MQTT publish — окремий крок:
    # спроба фіксується до мережевого виклику та не губиться при збої процесу.
    dispatch = CommandDispatchService(session).dispatch(command.id)
    return DeviceCommandRead.model_validate(dispatch.command)


@router.get(
    "/devices/{device_id}/commands/by-request/{request_id}",
    response_model=DeviceCommandRead,
)
def get_command_by_request(device_id: uuid.UUID, request_id: uuid.UUID,
                           session: DbSession, current: CurrentUser) -> DeviceCommandRead:
    from app.repositories.commands import CommandRepository
    AccessControl(session, current).require_device(device_id, Permission.COMMAND_READ)
    command = CommandRepository(session).get_by_request_id(request_id)
    if command is None or command.device_id != device_id:
        raise HTTPException(status_code=404, detail="Команду не знайдено")
    return DeviceCommandRead.model_validate(command)


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
    before_created_at: datetime | None = None,
    before_id: uuid.UUID | None = None,
) -> list[DeviceCommandRead]:
    AccessControl(session, current).require_device(
        device_id,
        Permission.COMMAND_READ,
    )

    if (before_created_at is None) != (before_id is None) or (
        before_created_at is not None
        and (offset != 0 or before_created_at.utcoffset() is None)
    ):
        raise HTTPException(status_code=422, detail=(
            "Курсор потребує before_created_at із часовим поясом та before_id; offset має бути 0"
        ))

    try:
        commands = CommandService(session).list_for_device(
            device_id,
            limit=limit,
            offset=offset,
            before_created_at=before_created_at,
            before_id=before_id,
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

import uuid
from fastapi import APIRouter, HTTPException

from app.api.v1.devices import DbSession, CurrentUser
from app.repositories.devices import DeviceRepository
from app.schemas.control_mode import ControlModeRead, ControlModeWrite
from app.security.authorization import AccessControl
from app.security.roles import Permission
from app.services.commands import CommandActorSnapshot
from app.services.control_mode import ControlModeConflict, ControlModeService, read_control_mode

router = APIRouter(tags=["control-mode"])


@router.get("/devices/{device_id}/control-mode", response_model=ControlModeRead)
def get_control_mode(device_id: uuid.UUID, session: DbSession, current: CurrentUser):
    AccessControl(session, current).require_device(device_id, Permission.DEVICE_READ)
    device = DeviceRepository(session).get(device_id)
    return read_control_mode(session, device)


@router.patch("/devices/{device_id}/control-mode", response_model=ControlModeRead)
def change_control_mode(device_id: uuid.UUID, payload: ControlModeWrite, session: DbSession, current: CurrentUser):
    access = AccessControl(session, current).require_device_context(device_id, Permission.COMMAND_EXECUTE)
    actor = CommandActorSnapshot(user_id=current.user.id, auth_session_id=current.auth_session.id,
        organization_id=access.organization_id, platform_role=current.user.platform_role,
        organization_role=access.organization_role, email=current.user.email, display_name=current.user.display_name)
    try:
        return ControlModeService(session).update(device_id, payload, actor)
    except ControlModeConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

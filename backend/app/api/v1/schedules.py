"""HTTP-доступ до календаря через чинні tenant/RBAC guards."""
import uuid

from fastapi import APIRouter, HTTPException

from app.api.v1.commands import CurrentUser, DbSession
from app.repositories.schedules import ScheduleRepository
from app.schemas.schedule import ScheduleOccurrenceRead, SchedulePreview, ScheduleRead, ScheduleWrite
from app.security.authorization import AccessControl
from app.security.roles import Permission
from app.services.schedules import ScheduleService

router = APIRouter(tags=["schedules"])


@router.get("/devices/{device_id}/schedules", response_model=list[ScheduleRead])
def list_schedules(device_id: uuid.UUID, session: DbSession, current: CurrentUser):
    access = AccessControl(session, current).require_device_context(device_id, Permission.COMMAND_READ)
    return [item for item in ScheduleRepository(session).for_device(device_id) if item.organization_id == access.organization_id]


@router.post("/devices/{device_id}/schedules/preview", response_model=SchedulePreview)
def preview_schedule(device_id: uuid.UUID, payload: ScheduleWrite, session: DbSession, current: CurrentUser):
    AccessControl(session, current).require_device(device_id, Permission.COMMAND_EXECUTE)
    return ScheduleService(session).preview(device_id, payload.spec, exclude_id=payload.id)


@router.put("/devices/{device_id}/schedules/{schedule_id}", response_model=ScheduleRead)
def write_schedule(device_id: uuid.UUID, schedule_id: uuid.UUID, payload: ScheduleWrite, session: DbSession, current: CurrentUser):
    access = AccessControl(session, current).require_device_context(device_id, Permission.COMMAND_EXECUTE)
    if payload.id != schedule_id:
        raise HTTPException(422, "Ідентифікатор у шляху та запиті має збігатися")
    return ScheduleService(session).write(device_id, payload, current, access)


@router.get("/devices/{device_id}/schedules/{schedule_id}/runs", response_model=list[ScheduleOccurrenceRead])
def schedule_history(device_id: uuid.UUID, schedule_id: uuid.UUID, session: DbSession, current: CurrentUser):
    access = AccessControl(session, current).require_device_context(device_id, Permission.COMMAND_READ)
    repo = ScheduleRepository(session)
    item = repo.get(schedule_id)
    if item is None or item.device_id != device_id or item.organization_id != access.organization_id:
        raise HTTPException(404, "Ресурс не знайдено")
    result = []
    for occurrence, command in repo.history(schedule_id):
        row = ScheduleOccurrenceRead.model_validate(occurrence)
        if command:
            row.status = command.status
            row.reason = command.error_code
        result.append(row)
    return result

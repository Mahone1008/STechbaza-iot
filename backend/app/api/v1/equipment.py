import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.models.equipment import PumpInstallation
from app.models.site import Site
from app.schemas.equipment import (
    ConfigurationCreate, ConfigurationRead, EquipmentPassport, InstallationCreate,
    InstallationRead, ModuleCreate, ModuleRead, ProfileRead, ReplacementCreate, CommissionRequest,
)
from app.security.authorization import AccessControl
from app.security.current_user import CurrentUserContext, get_current_user_context
from app.security.roles import Permission
from app.services.equipment import EquipmentConflict, EquipmentService, desired_configuration, read_configuration
from app.services.equipment_profiles import profiles

router = APIRouter(tags=["equipment"])
DbSession = Annotated[Session, Depends(get_db_session)]
CurrentUser = Annotated[CurrentUserContext, Depends(get_current_user_context)]


@router.get("/equipment/profiles", response_model=list[ProfileRead])
def list_profiles(current: CurrentUser) -> list[ProfileRead]:
    return profiles()


@router.get("/devices/{device_id}/equipment", response_model=EquipmentPassport)
def equipment_passport(device_id: uuid.UUID, session: DbSession, current: CurrentUser) -> EquipmentPassport:
    device = AccessControl(session, current).require_device(device_id, Permission.DEVICE_READ)
    return EquipmentService(session).passport(device)


@router.post("/sites/{site_id}/installations", response_model=InstallationRead, status_code=201)
def create_installation(site_id: uuid.UUID, payload: InstallationCreate, session: DbSession,
                        current: CurrentUser) -> InstallationRead:
    AccessControl(session, current).require_site(site_id, Permission.CAPABILITY_MANAGE)
    session.scalar(select(Site).where(Site.id == site_id).with_for_update())
    if session.scalar(select(func.count()).select_from(PumpInstallation).where(PumpInstallation.site_id == site_id)) >= 100:
        raise HTTPException(409, "Досягнуто межу 100 установок на об'єкті")
    installation = PumpInstallation(site_id=site_id, name=payload.name.strip())
    session.add(installation)
    session.commit()
    return InstallationRead.model_validate(installation)


@router.post("/devices/{device_id}/equipment/modules", response_model=ModuleRead, status_code=201)
def create_module(device_id: uuid.UUID, payload: ModuleCreate, session: DbSession, current: CurrentUser) -> ModuleRead:
    AccessControl(session, current).require_device(device_id, Permission.CAPABILITY_MANAGE)
    try:
        return ModuleRead.model_validate(EquipmentService(session).add_module(device_id, payload))
    except EquipmentConflict as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/devices/{device_id}/equipment/configurations", response_model=ConfigurationRead, status_code=201)
def configure_equipment(device_id: uuid.UUID, payload: ConfigurationCreate, session: DbSession,
                        current: CurrentUser) -> ConfigurationRead:
    AccessControl(session, current).require_device(device_id, Permission.CAPABILITY_MANAGE)
    try:
        return read_configuration(EquipmentService(session).configure(device_id, payload, current))
    except EquipmentConflict as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/devices/{device_id}/equipment/manifest", response_class=Response)
def equipment_manifest(device_id: uuid.UUID, session: DbSession, current: CurrentUser) -> Response:
    AccessControl(session, current).require_device(device_id, Permission.CAPABILITY_MANAGE)
    row = desired_configuration(session, device_id)
    if row is None:
        raise HTTPException(404, "Конфігурацію ще не створено")
    return Response(row.canonical_manifest, media_type="application/json",
                    headers={"ETag": f'"{row.configuration_hash}"', "Cache-Control": "no-store"})


@router.post("/devices/{device_id}/equipment/replacement", response_model=ModuleRead, status_code=201)
def replace_equipment(device_id: uuid.UUID, payload: ReplacementCreate, session: DbSession, current: CurrentUser):
    AccessControl(session, current).require_device(device_id, Permission.CAPABILITY_MANAGE)
    try:
        return EquipmentService(session).replace(device_id, payload, current)
    except EquipmentConflict as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/devices/{device_id}/equipment/commission", response_model=EquipmentPassport)
def commission_equipment(device_id: uuid.UUID, payload: CommissionRequest, session: DbSession, current: CurrentUser):
    from app.services.controller_lifecycle import commission
    try:
        return commission(session, current, device_id, payload)
    except EquipmentConflict as exc:
        raise HTTPException(409, str(exc)) from exc

import hmac
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.auth import _throttle
from app.db import get_db_session
from app.models import Device, Site
from app.models.onboarding import FactoryController, FactoryAudit
from app.schemas.equipment import ModuleRead
from app.schemas.onboarding import BootstrapContact, ClaimRequest, ConnectionRead, EquipmentSelection, FactoryCreate, FactoryRead, FactorySecrets, ShipmentRequest
from app.schemas.site import SiteRead
from app.security.account_keys import digest
from app.security.authorization import AccessControl
from app.security.current_user import CurrentUserContext, get_current_user_context
from app.security.roles import Permission, PlatformRole
from app.security.tokens import utc_now
from app.services.onboarding import audit, claim, connection_read, locked_controller, register_controller, select_equipment

router = APIRouter(tags=["onboarding"])
Db = Annotated[Session, Depends(get_db_session)]
Current = Annotated[CurrentUserContext, Depends(get_current_user_context)]


def manufacturer(session: Session, current: CurrentUserContext):
    AccessControl(session, current).require_platform_role(PlatformRole.SUPERADMIN)
    # Manufacturing secrets always require a completed MFA session, including demo.
    if current.auth_session.mfa_verified_at is None:
        raise HTTPException(403, "Налаштуйте двоетапний вхід у безпеці облікового запису та увійдіть із кодом")


@router.get("/factory/controllers", response_model=list[FactoryRead])
def factory_list(current: Current, session: Db, limit: Annotated[int, Query(ge=1, le=100)] = 50,
                 offset: Annotated[int, Query(ge=0)] = 0):
    manufacturer(session, current)
    return list(session.scalars(select(FactoryController).order_by(FactoryController.created_at.desc(), FactoryController.id).limit(limit).offset(offset)))


@router.post("/factory/controllers", response_model=FactorySecrets, status_code=201)
def factory_create(payload: FactoryCreate, request: Request, response: Response, current: Current, session: Db):
    manufacturer(session, current)
    _throttle(request, session, email=current.user.email)
    try:
        result = register_controller(session, current, payload)
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(409, "Серійний номер уже зареєстровано; ключі не замінено") from exc
    response.headers["Cache-Control"] = "no-store"
    return result


@router.post("/factory/controllers/{controller_id}/shipments", response_model=FactoryRead)
def shipment(controller_id: uuid.UUID, payload: ShipmentRequest, current: Current, session: Db):
    manufacturer(session, current)
    row = locked_controller(session, controller_id)
    if row.status != "ready":
        raise HTTPException(409, "Передати можна лише неприв’язаний контролер")
    row.distributor = payload.distributor
    audit(session, row, current, "shipped", distributor=payload.distributor, reference=payload.reference)
    session.commit()
    return row


@router.get("/factory/controllers/{controller_id}/audit")
def factory_audit(controller_id: uuid.UUID, current: Current, session: Db,
                  limit: Annotated[int, Query(ge=1, le=100)] = 50, offset: Annotated[int, Query(ge=0)] = 0):
    manufacturer(session, current)
    rows = session.scalars(select(FactoryAudit).where(FactoryAudit.controller_id == controller_id)
                           .order_by(FactoryAudit.occurred_at.desc(), FactoryAudit.id).limit(limit).offset(offset))
    return [dict(id=row.id, action=row.action, occurred_at=row.occurred_at, actor_user_id=row.actor_user_id, details=row.details) for row in rows]


@router.get("/connect/sites", response_model=list[SiteRead])
def buyer_sites(current: Current, session: Db, limit: Annotated[int, Query(ge=1, le=100)] = 100,
                offset: Annotated[int, Query(ge=0)] = 0):
    # Use the same authorization as the final claim; a service account can only add
    # to sites for which it already has the explicitly assigned device permission.
    access = AccessControl(session, current)
    organization_ids = [row.id for row in access.list_visible_organizations(limit=100, offset=0)]
    items = session.scalars(select(Site).where(Site.organization_id.in_(organization_ids)).order_by(Site.name, Site.id).limit(limit).offset(offset))
    allowed = []
    for item in items:
        try:
            access.require_site(item.id, Permission.DEVICE_CREATE)
        except HTTPException as exc:
            if exc.status_code not in (403, 404):
                raise
        else:
            allowed.append(item)
    return allowed


@router.get("/connect/{controller_id}", response_model=ConnectionRead)
def connection(controller_id: uuid.UUID, current: Current, response: Response, session: Db):
    row = session.get(FactoryController, controller_id)
    if row is None:
        raise HTTPException(404, "Контролер недоступний")
    response.headers["Cache-Control"] = "no-store"
    return connection_read(session, current, row)


@router.post("/connect/{controller_id}/claim", response_model=ConnectionRead)
def claim_controller(controller_id: uuid.UUID, payload: ClaimRequest, request: Request, current: Current, session: Db):
    _throttle(request, session, email=f"claim:{current.user.id}:{controller_id}")
    return claim(session, current, controller_id, payload)


@router.put("/connect/{controller_id}/equipment", response_model=ModuleRead)
def equipment_selection(controller_id: uuid.UUID, payload: EquipmentSelection, current: Current, session: Db):
    return select_equipment(session, current, controller_id, payload)


@router.post("/bootstrap/{controller_id}/contact", response_model=ConnectionRead)
def bootstrap_contact(controller_id: uuid.UUID, payload: BootstrapContact, request: Request, response: Response, session: Db,
                      authorization: Annotated[str | None, Header(max_length=128)] = None):
    _throttle(request, session, email=f"bootstrap:{controller_id}")
    row = locked_controller(session, controller_id)
    token = authorization.removeprefix("Bearer ") if authorization and authorization.startswith("Bearer ") else ""
    if row.status not in ("ready", "claimed") or not row.bootstrap_hash or not hmac.compare_digest(row.bootstrap_hash, digest("bootstrap", token)):
        raise HTTPException(401, "Контролер не авторизований")
    row.last_contact_at, row.firmware_version = utc_now(), payload.firmware_version
    session.commit()
    # No owner identity, Wi-Fi password, history or command endpoint is exposed.
    response.headers["Cache-Control"] = "no-store"
    device = session.get(Device, row.device_id) if row.device_id else None
    return ConnectionRead(controller_id=row.id, serial_number=row.serial_number, hardware_model=row.hardware_model,
                          state=row.status, device_id=row.device_id, site_id=device.site_id if device else None,
                          last_contact_at=row.last_contact_at, firmware_version=row.firmware_version)

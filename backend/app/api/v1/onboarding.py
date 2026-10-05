import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.auth_throttle import throttle_auth, throttle_bootstrap
from app.db import get_db_session
from app.repositories.factory import FactoryRepository
from app.schemas.equipment import ModuleRead
from app.schemas.onboarding import (
    BootstrapContact,
    ClaimRequest,
    ActivationAccessRead,
    ConnectionRead,
    EquipmentSelection,
    FactoryCreate,
    FactoryRead,
    FactorySecrets,
    ShipmentRequest,
    BootstrapConfiguration,
    ControllerOperation,
    ControllerStatus,
    TransferRead,
    FactoryQuarantine,
    FactoryReset,
)
from app.schemas.site import SiteRead
from app.security.authorization import AccessControl
from app.security.current_user import CurrentUserContext, get_current_user_context
from app.security.roles import PlatformRole
from app.services.onboarding import (
    claim,
    connection_read,
    register_controller,
    select_equipment,
    record_shipment,
    bootstrap_contact as contact_controller,
)

router = APIRouter(tags=["onboarding"])
Db = Annotated[Session, Depends(get_db_session)]
Current = Annotated[CurrentUserContext, Depends(get_current_user_context)]


def manufacturer(session: Session, current: CurrentUserContext):
    AccessControl(session, current).require_platform_role(PlatformRole.SUPERADMIN)
    # Manufacturing secrets always require a completed MFA session, including demo.
    if current.auth_session.mfa_verified_at is None:
        raise HTTPException(
            403, "Налаштуйте двоетапний вхід у безпеці облікового запису та увійдіть із кодом"
        )


@router.get("/factory/controllers", response_model=list[FactoryRead])
def factory_list(
    current: Current,
    session: Db,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    manufacturer(session, current)
    return FactoryRepository(session).list_controllers(limit=limit, offset=offset)


@router.post("/factory/controllers", response_model=FactorySecrets, status_code=201)
def factory_create(
    payload: FactoryCreate, request: Request, response: Response, current: Current, session: Db
):
    manufacturer(session, current)
    throttle_auth(request, session, email=current.user.email)
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
    return record_shipment(session, current, controller_id, payload)


@router.get("/factory/controllers/{controller_id}/audit")
def factory_audit(
    controller_id: uuid.UUID,
    current: Current,
    session: Db,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    manufacturer(session, current)
    rows = FactoryRepository(session).list_audit(controller_id, limit=limit, offset=offset)
    return [
        dict(
            id=row.id,
            action=row.action,
            occurred_at=row.occurred_at,
            actor_user_id=row.actor_user_id,
            details=row.details,
        )
        for row in rows
    ]


@router.get("/connect/sites", response_model=list[SiteRead])
def buyer_sites(
    current: Current,
    session: Db,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    if current.user.login_name and current.user.login_name.startswith("kr-"):
        return []
    return AccessControl(session, current).list_creatable_sites(limit=limit, offset=offset)


@router.get("/connect/{controller_id}", response_model=ConnectionRead)
def connection(controller_id: uuid.UUID, current: Current, response: Response, session: Db):
    row = FactoryRepository(session).get(controller_id)
    if row is None:
        raise HTTPException(404, "Контролер недоступний")
    response.headers["Cache-Control"] = "no-store"
    return connection_read(session, current, row)


@router.post("/connect/{controller_id}/claim", response_model=ConnectionRead)
def claim_controller(
    controller_id: uuid.UUID, payload: ClaimRequest, request: Request, current: Current, session: Db
):
    throttle_auth(request, session, email=f"claim:{current.user.id}:{controller_id}")
    return claim(session, current, controller_id, payload)


@router.post("/connect/{controller_id}/security", response_model=ActivationAccessRead)
def activation_security(
    controller_id: uuid.UUID, request: Request, response: Response, current: Current, session: Db
):
    from app.services.account_security import AccountSecurityService

    throttle_auth(request, session, email=f"activation-security:{current.user.id}")
    response.headers["Cache-Control"] = "no-store"
    return AccountSecurityService(session).prepare_activation(current, controller_id)


@router.put("/connect/{controller_id}/equipment", response_model=ModuleRead)
def equipment_selection(
    controller_id: uuid.UUID, payload: EquipmentSelection, current: Current, session: Db
):
    return select_equipment(session, current, controller_id, payload)


@router.post("/bootstrap/{controller_id}/contact", response_model=ConnectionRead)
def bootstrap_contact(
    controller_id: uuid.UUID,
    payload: BootstrapContact,
    request: Request,
    response: Response,
    session: Db,
    authorization: Annotated[str | None, Header(max_length=128)] = None,
):
    throttle_auth(request, session, email=f"bootstrap:{controller_id}")
    token = (
        authorization.removeprefix("Bearer ")
        if authorization and authorization.startswith("Bearer ")
        else ""
    )
    response.headers["Cache-Control"] = "no-store"
    return contact_controller(session, controller_id, payload, token)


@router.post("/bootstrap/{controller_id}/configuration", response_model=BootstrapConfiguration)
def bootstrap_configuration(
    controller_id: uuid.UUID,
    payload: BootstrapContact,
    request: Request,
    response: Response,
    session: Db,
    authorization: Annotated[str | None, Header(max_length=128)] = None,
):
    from app.services.controller_lifecycle import bootstrap_configuration as configure

    throttle_bootstrap(request, session, controller_id)
    response.headers["Cache-Control"] = "no-store"
    token = (
        authorization.removeprefix("Bearer ")
        if authorization and authorization.startswith("Bearer ")
        else ""
    )
    return configure(session, controller_id, payload, token)


@router.get("/connect/{controller_id}/status", response_model=ControllerStatus)
def lifecycle_status(controller_id: uuid.UUID, current: Current, session: Db, response: Response):
    from app.services.controller_lifecycle import controller_status

    response.headers["Cache-Control"] = "no-store"
    return controller_status(session, current, controller_id)


@router.post(
    "/connect/{controller_id}/access/{operation}", response_model=ControllerStatus | TransferRead
)
def controller_operation(
    controller_id: uuid.UUID,
    operation: Literal["rotate", "revoke", "release"],
    payload: ControllerOperation,
    request: Request,
    response: Response,
    current: Current,
    session: Db,
):
    from app.services.controller_lifecycle import operate
    from app.services.equipment import EquipmentConflict

    throttle_auth(request, session, email=f"controller-operation:{current.user.id}")
    response.headers["Cache-Control"] = "no-store"
    try:
        return operate(session, current, controller_id, operation, payload)
    except EquipmentConflict as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/factory/controllers/{controller_id}/quarantine", response_model=FactoryRead)
def quarantine_controller(
    controller_id: uuid.UUID, payload: FactoryQuarantine, current: Current, session: Db
):
    from app.services import controller_credentials as credentials
    from app.services.onboarding import audit, locked_controller

    manufacturer(session, current)
    row = locked_controller(session, controller_id)
    row.status, row.bootstrap_hash, row.activation_hash = "quarantined", None, None
    if row.device_id:
        credentials.revoke(session, row)
    audit(session, row, current, "quarantined", reason=payload.reason)
    session.commit()
    if row.device_id:
        credentials.synchronize(row.device_id)
    return row


@router.post("/factory/controllers/{controller_id}/reset", response_model=FactorySecrets)
def reset_controller(
    controller_id: uuid.UUID,
    payload: FactoryReset,
    current: Current,
    session: Db,
    response: Response,
):
    from app.services.controller_lifecycle import factory_reset

    manufacturer(session, current)
    response.headers["Cache-Control"] = "no-store"
    return factory_reset(session, current, controller_id, payload)

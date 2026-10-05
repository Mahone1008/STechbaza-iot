"""One transaction claims one physical controller and creates its tenant context."""

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Device, Organization, OrganizationMembership, Site, User
from app.models.equipment import EquipmentModule, PumpInstallation
from app.models.onboarding import FactoryAudit, FactoryController, PersonalWorkspace
from app.schemas.onboarding import (
    BootstrapContact,
    ClaimRequest,
    ConnectionRead,
    EquipmentSelection,
    FactoryCreate,
    FactoryRead,
    FactorySecrets,
    ShipmentRequest,
)
from app.security.account_keys import digest, new_key, verify_digest
from app.repositories.factory import FactoryRepository
from app.security.authorization import AccessControl
from app.security.current_user import CurrentUserContext
from app.security.roles import Permission
from app.security.tokens import utc_now
from app.security.mfa_policy import require_privileged_mfa
from app.services.equipment_profiles import get_profile


def locked_controller(session: Session, controller_id: uuid.UUID) -> FactoryController:
    row = FactoryRepository(session).get(controller_id, lock=True)
    if row is None:
        raise HTTPException(404, "Контролер недоступний")
    return row


def audit(
    session: Session,
    row: FactoryController,
    current: CurrentUserContext | None,
    action: str,
    **details,
):
    session.add(
        FactoryAudit(
            controller_id=row.id,
            actor_user_id=current.user.id if current else None,
            actor_session_id=current.auth_session.id if current else None,
            action=action,
            occurred_at=utc_now(),
            details=details,
        )
    )


def register_controller(
    session: Session, current: CurrentUserContext, payload: FactoryCreate
) -> FactorySecrets:
    activation, bootstrap = new_key(), new_key()
    row = FactoryController(
        **payload.model_dump(exclude={"factory_test_passed"}),
        status="ready",
        generation=1,
        activation_hash=digest("activation", activation),
        bootstrap_hash=digest("bootstrap", bootstrap),
    )
    session.add(row)
    session.flush()
    audit(session, row, current, "registered", test_reference=payload.test_reference)
    session.commit()
    return FactorySecrets(
        controller=FactoryRead.model_validate(row),
        qr_path=f"/connect/{row.id}",
        activation_code=activation,
        bootstrap_key=bootstrap,
    )


def connection_read(
    session: Session, current: CurrentUserContext, row: FactoryController
) -> ConnectionRead:
    if row.status not in ("ready", "claimed"):
        raise HTTPException(404, "Контролер недоступний")
    device = None
    if row.device_id:
        device = AccessControl(session, current).require_device(
            row.device_id, Permission.DEVICE_READ
        )
    return ConnectionRead(
        controller_id=row.id,
        serial_number=row.serial_number,
        hardware_model=row.hardware_model,
        state=row.status,
        device_id=device.id if device else None,
        site_id=device.site_id if device else None,
        last_contact_at=row.last_contact_at,
        firmware_version=row.firmware_version,
    )


def claim(
    session: Session, current: CurrentUserContext, controller_id: uuid.UUID, payload: ClaimRequest
) -> ConnectionRead:
    # Serialise creation of the buyer workspace even for two different controllers.
    user = session.scalar(
        select(User)
        .where(User.id == current.user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None or not user.is_active:
        raise HTTPException(401, "Сесію завершено")
    row = locked_controller(session, controller_id)
    if row.status == "claimed":
        # A repeated response can be recovered without recreating a site. Rights are rechecked.
        return connection_read(session, current, row)
    if row.status != "ready" or not verify_digest(
        "activation", payload.activation_code, row.activation_hash
    ):
        raise HTTPException(404, "Контролер або код активації недоступний")
    if payload.site_id:
        site = AccessControl(session, current).require_site(
            payload.site_id, Permission.DEVICE_CREATE
        )
        # Keep membership mutation and claim linearised on the organization lock.
        session.scalar(
            select(Organization.id).where(Organization.id == site.organization_id).with_for_update()
        )
        AccessControl(session, current).require_site(site.id, Permission.DEVICE_CREATE)
    else:
        require_privileged_mfa(current, "owner")
        workspace = session.get(PersonalWorkspace, user.id)
        if workspace is None:
            organization = Organization(
                id=uuid.uuid4(), name=user.display_name, slug=f"buyer-{user.id.hex}", is_active=True
            )
            session.add(organization)
            session.flush()
            session.add(
                OrganizationMembership(
                    organization_id=organization.id, user_id=user.id, role="owner", is_active=True
                )
            )
            workspace = PersonalWorkspace(user_id=user.id, organization_id=organization.id)
            session.add(workspace)
            session.flush()
        else:
            session.scalar(
                select(Organization.id)
                .where(Organization.id == workspace.organization_id)
                .with_for_update()
            )
            AccessControl(session, current).require_organization(
                workspace.organization_id, Permission.SITE_CREATE
            )
        site = Site(
            id=uuid.uuid4(),
            organization_id=workspace.organization_id,
            name=payload.new_site.name,
            code=f"site-{uuid.uuid4().hex}",
            timezone=payload.new_site.timezone,
        )
        session.add(site)
        session.flush()
    device = Device(
        id=uuid.uuid4(),
        site_id=site.id,
        uid=f"FC-{row.id.hex}-G{row.generation}",
        name=payload.device_name,
        device_type="kerumo_v3",
        lifecycle_status="provisioning",
    )
    session.add(device)
    session.flush()
    row.device_id, row.status, row.claimed_at, row.activation_hash = (
        device.id,
        "claimed",
        utc_now(),
        None,
    )
    audit(
        session,
        row,
        current,
        "claimed",
        device_id=str(device.id),
        site_id=str(site.id),
        generation=row.generation,
    )
    session.commit()
    return connection_read(session, current, row)


def select_equipment(
    session: Session,
    current: CurrentUserContext,
    controller_id: uuid.UUID,
    payload: EquipmentSelection,
):
    row = locked_controller(session, controller_id)
    if row.status != "claimed" or row.device_id is None:
        raise HTTPException(409, "Спочатку активуйте контролер")
    device = AccessControl(session, current).require_device(
        row.device_id, Permission.CAPABILITY_MANAGE
    )
    session.scalar(select(Device.id).where(Device.id == device.id).with_for_update())
    profile = get_profile(payload.profile_id, payload.profile_version)
    if profile is None:
        raise HTTPException(422, "Профіль моделі не знайдено")
    existing = session.scalar(
        select(EquipmentModule).where(
            EquipmentModule.device_id == device.id, EquipmentModule.slot == "vfd-1"
        )
    )
    if existing:
        if (
            existing.manufacturer,
            existing.series,
            existing.model,
            existing.hardware_revision,
            existing.software_revision,
        ) != (
            profile.manufacturer,
            profile.series,
            payload.model,
            payload.hardware_revision,
            payload.software_revision,
        ):
            raise HTTPException(
                409,
                "Паспорт уже збережено. Заміна обладнання потребує окремого підтвердження зупинки",
            )
        return existing
    installation = PumpInstallation(
        id=uuid.uuid4(), site_id=device.site_id, name="Насосна установка"
    )
    session.add(installation)
    session.flush()
    module = EquipmentModule(
        device_id=device.id,
        installation_id=installation.id,
        slot="vfd-1",
        kind="vfd",
        name="Частотний перетворювач",
        manufacturer=profile.manufacturer,
        series=profile.series,
        model=payload.model,
        hardware_revision=payload.hardware_revision,
        software_revision=payload.software_revision,
    )
    session.add(module)
    audit(
        session,
        row,
        current,
        "equipment_selected",
        profile_id=profile.id,
        profile_version=profile.version,
        model=payload.model,
    )
    session.commit()
    return module


def record_shipment(
    session: Session,
    current: CurrentUserContext,
    controller_id: uuid.UUID,
    payload: ShipmentRequest,
) -> FactoryController:
    row = locked_controller(session, controller_id)
    if row.status != "ready":
        raise HTTPException(409, "Передати можна лише неприв’язаний контролер")
    row.distributor = payload.distributor
    audit(
        session,
        row,
        current,
        "shipped",
        distributor=payload.distributor,
        reference=payload.reference,
    )
    session.commit()
    return row


def bootstrap_contact(
    session: Session, controller_id: uuid.UUID, payload: BootstrapContact, token: str
) -> ConnectionRead:
    row = locked_controller(session, controller_id)
    if row.status not in ("ready", "claimed") or not verify_digest(
        "bootstrap", token, row.bootstrap_hash
    ):
        raise HTTPException(401, "Контролер не авторизований")
    row.last_contact_at, row.firmware_version = utc_now(), payload.firmware_version
    # Successful use migrates an old digest to the current dedicated root key.
    row.bootstrap_hash = digest("bootstrap", token)
    session.commit()
    device = session.get(Device, row.device_id) if row.device_id else None
    return ConnectionRead(
        controller_id=row.id,
        serial_number=row.serial_number,
        hardware_model=row.hardware_model,
        state=row.status,
        device_id=row.device_id,
        site_id=device.site_id if device else None,
        last_contact_at=row.last_contact_at,
        firmware_version=row.firmware_version,
    )

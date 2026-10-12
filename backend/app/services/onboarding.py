"""One transaction claims one physical controller and creates its tenant context."""

import uuid
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import AuthSession, Capability, Device, DeviceCapability, Organization, OrganizationMembership, Site, User
from app.models.command import DeviceCommand
from app.models.equipment import EquipmentConfiguration, EquipmentModule, PumpInstallation
from app.models.schedule import DeviceSchedule
from app.models.onboarding import (
    AccountSecurity,
    FactoryAudit,
    FactoryController,
    PersonalWorkspace,
)
from app.schemas.onboarding import (
    BootstrapContact,
    ClaimRequest,
    ConnectionRead,
    EquipmentSelection,
    FactoryCreate,
    FactoryRead,
    FactorySecrets,
    ShipmentRequest,
    FactoryTransportUpdate,
)
from app.security.account_keys import digest, new_key, verify_digest
from app.repositories.factory import FactoryRepository
from app.repositories.telemetry import TelemetryRepository
from app.security.authorization import AccessControl
from app.security.current_user import CurrentUserContext
from app.security.roles import Permission, role_has_permission
from app.security.tokens import utc_now
from app.security.passwords import hash_password, verify_password
from app.security.mfa_policy import require_privileged_mfa
from app.services.equipment_profiles import get_profile, selectable_manufacturer
from app.services.label_accounts import permanent_login, renew_label
from app.services.telemetry_quality import freshness
from app.services.telemetry_read_config import TELEMETRY_STALE_AFTER_SECONDS


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
    renew_label(row)
    audit(session, row, current, "registered", test_reference=payload.test_reference,
          network_transport=payload.network_transport)
    session.commit()
    return FactorySecrets(
        controller=factory_read(session, row),
        qr_path=f"/connect/{row.id}",
        activation_code=activation,
        bootstrap_key=bootstrap,
        setup_password=new_key()[:20],
        login=row.buyer_login,
        password=activation,
    )


def initial_equipment_editable(session: Session, row: FactoryController, device: Device | None) -> bool:
    """An unused passport may be corrected; commissioned bindings remain immutable."""
    if row.status != "claimed" or row.access_revoked or device is None or device.lifecycle_status != "provisioning":
        return False
    for query in (
        select(EquipmentConfiguration.device_id).where(EquipmentConfiguration.device_id == device.id),
        select(DeviceCommand.id).where(DeviceCommand.device_id == device.id),
        select(DeviceSchedule.id).where(DeviceSchedule.device_id == device.id, DeviceSchedule.enabled),
        select(DeviceCapability.id).join(Capability).where(
            DeviceCapability.device_id == device.id, DeviceCapability.is_enabled,
            Capability.code.in_(("vfd.control", "vfd.program", "vfd.schedule")),
        ),
    ):
        if session.scalar(query.limit(1)) is not None:
            return False
    return True


def transport_editable(session: Session, row: FactoryController) -> bool:
    if (row.status not in ("ready", "claimed") or row.access_revoked
            or row.credential_revision != 0):
        return False
    # A rejected transport mismatch never receives a broker key. A manufacturer can
    # correct that untouched kit to the transport proven by its private board key.
    if row.last_contact_at is not None and row.last_contact_transport == row.network_transport:
        return False
    return row.device_id is None or initial_equipment_editable(session, row, session.get(Device, row.device_id))


def factory_read(session: Session, row: FactoryController) -> FactoryRead:
    result = FactoryRead.model_validate(row)
    result.transport_editable = transport_editable(session, row)
    return result


def update_factory_transport(session: Session, current: CurrentUserContext,
                             controller_id: uuid.UUID, payload: FactoryTransportUpdate) -> FactoryRead:
    row = locked_controller(session, controller_id)
    if row.device_id:
        session.scalar(select(Device.id).where(Device.id == row.device_id).with_for_update())
    if row.generation != payload.expected_generation or not transport_editable(session, row):
        raise HTTPException(409, "Тип мережі можна уточнити лише до першого підключення та налаштування плати")
    if row.last_contact_at is not None and payload.network_transport != row.last_contact_transport:
        raise HTTPException(409, "Оберіть тип мережі, який підтвердила плата своїм заводським ключем")
    if row.network_transport != payload.network_transport:
        previous = row.network_transport
        row.network_transport = payload.network_transport
        audit(session, row, current, "network_transport_corrected", previous_transport=previous,
              network_transport=payload.network_transport, generation=row.generation)
    session.commit()
    return factory_read(session, row)


def connection_details(session: Session, row: FactoryController, device: Device | None) -> dict:
    snapshot = TelemetryRepository(session).get_state(device.id) if device else None
    now = utc_now()
    state = "not_connected"
    if row.last_contact_at is not None:
        if row.last_contact_transport != row.network_transport:
            state = "transport_mismatch"
        elif row.access_revoked:
            state = "offline"
        elif snapshot and freshness(snapshot, device_session_id=device.last_observed_session_id, now=now).status == "fresh":
            state = "online"
        elif snapshot or now - row.last_contact_at > timedelta(seconds=TELEMETRY_STALE_AFTER_SECONDS):
            state = "offline"
        else:
            state = "bootstrap_connected"
    return dict(network_transport=row.network_transport, last_contact_transport=row.last_contact_transport,
                telemetry_received_at=snapshot.last_received_at if snapshot else None,
                connection_state=state, initial_equipment_editable=initial_equipment_editable(session, row, device))


def connection_read(
    session: Session, current: CurrentUserContext, row: FactoryController
) -> ConnectionRead:
    if row.status not in ("ready", "claimed"):
        raise HTTPException(404, "Контролер недоступний")
    device = None
    can_manage = False
    if row.device_id:
        access = AccessControl(session, current)
        context = access.require_device_context(
            row.device_id, Permission.DEVICE_READ
        )
        device = context.device
        can_manage = access.is_superadmin or role_has_permission(context.organization_role, Permission.CAPABILITY_MANAGE)
    details = connection_details(session, row, device)
    details["initial_equipment_editable"] = can_manage and details["initial_equipment_editable"]
    return ConnectionRead(
        controller_id=row.id,
        serial_number=row.serial_number,
        hardware_model=row.hardware_model,
        state=row.status,
        device_id=device.id if device else None,
        site_id=device.site_id if device else None,
        last_contact_at=row.last_contact_at,
        firmware_version=row.firmware_version,
        activation_required=row.buyer_user_id != current.user.id,
        permanent_login=permanent_login(current.user)
        if row.status == "ready"
        and row.buyer_user_id == current.user.id
        and current.user.login_name == row.buyer_login
        else None,
        **details,
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
    security = session.scalar(
        select(AccountSecurity)
        .where(AccountSecurity.user_id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    row = locked_controller(session, controller_id)
    if row.status == "claimed":
        # A repeated response can be recovered without recreating a site. Rights are rechecked.
        return connection_read(session, current, row)
    if row.status != "ready" or not (
        row.buyer_user_id == current.user.id
        or verify_digest("activation", payload.activation_code or "", row.activation_hash)
    ):
        raise HTTPException(404, "Контролер або код активації недоступний")
    label_buyer = row.buyer_user_id == user.id and user.login_name == row.buyer_login
    if user.login_name and user.login_name.startswith("kr-") and not label_buyer:
        raise HTTPException(403, "Спочатку завершіть активацію свого контролера")
    if label_buyer and payload.new_password is None:
        raise HTTPException(422, "Задайте постійний пароль і збережіть дані входу")
    if label_buyer and verify_password(payload.new_password, user.password_hash):
        raise HTTPException(422, "Постійний пароль має відрізнятися від заводського")
    if not label_buyer and payload.new_password is not None:
        raise HTTPException(422, "Пароль наявного кабінету змінюється в налаштуваннях безпеки")
    if label_buyer:
        if security is None or not security.recovery_hash or security.totp_enabled_at:
            raise HTTPException(422, "Створіть постійний доступ і збережіть ключ відновлення")
        # Clear an unfinished setup from older activation clients; enrollment is optional later.
        security.totp_secret, security.totp_last_counter = None, None
        current.auth_session.mfa_verified_at = None
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
        require_privileged_mfa(current)
        workspace = session.get(PersonalWorkspace, user.id)
        if payload.new_site.organization_id:
            organization_id = payload.new_site.organization_id
            session.scalar(
                select(Organization.id).where(Organization.id == organization_id).with_for_update()
            )
            AccessControl(session, current).require_organization(
                organization_id, Permission.SITE_CREATE
            )
        elif workspace is None or payload.new_site.organization_name:
            organization = Organization(
                id=uuid.uuid4(),
                name=payload.new_site.organization_name or user.display_name,
                slug=f"buyer-{uuid.uuid4().hex}",
                is_active=True,
            )
            session.add(organization)
            session.flush()
            session.add(
                OrganizationMembership(
                    organization_id=organization.id, user_id=user.id, role="owner", is_active=True
                )
            )
            if workspace is None:
                workspace = PersonalWorkspace(user_id=user.id, organization_id=organization.id)
                session.add(workspace)
            session.flush()
            organization_id = organization.id
        else:
            session.scalar(
                select(Organization.id)
                .where(Organization.id == workspace.organization_id)
                .with_for_update()
            )
            AccessControl(session, current).require_organization(
                workspace.organization_id, Permission.SITE_CREATE
            )
            organization_id = workspace.organization_id
        site = Site(
            id=uuid.uuid4(),
            organization_id=organization_id,
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
    # A logged-in customer can attach a new controller to their existing cabinet;
    # its label must never become a second password for that customer's identity.
    if row.buyer_user_id != current.user.id:
        row.buyer_user_id = None
    if label_buyer:
        user.login_name = permanent_login(user)
        user.password_hash = hash_password(payload.new_password)
        session.execute(
            update(AuthSession)
            .where(
                AuthSession.user_id == user.id,
                AuthSession.id != current.auth_session.id,
                AuthSession.revoked_at.is_(None),
            )
            .values(revoked_at=utc_now())
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
    if profile is None or not selectable_manufacturer(profile.manufacturer):
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
            if existing.retired_at is not None or not initial_equipment_editable(session, row, device):
                raise HTTPException(
                    409,
                    "Обладнання вже налаштовано. Заміна потребує окремого підтвердження зупинки",
                )
            keys = ("manufacturer", "series", "model", "hardware_revision", "software_revision")
            previous = {key: getattr(existing, key) for key in keys}
            for key, value in zip(keys, (profile.manufacturer, profile.series, payload.model,
                                        payload.hardware_revision, payload.software_revision)):
                setattr(existing, key, value)
            audit(session, row, current, "initial_equipment_corrected", module_id=str(existing.id),
                  previous=previous, profile_id=profile.id, profile_version=profile.version,
                  model=payload.model)
            session.commit()
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
    row.last_contact_transport = payload.network_transport
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
        **connection_details(session, row, device),
    )

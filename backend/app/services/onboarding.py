"""One transaction claims one physical controller and creates its tenant context."""

import uuid

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import AuthSession, Device, Organization, OrganizationMembership, Site, User
from app.models.equipment import EquipmentModule, PumpInstallation
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
)
from app.security.account_keys import digest, new_key, verify_digest
from app.repositories.factory import FactoryRepository
from app.security.authorization import AccessControl
from app.security.current_user import CurrentUserContext
from app.security.roles import Permission
from app.security.tokens import utc_now
from app.security.passwords import hash_password, verify_password
from app.security.account_keys import verify_stored_totp
from app.security.mfa_policy import require_privileged_mfa
from app.services.equipment_profiles import get_profile
from app.services.label_accounts import permanent_login, renew_label


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
    audit(session, row, current, "registered", test_reference=payload.test_reference)
    session.commit()
    return FactorySecrets(
        controller=FactoryRead.model_validate(row),
        qr_path=f"/connect/{row.id}",
        activation_code=activation,
        bootstrap_key=bootstrap,
        setup_password=new_key()[:20],
        login=row.buyer_login,
        password=activation,
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
        activation_required=row.buyer_user_id != current.user.id,
        permanent_login=permanent_login(current.user)
        if row.status == "ready"
        and row.buyer_user_id == current.user.id
        and current.user.login_name == row.buyer_login
        else None,
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
        if (
            security is None
            or not security.totp_secret
            or not security.recovery_hash
            or security.totp_enabled_at
        ):
            raise HTTPException(422, "Налаштуйте двоетапний вхід у майстрі активації")
        counter, encrypted = verify_stored_totp(
            security.totp_secret, payload.otp or "", security.totp_last_counter
        )
        if counter is None:
            raise HTTPException(422, "Введіть чинний код із застосунку автентифікації")
        security.totp_last_counter, security.totp_secret = counter, encrypted
        security.totp_enabled_at = utc_now()
        current.auth_session.mfa_verified_at = utc_now()
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

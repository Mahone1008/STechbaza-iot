"""Підключення, commissioning і передача без перенесення tenant-історії."""

import os

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from app.models import (
    Capability,
    ControllerCredential,
    Device,
    DeviceCapability,
    Site,
    FactoryController,
)
from app.schemas.onboarding import (
    BootstrapConfiguration,
    ControllerStatus,
    TransferRead,
    FactorySecrets,
    FactoryRead,
)
from app.security.account_keys import digest, new_key, verify_digest
from app.security.authorization import AccessControl
from app.security.roles import Permission
from app.security.tokens import utc_now
from app.services import controller_credentials as credentials
from app.services.account_security import AccountSecurityService
from app.services.equipment import (
    EquipmentConflict,
    EquipmentService,
    desired_configuration,
    require_stopped,
)
from app.services.onboarding import audit, locked_controller
from app.services.label_accounts import renew_label


def install_capabilities(session, device, limits, *, enabled, mode="read_only"):
    names = {
        "vfd.frequency.read": "Вихідна частота",
        "vfd.set_frequency.read": "Задана частота",
        "vfd.current.read": "Струм",
        "vfd.voltage.read": "Напруга",
        "vfd.state.read": "Стан частотника",
        "vfd.diagnostics.read": "Діагностика",
        "vfd.control": "Керування частотником",
        "vfd.program": "Етапи роботи",
        "vfd.schedule": "Розклади",
    }
    for code, name in names.items():
        session.execute(
            insert(Capability)
            .values(code=code, name=name)
            .on_conflict_do_nothing(index_elements=["code"])
        )
        cap = session.scalar(select(Capability).where(Capability.code == code))
        assignment = session.scalar(
            select(DeviceCapability).where(
                DeviceCapability.device_id == device.id, DeviceCapability.capability_id == cap.id
            )
        )
        if assignment is None:
            assignment = DeviceCapability(device_id=device.id, capability_id=cap.id)
            session.add(assignment)
        controlled = code in ("vfd.control", "vfd.program", "vfd.schedule")
        assignment.is_enabled = not controlled or (
            enabled and mode != "read_only" and (code == "vfd.control" or mode == "extended_test")
        )
        if code == "vfd.control":
            assignment.config = {
                "driver_profile": "suswe.su600.delta_m.v1",
                "frequency_limits": limits,
                "bench_without_motor": mode != "extended_test",
                **({"test_session": "extended"} if mode == "extended_test" else {}),
            }
        elif code == "vfd.state.read":
            assignment.config = {"telemetry_keys": ["pump_running", "vfd_fault_code"]}
        else:
            assignment.config = {}


def commission(session, current, device_id, payload):
    device = AccessControl(session, current).require_device(device_id, Permission.CAPABILITY_MANAGE)
    session.scalar(select(Device.id).where(Device.id == device_id).with_for_update())
    passport = EquipmentService(session).passport(device)
    if passport.controller_id:
        factory = session.get(FactoryController, passport.controller_id)
        if factory.status != "claimed" or factory.access_revoked:
            raise EquipmentConflict("Спочатку відновіть доступ контролера")
    if (
        not passport.desired
        or passport.desired.manifest.revision != payload.expected_revision
        or passport.configuration_state != "verified"
    ):
        raise EquipmentConflict("Потрібне свіже підтвердження саме цієї конфігурації")
    require_stopped(session, device, utc_now())
    if payload.control_mode == "extended_test":
        installed = next(
            (item for item in passport.modules if item.id == passport.desired.manifest.module_id),
            None,
        )
        if installed is None or installed.motor is None:
            raise EquipmentConflict(
                "Перед випробуванням з двигуном внесіть його паспорт у налаштуванні підключення"
            )
    install_capabilities(
        session,
        device,
        passport.desired.manifest.frequency_limits.model_dump(),
        enabled=True,
        mode=payload.control_mode,
    )
    device.lifecycle_status = "active"
    if passport.controller_id:
        row = session.get(FactoryController, passport.controller_id)
        audit(
            session,
            row,
            current,
            "commissioned",
            revision=payload.expected_revision,
            mode=payload.control_mode,
        )
    session.commit()
    return EquipmentService(session).passport(device)


def bootstrap_configuration(session, controller_id, payload, token):
    row = locked_controller(session, controller_id)
    if not verify_digest("bootstrap", token, row.bootstrap_hash):
        raise HTTPException(401, "Контролер не авторизований")
    row.last_contact_at, row.firmware_version = utc_now(), payload.firmware_version
    row.bootstrap_hash = digest("bootstrap", token)
    if row.status in ("quarantined", "retired", "releasing") or row.access_revoked:
        session.commit()
        return BootstrapConfiguration(state="revoked")
    if row.status == "ready":
        session.commit()
        return BootstrapConfiguration(state="waiting")
    device = session.get(Device, row.device_id)
    credential = session.get(ControllerCredential, device.id)
    if credential is None:
        credential = credentials.issue(session, row, device)
    session.commit()
    credentials.synchronize(device.id)
    # Повторний lock захищає відповідь від одночасної передачі або ротації.
    row = locked_controller(session, controller_id)
    if row.status != "claimed" or row.access_revoked or row.device_id != device.id:
        return BootstrapConfiguration(state="revoked")
    credential = session.get(ControllerCredential, device.id, populate_existing=True)
    if credential.revoked or credential.applied_revision != credential.revision:
        raise HTTPException(503, "Ключ ще не підтверджено шлюзом")
    configuration = desired_configuration(session, device.id)
    if device.lifecycle_status in ("maintenance", "retired"):
        configuration = None
    host = os.getenv("CONTROLLER_MQTT_PUBLIC_HOST")
    if not host:
        raise HTTPException(503, "Публічну адресу шлюзу ще не налаштовано")
    return BootstrapConfiguration(
        state="configured",
        device_uid=device.uid,
        mqtt_host=host,
        mqtt_port=int(os.getenv("CONTROLLER_MQTT_PUBLIC_PORT", "8883")),
        mqtt_password=credentials.credential_secret(credential),
        credential_revision=credential.revision,
        manifest=configuration.canonical_manifest if configuration else None,
        configuration_hash=configuration.configuration_hash if configuration else None,
    )


def controller_status(session, current, controller_id):
    row = locked_controller(session, controller_id)
    if not row.device_id:
        raise HTTPException(404, "Контролер недоступний")
    AccessControl(session, current).require_device(row.device_id, Permission.DEVICE_READ)
    credential = session.get(ControllerCredential, row.device_id, populate_existing=True)
    state = (
        "not_issued"
        if credential is None
        else "pending"
        if credential.revision != credential.applied_revision
        else "revoked"
        if credential.revoked
        else "active"
    )
    return ControllerStatus(
        controller_id=row.id,
        generation=row.generation,
        credential_revision=row.credential_revision,
        access_revoked=row.access_revoked,
        last_contact_at=row.last_contact_at,
        credential_state=state,
    )


def operate(session, current, controller_id, operation, payload):
    # Єдиний порядок lock: user/security → factory → device.
    AccountSecurityService(session).prove(current, payload)
    row = locked_controller(session, controller_id)
    if not row.device_id:
        raise HTTPException(404, "Контролер недоступний")
    access = AccessControl(session, current)
    device = access.require_device(row.device_id, Permission.CAPABILITY_MANAGE)
    site = session.get(Site, device.site_id)
    organization = access.require_organization_context(
        site.organization_id, Permission.CAPABILITY_MANAGE
    )
    if operation == "release" and not (
        access.is_superadmin or organization.organization_role == "owner"
    ):
        raise HTTPException(403, "Передати контролер може лише власник")
    session.scalar(select(Device.id).where(Device.id == device.id).with_for_update())
    if row.generation != payload.expected_generation or row.status not in ("claimed", "releasing"):
        raise HTTPException(409, "Стан контролера змінився; оновіть сторінку")
    if row.credential_revision != payload.expected_credential_revision:
        raise HTTPException(409, "Ключ уже змінено; оновіть стан доступу перед новою дією")
    if row.status == "releasing" and operation != "release":
        raise HTTPException(409, "Спочатку завершіть передачу контролера")
    if row.status != "releasing" and (
        operation == "release" or (operation == "rotate" and not row.access_revoked)
    ):
        require_stopped(session, device, utc_now())
    if operation == "rotate":
        credentials.issue(session, row, device)
    else:
        credentials.revoke(session, row)
        controlled = select(Capability.id).where(
            Capability.code.in_(("vfd.control", "vfd.program", "vfd.schedule"))
        )
        session.execute(
            update(DeviceCapability)
            .where(
                DeviceCapability.device_id == device.id,
                DeviceCapability.capability_id.in_(controlled),
            )
            .values(is_enabled=False)
        )
        if operation == "release":
            row.status, device.lifecycle_status = "releasing", "retired"
    audit(
        session,
        row,
        current,
        f"access_{operation}",
        device_id=str(device.id),
        reason=payload.reason,
    )
    session.commit()
    credentials.synchronize(device.id)
    row = locked_controller(session, controller_id)
    if row.generation != payload.expected_generation:
        raise HTTPException(409, "Операцію вже завершено; оновіть сторінку")
    if operation != "release":
        return controller_status(session, current, controller_id)
    if row.status != "releasing" or row.device_id != device.id:
        raise HTTPException(409, "Стан змінився під час передачі; перечитайте реєстр")
    code = new_key()
    row.generation += 1
    row.device_id, row.status, row.claimed_at = None, "ready", None
    renew_label(row)
    row.activation_hash, row.access_revoked = digest("activation", code), False
    row.last_contact_at = None
    audit(
        session,
        row,
        current,
        "released",
        previous_device_id=str(device.id),
        generation=row.generation,
    )
    session.commit()
    return TransferRead(
        controller_id=row.id,
        generation=row.generation,
        qr_path=f"/connect/{row.id}",
        activation_code=code,
        login=row.buyer_login,
        password=code,
    )


def factory_reset(session, current, controller_id, payload):
    row = locked_controller(session, controller_id)
    if row.generation != payload.expected_generation or row.status not in ("ready", "quarantined"):
        raise HTTPException(
            409, "Повернення потребує карантину або неприв’язаного контролера та чинного покоління"
        )
    old_device = row.device_id
    if old_device:
        credentials.revoke(session, row)
        session.scalar(select(Device.id).where(Device.id == old_device).with_for_update())
        session.get(Device, old_device).lifecycle_status = "retired"
        session.execute(
            update(DeviceCapability)
            .where(DeviceCapability.device_id == old_device)
            .values(is_enabled=False)
        )
    session.commit()
    if old_device:
        credentials.synchronize(old_device)
    row = locked_controller(session, controller_id)
    if row.generation != payload.expected_generation or row.status not in ("ready", "quarantined"):
        raise HTTPException(409, "Реєстр уже змінився; перечитайте його")
    activation, bootstrap = new_key(), new_key()
    row.generation += 1
    renew_label(row)
    row.device_id, row.claimed_at, row.last_contact_at = None, None, None
    row.status, row.access_revoked = "ready", False
    row.activation_hash, row.bootstrap_hash = (
        digest("activation", activation),
        digest("bootstrap", bootstrap),
    )
    row.test_reference = payload.test_reference
    audit(
        session,
        row,
        current,
        "factory_reset",
        reason=payload.reason,
        test_reference=payload.test_reference,
        previous_device_id=str(old_device) if old_device else None,
        generation=row.generation,
    )
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

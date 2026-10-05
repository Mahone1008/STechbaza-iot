"""Паспорт, commissioning та перевірка застосованої конфігурації без записів у VFD."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.capability import DeviceCapability
from app.models.onboarding import FactoryController
from app.models.command import DeviceCommand
from app.models.equipment import EquipmentConfiguration, EquipmentModule, PumpInstallation
from app.models.schedule import DeviceSchedule
from app.repositories.devices import DeviceRepository
from app.repositories.telemetry import TelemetryRepository
from app.schemas.equipment import (
    ConfigurationCreate,
    ConfigurationRead,
    EquipmentManifest,
    EquipmentPassport,
    EquipmentReport,
    EquipmentTarget,
    InstallationRead,
    ModuleCreate,
    ModuleRead,
    ReplacementCreate,
)
from app.services.equipment_profiles import canonical_json, configuration_hash, get_profile
from app.services.telemetry_quality import freshness


class EquipmentConflict(Exception):
    """Конфлікт ревізії, непідтверджений STOP або несумісна конфігурація."""


def desired_configuration(session: Session, device_id) -> EquipmentConfiguration | None:
    return session.scalar(
        select(EquipmentConfiguration)
        .where(EquipmentConfiguration.device_id == device_id)
        .order_by(EquipmentConfiguration.revision.desc())
        .limit(1)
    )


def read_configuration(row: EquipmentConfiguration) -> ConfigurationRead:
    return ConfigurationRead(
        manifest=EquipmentManifest.model_validate_json(row.canonical_manifest),
        configuration_hash=row.configuration_hash,
        created_at=row.created_at,
        actor_user_id=row.actor_user_id,
    )


def configuration_target(row: EquipmentConfiguration | None) -> dict | None:
    if row is None:
        return None
    manifest = read_configuration(row).manifest
    return EquipmentTarget(
        binding_id=manifest.binding_id,
        revision=manifest.revision,
        configuration_hash=row.configuration_hash,
    ).model_dump(mode="json")


def read_report(snapshot) -> EquipmentReport | None:
    raw = (snapshot.diagnostics or {}).get("equipment") if snapshot else None
    try:
        return EquipmentReport.model_validate(raw) if raw is not None else None
    except ValueError:
        return None


def configuration_state(device, row, snapshot, now) -> str:
    report = read_report(snapshot)
    if device.lifecycle_status in ("maintenance", "retired"):
        return "incompatible"
    if row is None:
        # Managed firmware не повинна отримувати legacy-команди навіть після втрати серверного manifest.
        return "mismatch" if report else "legacy"
    if report is None:
        return "awaiting"
    wanted = read_configuration(row).manifest
    expected = {
        key: value
        for key, value in wanted.model_dump(mode="json").items()
        if key in EquipmentReport.model_fields
    }
    expected["configuration_hash"] = row.configuration_hash
    actual = report.model_dump(mode="json")
    if any(actual[key] != value for key, value in expected.items()):
        return "mismatch"
    profile = get_profile(wanted.profile_id, wanted.profile_version)
    if (
        not report.compatible
        or profile is None
        or profile.profile_hash != wanted.profile_hash
        or profile.driver_id != wanted.driver_id
        or profile.driver_version != wanted.driver_version
        or profile.command_protocol != report.command_protocol
    ):
        return "incompatible"
    if (
        freshness(snapshot, device_session_id=device.last_observed_session_id, now=now).status
        != "fresh"
    ):
        return "stale"
    return "verified"


def command_target(session, device, now, *, stop=False) -> dict | None:
    if device.uid.startswith("FC-"):
        factory = session.scalar(
            select(FactoryController).where(FactoryController.device_id == device.id)
        )
        if factory and (factory.access_revoked or factory.status != "claimed"):
            raise EquipmentConflict("Доступ контролера відкликано")
    row = desired_configuration(session, device.id)
    if device.uid.startswith("FC-") and (row is None or device.lifecycle_status == "retired"):
        raise EquipmentConflict("Завершіть налаштування та підтвердження обладнання")
    snapshot = TelemetryRepository(session).get_state(device.id)
    state = configuration_state(device, row, snapshot, now)
    if state == "legacy":
        return None
    # STOP може доставлятися за старої телеметрії, але тільки тій самій підтвердженій прив'язці.
    if state != "verified" and not (stop and state == "stale"):
        raise EquipmentConflict("Конфігурацію обладнання ще не підтверджено контролером")
    return configuration_target(row)


def equipment_rejection(session, device, command, now) -> str | None:
    try:
        target = command_target(session, device, now, stop=command.command_type == "vfd.stop")
    except EquipmentConflict:
        return "equipment_configuration_unconfirmed"
    return None if command.equipment_target == target else "equipment_binding_changed"


def require_stopped(session, device, now):
    snapshot = TelemetryRepository(session).get_state(device.id)
    if (
        snapshot is None
        or freshness(snapshot, device_session_id=device.last_observed_session_id, now=now).status
        != "fresh"
        or snapshot.state.get("pump_running") is not False
        or snapshot.state.get("control_armed") is not False
        or snapshot.values.get("vfd.frequency_hz") != 0
    ):
        raise EquipmentConflict("Потрібні свіжі дані: двигун зупинений, 0 Гц, керування DISARM")
    if session.scalar(
        select(func.count())
        .select_from(DeviceSchedule)
        .where(DeviceSchedule.device_id == device.id, DeviceSchedule.enabled)
    ):
        raise EquipmentConflict("Перед зміною обладнання вимкніть збережені розклади")
    if session.scalar(
        select(DeviceCommand.id)
        .where(
            DeviceCommand.device_id == device.id,
            DeviceCommand.status.in_(("queued", "published", "acknowledged")),
        )
        .limit(1)
    ):
        raise EquipmentConflict("Спочатку дочекайтеся завершення попередніх команд")


class EquipmentService:
    def __init__(self, session: Session):
        self.session = session

    def passport(self, device: Device, now=None) -> EquipmentPassport:
        snapshot = TelemetryRepository(self.session).get_state(device.id)
        row = desired_configuration(self.session, device.id)
        installations = self.session.scalars(
            select(PumpInstallation)
            .where(PumpInstallation.site_id == device.site_id)
            .order_by(PumpInstallation.created_at, PumpInstallation.id)
        ).all()
        modules = self.session.scalars(
            select(EquipmentModule)
            .where(EquipmentModule.device_id == device.id)
            .order_by(EquipmentModule.slot)
        ).all()
        return EquipmentPassport(
            device_id=device.id,
            controller_uid=device.uid,
            firmware_version=(snapshot.diagnostics or {}).get("firmware_version")
            if snapshot
            else None,
            installations=[InstallationRead.model_validate(item) for item in installations],
            modules=[ModuleRead.model_validate(item) for item in modules],
            desired=read_configuration(row) if row else None,
            reported=read_report(snapshot),
            configuration_state=configuration_state(
                device, row, snapshot, now or datetime.now(timezone.utc)
            ),
            controller_id=self.session.scalar(
                select(FactoryController.id).where(FactoryController.device_id == device.id)
            ),
        )

    def add_module(self, device_id, payload: ModuleCreate) -> EquipmentModule:
        device = DeviceRepository(self.session).get_for_update(device_id)
        installation = self.session.get(PumpInstallation, payload.installation_id)
        if not installation or installation.site_id != device.site_id:
            raise EquipmentConflict("Установка повинна належати тому самому об'єкту")
        existing = self.session.scalars(
            select(EquipmentModule).where(EquipmentModule.device_id == device_id)
        ).all()
        if len(existing) >= 32 or any(item.slot == payload.slot for item in existing):
            raise EquipmentConflict("Це місце вже зайняте або досягнуто межу 32 модулів")
        data = payload.model_dump(mode="python")
        if payload.motor:
            data["motor"] = payload.motor.model_dump(mode="json")
        module = EquipmentModule(device_id=device_id, **data)
        self.session.add(module)
        self.session.commit()
        return module

    def configure(
        self, device_id, payload: ConfigurationCreate, current, now=None
    ) -> EquipmentConfiguration:
        now = now or datetime.now(timezone.utc)
        device = DeviceRepository(self.session).get_for_update(device_id)
        previous = desired_configuration(self.session, device_id)
        if payload.expected_revision != (previous.revision if previous else 0):
            raise EquipmentConflict("Конфігурацію вже змінено; перечитайте паспорт")
        module = self.session.get(EquipmentModule, payload.module_id)
        if (
            not module
            or module.device_id != device_id
            or module.kind != "vfd"
            or module.retired_at is not None
        ):
            raise EquipmentConflict("Частотник не належить цьому контролеру")
        profile = get_profile(payload.profile_id, payload.profile_version)
        if (
            not profile
            or profile.support != "bench_limited"
            or not profile.driver_id
            or profile.manufacturer.casefold() != module.manufacturer.casefold()
            or profile.series.casefold() != module.series.casefold()
            or profile.tested_model.casefold() != module.model.casefold()
        ):
            raise EquipmentConflict("Для цієї моделі ще немає перевіреного драйвера")
        # Поки реалізований лише стендовий транспорт SU600; жодних припущень для інших моделей.
        if payload.bus.model_dump() != {
            "transport": "modbus_rtu",
            "address": 1,
            "baud": 9600,
            "parity": "none",
            "stop_bits": 1,
        }:
            raise EquipmentConflict("Драйвер SU600 v1 підтримує адресу 1, 9600 8N1")
        limits = payload.frequency_limits
        if payload.motor is not None:
            motor = payload.motor.model_dump(mode="json")
            if module.motor is not None and module.motor != motor:
                raise EquipmentConflict(
                    "Зміна наявного паспорта двигуна потребує процедури заміни обладнання"
                )
            module.motor = motor
        if limits.max_hz > 50 or (
            module.motor and limits.max_hz > module.motor["rated_frequency_hz"]
        ):
            raise EquipmentConflict(
                "Межі установки перевищують перевірений профіль або паспорт двигуна"
            )
        initial_factory_setup = (
            previous is None
            and device.uid.startswith("FC-")
            and device.lifecycle_status == "provisioning"
        )
        if not initial_factory_setup and device.lifecycle_status != "maintenance":
            require_stopped(self.session, device, now)
        old = read_configuration(previous).manifest if previous else None
        changed_module = old is None or old.module_id != module.id
        manifest = EquipmentManifest(
            device_uid=device.uid,
            module_id=module.id,
            binding_id=uuid.uuid4() if changed_module else old.binding_id,
            binding_generation=(old.binding_generation if old else 0) + int(changed_module),
            revision=payload.expected_revision + 1,
            profile_id=profile.id,
            profile_version=profile.version,
            profile_hash=profile.profile_hash,
            driver_id=profile.driver_id,
            driver_version=profile.driver_version,
            bus=payload.bus,
            frequency_limits=limits,
        )
        canonical = canonical_json(manifest.model_dump(mode="json"))
        row = EquipmentConfiguration(
            device_id=device_id,
            revision=manifest.revision,
            module_id=module.id,
            configuration_hash=configuration_hash(canonical),
            canonical_manifest=canonical,
            actor_user_id=current.user.id,
            actor_auth_session_id=current.auth_session.id,
            created_at=now,
        )
        self.session.add(row)
        if device.uid.startswith("FC-") or device.lifecycle_status == "maintenance":
            from app.services.controller_lifecycle import install_capabilities

            install_capabilities(
                self.session, device, manifest.frequency_limits.model_dump(), enabled=False
            )
            device.lifecycle_status = "provisioning"
        self.session.commit()
        return row

    def replace(self, device_id, payload: ReplacementCreate, current):
        device = DeviceRepository(self.session).get_for_update(device_id)
        previous = desired_configuration(self.session, device_id)
        if payload.expected_revision != (previous.revision if previous else 0):
            raise EquipmentConflict("Паспорт змінився; перечитайте його")
        old = self.session.get(EquipmentModule, payload.expected_module_id)
        if not old or old.device_id != device_id or old.retired_at or old.kind != "vfd":
            raise EquipmentConflict("Цей частотник уже замінено або він недоступний")
        if (
            payload.replacement.slot != old.slot
            or payload.replacement.installation_id != old.installation_id
            or payload.replacement.kind != "vfd"
        ):
            raise EquipmentConflict("Заміна повинна залишитися на тому самому місці установки")
        if (
            self.session.scalar(
                select(func.count())
                .select_from(EquipmentModule)
                .where(EquipmentModule.device_id == device_id)
            )
            >= 32
        ):
            raise EquipmentConflict("Досягнуто межу історії 32 модулів; зверніться до сервісу")
        now = datetime.now(timezone.utc)
        require_stopped(self.session, device, now)
        old.retired_at, old.slot = now, f"retired.{old.id.hex}"
        self.session.flush()
        module = EquipmentModule(device_id=device_id, **payload.replacement.model_dump(mode="json"))
        # UUID залишаються UUID для PostgreSQL; JSON потрібен лише для motor.
        module.installation_id = payload.replacement.installation_id
        self.session.add(module)
        self.session.flush()
        device.lifecycle_status = "maintenance"
        self.session.execute(
            update(DeviceCapability)
            .where(DeviceCapability.device_id == device_id)
            .values(is_enabled=False)
        )
        from app.services.onboarding import audit

        factory = self.session.scalar(
            select(FactoryController).where(FactoryController.device_id == device_id)
        )
        if factory:
            audit(
                self.session,
                factory,
                current,
                "equipment_replaced",
                old_module_id=str(old.id),
                new_module_id=str(module.id),
                reason=payload.reason,
            )
        self.session.commit()
        return module

"""Первинна підготовка без розширення технічних прав клієнта."""
import uuid
from dataclasses import dataclass

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.models import Device, FactoryAudit, FactoryController, Organization, Site, User
from app.models.equipment import EquipmentConfiguration, EquipmentModule, PumpInstallation
from app.models.owner_setup import DeviceSetupDraft
from app.repositories.memberships import MembershipRepository
from app.repositories.telemetry import TelemetryRepository
from app.schemas.equipment import BusSettings, CommissionRequest, ConfigurationCreate
from app.schemas.onboarding import FactoryEquipmentSetup
from app.schemas.owner_setup import SetupCheck, SetupEquipmentDraft, SetupRead, SetupScope
from app.security.tokens import utc_now
from app.services.equipment import (
    EquipmentConflict, EquipmentService, configuration_state, desired_configuration,
    read_configuration, require_current_binding, require_stopped,
)
from app.services.factory_preparation import validate_preparation
from app.services.onboarding import audit, locked_controller
from app.services.telemetry_quality import freshness


@dataclass
class SetupContext:
    factory: FactoryController
    device: Device
    organization: Organization
    configuration: EquipmentConfiguration | None
    draft: DeviceSetupDraft | None


def lock_setup_context(session, controller_id) -> SetupContext:
    """Спільний порядок: factory → organization → device → draft → helper."""
    factory = locked_controller(session, controller_id)
    device = session.get(Device, factory.device_id) if factory.device_id else None
    if device is None:
        raise HTTPException(404, "Контролер недоступний")
    site = session.get(Site, device.site_id)
    organization = session.scalar(select(Organization).where(
        Organization.id == site.organization_id).with_for_update().execution_options(populate_existing=True))
    device = session.scalar(select(Device).where(Device.id == device.id)
        .with_for_update().execution_options(populate_existing=True))
    if organization is None or not organization.is_active or device.site_id != site.id:
        raise HTTPException(404, "Контролер недоступний")
    require_current_binding(device, factory)
    draft = session.scalar(select(DeviceSetupDraft).where(DeviceSetupDraft.device_id == device.id)
        .with_for_update().execution_options(populate_existing=True))
    return SetupContext(factory, device, organization, desired_configuration(session, device.id), draft)


def is_setup_owner(session, user_id, organization_id) -> bool:
    user = session.get(User, user_id, populate_existing=True)
    membership = MembershipRepository(session).get_active(user_id, organization_id)
    return bool(user and user.is_active and user.platform_role == "user" and membership
        and membership.role == "owner" and membership.site_ids is None)


def require_owner_context(session, current, controller_id) -> SetupContext:
    session.scalar(select(User).where(User.id == current.user.id).with_for_update()
        .execution_options(populate_existing=True))
    ctx = lock_setup_context(session, controller_id)
    if not is_setup_owner(session, current.user.id, ctx.organization.id):
        raise HTTPException(404, "Первинне налаштування доступне власнику організації")
    return ctx


def initial_setup_open(ctx) -> bool:
    return bool(ctx.device.initial_setup_completed_at is None
        and ctx.device.lifecycle_status == "provisioning" and ctx.factory.control_mode is None
        and ctx.factory.status == "claimed" and not ctx.factory.access_revoked)


def ensure_initial_setup(ctx):
    if not initial_setup_open(ctx):
        raise HTTPException(409, "Первинне налаштування завершене; зміни виконуйте через сервіс")


def check_scope(ctx, payload):
    revision = ctx.configuration.revision if ctx.configuration else 0
    if (payload.expected_generation != ctx.factory.generation
            or payload.expected_credential_revision != ctx.factory.credential_revision
            or payload.expected_configuration_revision != revision):
        raise HTTPException(409, "Прив’язка або конфігурація змінилася; оновіть налаштування")
    if hasattr(payload, "expected_draft_revision") and payload.expected_draft_revision != (ctx.draft.revision if ctx.draft else 0):
        raise HTTPException(409, "Чернетку вже змінено; перечитайте пропозицію перед підтвердженням")


def draft_scope_current(ctx):
    if ctx.draft is None:
        return True
    revision = ctx.configuration.revision if ctx.configuration else 0
    # Перша видача ключа після застосування початкової конфігурації не є
    # ротацією. Контролер ще не міг підтвердити обладнання до bootstrap.
    first_contact = (ctx.draft.credential_revision == 0 and ctx.factory.credential_revision == 1
        and ctx.draft.applied_revision == ctx.draft.revision
        and ctx.draft.applied_configuration_revision == revision)
    return (ctx.draft.controller_generation == ctx.factory.generation
        and ctx.draft.configuration_revision == revision
        and (ctx.draft.credential_revision == ctx.factory.credential_revision or first_contact))


def configured_equipment(session, ctx):
    if ctx.configuration is None:
        module = session.scalar(select(EquipmentModule).where(EquipmentModule.device_id == ctx.device.id,
            EquipmentModule.slot == "vfd-1", EquipmentModule.retired_at.is_(None)))
        return SetupEquipmentDraft(model=module.model, serial_number=module.serial_number,
            hardware_revision=module.hardware_revision, software_revision=module.software_revision,
            motor=module.motor) if module else None
    manifest = read_configuration(ctx.configuration).manifest
    module = session.get(EquipmentModule, manifest.module_id)
    if module is None or module.retired_at is not None:
        return None
    return SetupEquipmentDraft(profile_id=manifest.profile_id, profile_version=manifest.profile_version,
        model=module.model, serial_number=module.serial_number, hardware_revision=module.hardware_revision,
        software_revision=module.software_revision, motor=module.motor,
        frequency_limits=manifest.frequency_limits)


def missing_fields(data):
    result = [key for key in ("profile_id", "model", "frequency_limits") if getattr(data, key) is None]
    for key in ("rated_frequency_hz", "rated_current_a", "rated_voltage_v", "rated_power_kw"):
        if data.motor is None or getattr(data.motor, key) is None:
            result.append(f"motor.{key}")
    return result


def preparation(data):
    try:
        payload = FactoryEquipmentSetup.model_validate(data.model_dump(mode="json"))
    except ValidationError as exc:
        raise HTTPException(409, "Доповніть модель, робочі межі та частоту двигуна в чернетці") from exc
    validate_preparation(payload)
    return payload


def _stopped_error(session, ctx):
    try:
        require_stopped(session, ctx.device, utc_now())
        return None
    except EquipmentConflict as exc:
        return str(exc)


def read_setup(session, ctx, *, can_setup=False) -> SetupRead:
    configured = configured_equipment(session, ctx)
    proposal = SetupEquipmentDraft.model_validate(ctx.draft.data) if ctx.draft else configured or SetupEquipmentDraft()
    stale_draft = not draft_scope_current(ctx)
    differs = stale_draft or ctx.configuration is None or configured is None or proposal != configured
    open_setup = initial_setup_open(ctx)
    snapshot = TelemetryRepository(session).get_state(ctx.device.id)
    fresh = bool(snapshot and freshness(snapshot, device_session_id=ctx.device.last_observed_session_id,
        now=utc_now()).status == "fresh")
    state = configuration_state(ctx.device, ctx.configuration, snapshot, utc_now())
    stopped_error = _stopped_error(session, ctx)
    preparation_error = None
    try:
        preparation(proposal)
    except HTTPException as exc:
        preparation_error = str(exc.detail)
    bus_ok = bool(fresh and snapshot.state.get("vfd_link") is True and snapshot.state.get("vfd_fault_code") == 0)
    network_ok = ctx.factory.last_contact_at is not None and ctx.factory.last_contact_transport == ctx.factory.network_transport
    physical = bool(network_ok and fresh and state == "verified" and stopped_error is None and bus_ok)
    missing = missing_fields(proposal)
    full = ctx.factory.firmware_control_capability == "full"
    target_current = not differs and ctx.configuration is not None
    from app.services.installation_readiness import readiness
    current_readiness = readiness(session, ctx.device, ctx.factory, ctx.configuration, snapshot, state, fresh=fresh)
    checks = [
        SetupCheck(code="draft_context", title="Чернетка відповідає поточній прив’язці",
            status="pending" if stale_draft else "passed", detail=
            "Прив’язка змінилася; звірте поточний паспорт, перевірте та збережіть чернетку ще раз" if stale_draft else None),
        SetupCheck(code="connection", title="Зв’язок із контролером", status="passed" if fresh and network_ok else "pending"),
        SetupCheck(code="equipment", title="Модель і робочі межі", status="passed" if preparation_error is None else "blocked",
            detail=preparation_error),
        SetupCheck(code="motor", title="Паспорт двигуна", status="pending" if missing else "passed"),
        SetupCheck(code="local_confirmation", title="Перевірка біля установки", status="passed" if state == "verified" else
            "blocked" if state == "mismatch" else "pending", detail=None if state == "verified" else
            "Звірте монтаж і налаштування, підтвердьте обладнання в локальному порталі контролера"),
        SetupCheck(code="stopped", title="Двигун зупинений, 0 Гц, керування заблоковане", status="passed" if stopped_error is None else "pending", detail=stopped_error),
        SetupCheck(code="drive", title="Зв’язок із частотником без помилок", status="passed" if bus_ok else "pending"),
        SetupCheck(code="firmware", title="Прошивка підтримує керування", status="passed" if full else "blocked",
            detail=None if full else "Для керування потрібна прошивка Full; спостереження залишається доступним"),
        SetupCheck(code="grant", title="Контролер прийняв дозвіл", status="passed" if current_readiness.state == "ready" else "pending"),
    ]
    return SetupRead(controller_id=ctx.factory.id, device_id=ctx.device.id, generation=ctx.factory.generation,
        credential_revision=ctx.factory.credential_revision,
        configuration_revision=ctx.configuration.revision if ctx.configuration else 0,
        configuration_hash=ctx.configuration.configuration_hash if ctx.configuration else None,
        initial_setup_open=open_setup, can_setup=can_setup, completed_at=ctx.device.initial_setup_completed_at,
        commissioned_control_mode=ctx.factory.control_mode,
        draft_revision=ctx.draft.revision if ctx.draft else 0,
        draft_stale=stale_draft,
        applied_draft_revision=ctx.draft.applied_revision if ctx.draft else None,
        equipment=proposal, configured_equipment=configured, missing_fields=missing, checks=checks,
        progress="ready" if current_readiness.state == "ready" else "connected" if fresh and network_ok else "activated",
        needs_apply=differs,
        can_apply=bool(can_setup and open_setup and ctx.draft and not stale_draft and preparation_error is None
            and (ctx.configuration is None or stopped_error is None)),
        can_accept_control=bool(can_setup and open_setup and target_current and physical and full and not missing),
        can_accept_read_only=bool(can_setup and open_setup and target_current and physical))


def save_draft(session, ctx, payload, *, actor_user_id=None, actor_session_id=None, actor_helper_id=None):
    ensure_initial_setup(ctx)
    check_scope(ctx, payload)
    if ctx.draft is None:
        ctx.draft = DeviceSetupDraft(device_id=ctx.device.id, revision=0)
        session.add(ctx.draft)
    ctx.draft.revision += 1
    ctx.draft.data = payload.equipment.model_dump(mode="json")
    ctx.draft.controller_generation = ctx.factory.generation
    ctx.draft.credential_revision = ctx.factory.credential_revision
    ctx.draft.configuration_revision = ctx.configuration.revision if ctx.configuration else 0
    ctx.draft.updated_at = utc_now()
    ctx.draft.updated_by_user_id, ctx.draft.updated_by_helper_id = actor_user_id, actor_helper_id
    ctx.draft.applied_revision = ctx.draft.applied_configuration_revision = None
    session.flush()
    # Допомога лишається анонімною дією; helper не отримує identity власника.
    session.add(FactoryAudit(controller_id=ctx.factory.id, actor_user_id=actor_user_id,
        actor_session_id=actor_session_id, action="setup_draft_saved", occurred_at=utc_now(), details={
            "device_id": str(ctx.device.id), "draft_revision": ctx.draft.revision,
            "helper_id": str(actor_helper_id) if actor_helper_id else None}))
    return read_setup(session, ctx, can_setup=actor_user_id is not None)


def apply_draft(session, current, ctx, payload):
    ensure_initial_setup(ctx)
    check_scope(ctx, payload)
    if ctx.draft is None:
        raise HTTPException(409, "Спочатку збережіть чернетку обладнання")
    if not draft_scope_current(ctx):
        raise HTTPException(409, "Прив’язка змінилася; перевірте та збережіть чернетку ще раз")
    data = SetupEquipmentDraft.model_validate(ctx.draft.data)
    equipment = preparation(data)
    if ctx.configuration is not None:
        require_stopped(session, ctx.device, utc_now())
    if ctx.configuration is None or data != configured_equipment(session, ctx):
        module = session.scalar(select(EquipmentModule).where(EquipmentModule.device_id == ctx.device.id,
            EquipmentModule.slot == "vfd-1", EquipmentModule.retired_at.is_(None)))
        if module is None:
            installation = PumpInstallation(id=uuid.uuid4(), site_id=ctx.device.site_id, name="Насосна установка")
            session.add(installation)
            session.flush()
            module = EquipmentModule(id=uuid.uuid4(), device_id=ctx.device.id, installation_id=installation.id,
                slot="vfd-1", kind="vfd", name="Частотний перетворювач")
            session.add(module)
        profile = validate_preparation(equipment)
        module.manufacturer, module.series, module.model = profile.manufacturer, profile.series, equipment.model
        module.serial_number, module.hardware_revision, module.software_revision = (
            equipment.serial_number, equipment.hardware_revision, equipment.software_revision)
        module.motor = equipment.motor.model_dump(mode="json") if equipment.motor else None
        session.flush()
        ctx.configuration = EquipmentService(session).configure(ctx.device.id, ConfigurationCreate(
            expected_revision=ctx.configuration.revision if ctx.configuration else 0,
            module_id=module.id, profile_id=profile.id, profile_version=profile.version,
            bus=BusSettings(address=1, baud=9600, parity="none", stop_bits=1),
            frequency_limits=equipment.frequency_limits, motor=equipment.motor), current, commit=False)
    ctx.draft.applied_revision = ctx.draft.revision
    ctx.draft.applied_configuration_revision = ctx.configuration.revision
    ctx.draft.configuration_revision = ctx.configuration.revision
    audit(session, ctx.factory, current, "owner_setup_applied", device_id=str(ctx.device.id),
        draft_revision=ctx.draft.revision, configuration_revision=ctx.configuration.revision)
    from app.services.setup_helpers import invalidate_helpers
    invalidate_helpers(session, ctx.device.id)
    session.flush()
    return read_setup(session, ctx, can_setup=True)


def accept_setup(session, current, ctx, payload):
    check_scope(ctx, SetupScope.model_validate(payload.model_dump(include={
        "expected_generation", "expected_credential_revision", "expected_configuration_revision"})))
    if ctx.configuration is None or ctx.configuration.configuration_hash != payload.expected_configuration_hash:
        raise HTTPException(409, "Підтвердження належить іншій конфігурації; оновіть дані")
    if ctx.device.initial_setup_completed_at is not None:
        # Повтор відповіді не видає новий grant і не скасовує наступне відкликання.
        if (ctx.draft and ctx.draft.accepted_configuration_hash == payload.expected_configuration_hash
                and ctx.draft.accepted_control_mode == payload.control_mode
                and ctx.draft.accepted_draft_revision == payload.expected_draft_revision):
            return read_setup(session, ctx, can_setup=True)
        raise HTTPException(409, "Первинне налаштування вже завершене")
    ensure_initial_setup(ctx)
    check_scope(ctx, payload)
    state = read_setup(session, ctx, can_setup=True)
    allowed = state.can_accept_control if payload.control_mode == "extended_test" else state.can_accept_read_only
    if not allowed:
        raise HTTPException(409, "Дочекайтеся всіх перевірок поточної конфігурації та підтвердіть установку біля контролера")
    if ctx.draft is None:
        # Підготовлений комплект не потребує зайвого кроку чернетки.
        ctx.draft = DeviceSetupDraft(device_id=ctx.device.id, revision=1,
            data=state.equipment.model_dump(mode="json"), controller_generation=ctx.factory.generation,
            credential_revision=ctx.factory.credential_revision, configuration_revision=ctx.configuration.revision,
            applied_revision=1, applied_configuration_revision=ctx.configuration.revision,
            updated_at=utc_now(), updated_by_user_id=current.user.id)
        session.add(ctx.draft)
    from app.services.controller_lifecycle import commission_locked
    commission_locked(session, current, ctx.device, ctx.factory, CommissionRequest(
        expected_revision=ctx.configuration.revision, installation_checked=True, control_mode=payload.control_mode))
    ctx.draft.accepted_configuration_hash = ctx.configuration.configuration_hash
    ctx.draft.accepted_control_mode = payload.control_mode
    ctx.draft.accepted_draft_revision = payload.expected_draft_revision
    audit(session, ctx.factory, current, "owner_setup_accepted", device_id=str(ctx.device.id),
        configuration_revision=ctx.configuration.revision, mode=payload.control_mode)
    from app.services.setup_helpers import invalidate_helpers
    invalidate_helpers(session, ctx.device.id)
    session.flush()
    return read_setup(session, ctx, can_setup=True)

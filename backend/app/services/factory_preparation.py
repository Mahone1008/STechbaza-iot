"""Manufacturer preparation never commissions or grants control to a buyer."""
import uuid

from fastapi import HTTPException
from sqlalchemy import select

from app.models import Device
from app.models.equipment import EquipmentModule, PumpInstallation
from app.schemas.equipment import BusSettings, ConfigurationCreate
from app.schemas.onboarding import FactoryEquipmentSetup
from app.services.equipment import EquipmentConflict, EquipmentService
from app.services.equipment_profiles import get_profile, selectable_manufacturer


def validate_preparation(payload: FactoryEquipmentSetup):
    profile = get_profile(payload.profile_id, payload.profile_version)
    if (profile is None or not selectable_manufacturer(profile.manufacturer)
            or not profile.driver_id or profile.support != "bench_limited"
            or not profile.tested_model or profile.tested_model.casefold() != payload.model.casefold()):
        raise HTTPException(422, "Для повної моделі зі шильдика потрібен перевірений драйвер")
    if payload.frequency_limits.max_hz > 50 or (payload.motor and
            payload.frequency_limits.max_hz > payload.motor.rated_frequency_hz):
        raise HTTPException(422, "Межі перевищують перевірений профіль або паспорт двигуна")
    return profile


def preparation_editable(session, row):
    from app.services.onboarding import initial_equipment_editable
    if row.access_revoked or row.status not in ("ready", "claimed"):
        return False
    return row.device_id is None or initial_equipment_editable(session, row, session.get(Device, row.device_id))


def apply_preparation(session, current, row, device):
    """Called inside claim/update transaction; no partial device or manifest commit."""
    payload = FactoryEquipmentSetup.model_validate(row.prepared_equipment)
    profile = validate_preparation(payload)
    module = session.scalar(select(EquipmentModule).where(
        EquipmentModule.device_id == device.id, EquipmentModule.slot == "vfd-1"))
    if module is None:
        installation = PumpInstallation(id=uuid.uuid4(), site_id=device.site_id, name="Насосна установка")
        session.add(installation)
        session.flush()
        module = EquipmentModule(id=uuid.uuid4(), device_id=device.id,
            installation_id=installation.id, slot="vfd-1", kind="vfd", name="Частотний перетворювач")
        session.add(module)
    module.manufacturer, module.series, module.model = profile.manufacturer, profile.series, payload.model
    module.serial_number, module.hardware_revision, module.software_revision = (
        payload.serial_number, payload.hardware_revision, payload.software_revision)
    module.motor = payload.motor.model_dump(mode="json") if payload.motor else None
    session.flush()
    try:
        EquipmentService(session).configure(device.id, ConfigurationCreate(
            expected_revision=0, module_id=module.id, profile_id=profile.id,
            profile_version=profile.version, bus=BusSettings(address=1, baud=9600, parity="none", stop_bits=1),
            frequency_limits=payload.frequency_limits, motor=payload.motor), current, commit=False)
    except EquipmentConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    return module

"""Спільні межі частоти для ручних команд і програм контролера."""
from sqlalchemy.orm import Session

from app.numeric import finite_number
from app.repositories.capabilities import CapabilityRepository
from app.schemas.command_profile import FrequencyLimits
from app.services.equipment import desired_configuration, read_configuration


def configured_limits(session: Session, device_id) -> FrequencyLimits | None:
    configuration = desired_configuration(session, device_id)
    if configuration is not None:
        return read_configuration(configuration).manifest.frequency_limits
    for item in CapabilityRepository(session).get_enabled_assignments_for_device(device_id):
        if item.capability.code == "vfd.control":
            raw = item.config.get("frequency_limits")
            if raw is None:
                return None
            try:
                return FrequencyLimits.model_validate(raw)
            except ValueError:
                return None  # Відсутня або некоректна конфігурація забороняє дію.
    return None


def frequency_allowed(session: Session, device_id, payload: dict) -> bool:
    limits = configured_limits(session, device_id)
    value = finite_number(payload.get("frequency_hz"))
    return limits is not None and value is not None and limits.min_hz <= value <= limits.max_hz

"""Серверні перевірки доповнюють локальні блокування контролера."""
from app.repositories.capabilities import CapabilityRepository
from app.repositories.telemetry import TelemetryRepository
from app.schemas.program import PROGRAM_ACTIVE_STATES, ProgramPlan, ProgramProgress
from app.services.telemetry_quality import freshness
from app.services.command_profile import configured_limits


def program_rejection(session, device, command_type, payload, now, command_id=None):
    if command_type == "vfd.stop":
        return None
    snapshot = TelemetryRepository(session).get_state(device.id)
    raw = (snapshot.diagnostics or {}).get("program") if snapshot else None
    try:
        progress = ProgramProgress.model_validate(raw) if raw is not None else None
    except ValueError:
        progress = None
    # Активна програма керує частотою; повтор її власного запиту не запускає її знову.
    if progress and progress.state in PROGRAM_ACTIVE_STATES and progress.command_id != command_id:
        return "program_active"
    if command_type != "vfd.program.start":
        return None
    if "vfd.control" not in CapabilityRepository(session).get_enabled_codes_for_device(device.id):
        return "program_control_disabled"
    if progress is None or not progress.ready or freshness(snapshot, device_session_id=device.last_observed_session_id, now=now).status != "fresh":
        return "program_firmware_unavailable"
    if snapshot.state.get("pump_running") is not False and progress.command_id != command_id:
        return "program_requires_stopped_device"
    limits = configured_limits(session, device.id)
    plan = ProgramPlan.model_validate(payload)
    if limits is None or any(not limits.min_hz <= step.frequency_hz <= limits.max_hz for step in plan.steps):
        return "program_frequency_profile_changed"
    return None

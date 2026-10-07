"""Серверні перевірки доповнюють локальні блокування контролера."""
from app.repositories.capabilities import CapabilityRepository
from app.repositories.telemetry import TelemetryRepository
from app.schemas.program import PROGRAM_ACTIVE_STATES, ProgramPlan, ProgramProgress
from app.schemas.schedule import ScheduleRun
from app.services.telemetry_quality import freshness
from app.services.command_profile import configured_limits


def read_program_progress(snapshot):
    raw = (snapshot.diagnostics or {}).get("program") if snapshot else None
    try:
        return ProgramProgress.model_validate(raw) if raw is not None else None
    except ValueError:
        return None


def program_rejection(session, device, command_type, payload, now, command_id=None):
    if command_type == "vfd.stop":
        return None
    if command_type == "vfd.schedule.start" and device.control_mode != "schedule":
        return "control_mode_manual"
    snapshot = TelemetryRepository(session).get_state(device.id)
    progress = read_program_progress(snapshot)
    # Активна програма керує частотою; повтор її власного запиту не запускає її знову.
    if progress and progress.state in PROGRAM_ACTIVE_STATES and progress.command_id != command_id:
        return "program_active"
    if command_type not in {"vfd.program.start", "vfd.schedule.start"}:
        return None
    if "vfd.control" not in CapabilityRepository(session).get_enabled_codes_for_device(device.id):
        return "program_control_disabled"
    if progress is None or not progress.ready or freshness(snapshot, device_session_id=device.last_observed_session_id, now=now).status != "fresh":
        return "program_firmware_unavailable"
    if snapshot.state.get("pump_running") is not False and progress.command_id != command_id:
        return "program_requires_stopped_device"
    limits = configured_limits(session, device.id)
    if command_type == "vfd.schedule.start":
        if "vfd.program" not in CapabilityRepository(session).get_enabled_codes_for_device(device.id):
            return "program_control_disabled"
        if not progress.supports_schedule:
            return "schedule_firmware_unavailable"
        plan = ScheduleRun.model_validate(payload)
        if sum(step.duration_seconds for step in plan.steps) > progress.max_schedule_seconds:
            return "schedule_duration_unsupported"
        if not 0 <= (now - plan.starts_at).total_seconds() < 30 or now >= plan.stops_at:
            return "schedule_window_expired"
    else:
        plan = ProgramPlan.model_validate(payload)
    if limits is None or any(not limits.min_hz <= step.frequency_hz <= limits.max_hz for step in plan.steps):
        return "program_frequency_profile_changed"
    return None

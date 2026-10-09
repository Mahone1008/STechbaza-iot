"""Settings and motion serialize under the existing Device lock and edge ledger."""
from sqlalchemy import select

from app.models.command import DeviceCommand
from app.models.schedule import DeviceSchedule
from app.repositories.telemetry import TelemetryRepository
from app.schemas.vfd_settings import ParameterChange, SourceChange, VfdSettings
from app.services.telemetry_quality import freshness

SETTINGS_COMMANDS = {"vfd.source.set", "vfd.parameter.set"}
STAFF_ROLES = {"superadmin", "service_admin"}
MESSAGES = {
    "vfd_settings_unavailable": "Потрібні свіжі дані контролера з підтримкою налаштувань SU600.",
    "vfd_settings_stopped": "Спочатку зупиніть двигун і дочекайтеся підтвердження 0 Гц без аварій.",
    "vfd_settings_busy": "Дочекайтеся результату попередньої команди та нових показань контролера.",
    "vfd_settings_schedules": "Перед зміною налаштувань вимкніть активні розклади.",
    "vfd_settings_changed": "Налаштування вже змінилися. Оновіть показання та підтвердьте нову дію.",
    "vfd_settings_staff_only": "Зміна F-параметрів доступна лише уповноваженому сервісу.",
    "vfd_local_control": "Частотник керується місцево. Для запуску із сайту увімкніть дистанційне керування.",
}


def read_settings(snapshot):
    raw = (snapshot.diagnostics or {}).get("vfd_settings") if snapshot else None
    try:
        return VfdSettings.model_validate(raw) if raw is not None else None
    except ValueError:
        return None


def settings_rejection(session, device, command_type, payload, now, command_id=None):
    if command_type == "vfd.stop":
        return None
    snapshot = TelemetryRepository(session).get_state(device.id)
    settings = read_settings(snapshot)
    fresh = snapshot is not None and freshness(
        snapshot, device_session_id=device.last_observed_session_id, now=now
    ).status == "fresh"
    changing = command_type in SETTINGS_COMMANDS
    def observed(other):
        return (fresh and settings is not None and other.control_sequence is not None
                and settings.command_sequence >= other.control_sequence
                and snapshot.last_reported_at is not None
                and snapshot.last_reported_at >= other.created_at)
    # An unanswered mutation cannot race a RUN. A same-boot post-operation
    # snapshot is evidence that the synchronous edge handler has returned.
    pending = session.scalars(select(DeviceCommand).where(
        DeviceCommand.device_id == device.id,
        DeviceCommand.status.in_(("queued", "published", "acknowledged", "result_unknown")),
    )).all()
    for other in pending:
        if other.id == command_id:
            continue
        if other.command_type in SETTINGS_COMMANDS:
            if not observed(other):
                return "vfd_settings_busy"
        elif changing and other.status != "result_unknown":
            return "vfd_settings_busy"
    # Result can precede telemetry: wait for the post-operation source snapshot.
    latest = session.scalars(select(DeviceCommand).where(
        DeviceCommand.device_id == device.id,
        DeviceCommand.command_type.in_(SETTINGS_COMMANDS),
        DeviceCommand.status.in_(("succeeded", "failed")),
        DeviceCommand.publish_attempts > 0,
    ).order_by(DeviceCommand.created_at.desc()).limit(1)).first()
    if latest and latest.id != command_id and not observed(latest):
        return "vfd_settings_busy"
    if not changing:
        if fresh and settings is not None and (settings.run_source, settings.frequency_source) != (2, 6):
            return "vfd_local_control"
        return None
    if settings is None or not fresh or settings.run_source not in {0, 2} or settings.frequency_source not in {0, 1, 6}:
        return "vfd_settings_unavailable"
    if (not settings.ready or snapshot.state.get("pump_running") is not False
            or snapshot.state.get("vfd_fault_code") != 0
            or snapshot.state.get("vfd_link") is not True
            or snapshot.values.get("vfd.frequency_hz") != 0):
        return "vfd_settings_stopped"
    if session.scalar(select(DeviceSchedule.id).where(
        DeviceSchedule.device_id == device.id, DeviceSchedule.enabled,
        DeviceSchedule.deleted_at.is_(None),
    ).limit(1)):
        return "vfd_settings_schedules"
    if command_type == "vfd.source.set":
        request = SourceChange.model_validate(payload)
        if (request.expected_run_source, request.expected_frequency_source) != (
                settings.run_source, settings.frequency_source):
            return "vfd_settings_changed"
    else:
        request = ParameterChange.model_validate(payload)
        if settings.parameters.get(request.code) != request.expected_raw:
            return "vfd_settings_changed"
    return None

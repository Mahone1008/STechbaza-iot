"""Зміна режиму під Device-lock: без RUN/STOP та без записів регістрів."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import select

from app.models.event_alarm import DeviceEvent
from app.models.schedule import DeviceSchedule
from app.repositories.capabilities import CapabilityRepository
from app.repositories.commands import CommandRepository
from app.repositories.devices import DeviceRepository
from app.repositories.telemetry import TelemetryRepository
from app.schemas.control_mode import ControlModeRead
from app.services.command_outcomes import stop_delivery
from app.services.program_policy import read_program_progress
from app.services.telemetry_quality import freshness


class ControlModeConflict(Exception):
    pass


def read_control_mode(session, device, now=None):
    now = now or datetime.now(timezone.utc)
    rules = list(session.scalars(select(DeviceSchedule).where(
        DeviceSchedule.device_id == device.id, DeviceSchedule.enabled.is_(True),
        DeviceSchedule.deleted_at.is_(None)).limit(50)))
    starts = [rule.next_start_at for rule in rules if rule.next_start_at and rule.next_start_at > now]
    return ControlModeRead(device_id=device.id, mode=device.control_mode,
        revision=device.control_mode_revision, changed_at=device.control_mode_changed_at,
        enabled_schedule_count=len(rules), next_start_at=min(starts) if starts else None)


def set_control_mode(session, device, mode, actor, now, *, event_id=None, request=None, reason="selection", stop=False):
    """Викликається лише під блокуванням Device; commit належить зовнішній операції."""
    previous = device.control_mode
    if mode != previous:
        if device.control_mode_revision >= 2147483647 and not stop:
            raise ControlModeConflict("Режим потребує перевірки сервісом. Зупинка залишається доступною.")
        device.control_mode = mode
        if device.control_mode_revision < 2147483647:
            device.control_mode_revision += 1
        device.control_mode_changed_at = now
        # Припиняємо майбутню доставку. Опубліковане не називаємо невиконаним;
        # вже прийнятий цикл має власний STOP, а ручний STOP лишається доступним.
        for command in CommandRepository(session).pending_for_device(device.id):
            if command.command_type == "vfd.schedule.start" and command.status in {"queued", "published"}:
                stop_delivery(session, command, now, code="control_mode_changed",
                    message="Режим змінено; подальшу доставку календарного запуску припинено")
    result = read_control_mode(session, device, now)
    session.add(DeviceEvent(id=event_id or uuid.uuid4(), device_id=device.id,
        event_type="device.control_mode_changed", severity="info", source="device",
        occurred_at=now, received_at=now,
        title="Обрано ручне керування" if mode == "manual" else "Увімкнено роботу за розкладом",
        message="Режим застосовується до майбутніх запусків. Прийнятий цикл не запускається повторно.",
        data={"actor_user_id": str(actor.user_id), "actor_organization_id": str(actor.organization_id),
              "actor_auth_session_id": str(actor.auth_session_id) if actor.auth_session_id else None,
              "actor_platform_role": actor.platform_role, "actor_organization_role": actor.organization_role,
              "actor_email": actor.email, "previous_mode": previous, "mode": mode,
              "revision": device.control_mode_revision, "reason": reason,
              "request": request, "response": result.model_dump(mode="json")}))
    return result


class ControlModeService:
    def __init__(self, session):
        self.session = session

    def update(self, device_id, data, actor, *, now=None):
        device = DeviceRepository(self.session).get_for_update(device_id)
        if device is None:
            raise ControlModeConflict("Пристрій недоступний.")
        now = now or datetime.now(timezone.utc)
        previous = self.session.get(DeviceEvent, data.request_id)
        request = data.model_dump(mode="json")
        if previous:
            if (previous.device_id != device_id or previous.event_type != "device.control_mode_changed"
                    or previous.data.get("actor_user_id") != str(actor.user_id)
                    or previous.data.get("actor_organization_id") != str(actor.organization_id)
                    or previous.data.get("request") != request):
                raise ControlModeConflict("Цей запит уже використано. Оновіть панель і повторіть вибір.")
            return ControlModeRead.model_validate(previous.data["response"])
        if device.control_mode_revision != data.expected_revision:
            raise ControlModeConflict("Режим уже змінили. Оновіть панель і підтвердьте актуальний вибір.")
        if data.mode == "schedule" and device.control_mode != "schedule":
            enabled = CapabilityRepository(self.session).get_enabled_codes_for_device(device_id)
            if not {"vfd.control", "vfd.program", "vfd.schedule"} <= enabled:
                raise ControlModeConflict("Розклади недоступні для цього обладнання.")
            current = read_control_mode(self.session, device, now)
            if current.next_start_at is None:
                raise ControlModeConflict("Спочатку збережіть і увімкніть розклад із майбутнім запуском.")
            snapshot = TelemetryRepository(self.session).get_state(device_id)
            progress = read_program_progress(snapshot)
            if (not progress or not progress.supports_schedule or not progress.ready
                    or freshness(snapshot, device_session_id=device.last_observed_session_id, now=now).status != "fresh"):
                raise ControlModeConflict("Очікуємо актуальні дані та готовність контролера до розкладів.")
        result = set_control_mode(self.session, device, data.mode, actor, now,
            event_id=data.request_id, request=request)
        self.session.commit()
        return result

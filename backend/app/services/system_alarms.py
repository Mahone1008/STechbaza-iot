import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.command import DeviceCommand
from app.models.device import Device
from app.models.device_session import DeviceSession
from app.models.event_alarm import DeviceEvent
from app.repositories.alarms import AlarmRepository
from app.services.alarms import AlarmLifecycleService
from app.services.presence_config import DEVICE_ONLINE_TIMEOUT_SECONDS


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class SystemAlarmService:
    """Події та Alarm, породжені станом пристрою і результатами команд.

    Викликач завершує transaction. Для presence/session він уже має
    тримати Device FOR UPDATE; command path бере це блокування тут.
    """

    OFFLINE_KEY = "device.offline"
    REBOOT_KEY = "device.reboot"

    def __init__(self, session: Session) -> None:
        self._session = session
        self._alarms = AlarmRepository(session)
        self._lifecycle = AlarmLifecycleService(session)

    def _event(
        self,
        *,
        device_id: uuid.UUID,
        event_type: str,
        severity: str,
        source: str,
        title: str,
        occurred_at: datetime,
        message: str | None = None,
        source_message_id: uuid.UUID | None = None,
        data: dict[str, Any] | None = None,
    ) -> DeviceEvent:
        event = DeviceEvent(
            device_id=device_id,
            event_type=event_type,
            severity=severity,
            source=source,
            title=title,
            occurred_at=occurred_at,
            source_message_id=source_message_id,
            message=message,
            data=data or {},
        )
        self._session.add(event)
        self._session.flush()
        return event

    def check_offline(
        self,
        *,
        device_id: uuid.UUID,
        now: datetime,
    ) -> bool:
        """Один atomic check під Device lock; online або never-seen ігноруються."""

        device = self._alarms.lock_device(device_id)
        if device is None or device.last_seen_at is None:
            return False
        if _utc(device.last_seen_at) + timedelta(
            seconds=DEVICE_ONLINE_TIMEOUT_SECONDS
        ) >= _utc(now):
            return False
        if self._alarms.get_active_for_update(device_id, self.OFFLINE_KEY):
            return False

        event = self._event(
            device_id=device.id,
            event_type="device.offline",
            severity="warning",
            source="presence",
            title="Втрачено зв'язок із пристроєм",
            occurred_at=_utc(now),
            data={"last_seen_at": _utc(device.last_seen_at).isoformat()},
        )
        self._lifecycle.raise_alarm(
            device_id=device.id,
            alarm_key=self.OFFLINE_KEY,
            alarm_type=self.OFFLINE_KEY,
            severity="warning",
            title=event.title,
            occurred_at=_utc(now),
            event_id=event.id,
            context={"last_seen_at": _utc(device.last_seen_at).isoformat()},
            commit=False,
        )
        return True

    def mark_online(
        self,
        *,
        device: Device,
        occurred_at: datetime,
        source_message_id: uuid.UUID | None = None,
    ) -> bool:
        """Перший свіжий heartbeat/telemetry закриває offline incident."""

        if not self._alarms.get_active_for_update(device.id, self.OFFLINE_KEY):
            return False
        event = self._event(
            device_id=device.id,
            event_type="device.online",
            severity="info",
            source="presence",
            title="Зв'язок із пристроєм відновлено",
            occurred_at=_utc(occurred_at),
            source_message_id=source_message_id,
        )
        self._lifecycle.resolve_alarm(
            device_id=device.id,
            alarm_key=self.OFFLINE_KEY,
            occurred_at=_utc(occurred_at),
            event_id=event.id,
            reason="Зв'язок відновлено",
            commit=False,
        )
        return True

    def has_seen_session(
        self,
        *,
        device_id: uuid.UUID,
        session_id: uuid.UUID,
    ) -> bool:
        return self._session.get(
            DeviceSession, (device_id, session_id)
        ) is not None

    def observe_session(
        self,
        *,
        device: Device,
        session_id: uuid.UUID,
        message_id: uuid.UUID,
        occurred_at: datetime,
        heartbeat_sequence: int | None = None,
    ) -> str:
        """Нова boot session → reboot; старий session не оживляє Device."""

        known = self._session.get(DeviceSession, (device.id, session_id))
        if device.last_observed_session_id != session_id and known is not None:
            return "old_session_reappeared"

        if known is None:
            known = DeviceSession(
                device_id=device.id,
                session_id=session_id,
                first_seen_at=_utc(occurred_at),
            )
            self._session.add(known)

        if known.last_message_id == message_id:
            return "duplicate_message_id"

        if (
            heartbeat_sequence is not None
            and known.last_heartbeat_sequence is not None
            and heartbeat_sequence <= known.last_heartbeat_sequence
        ):
            return "stale_heartbeat_sequence"

        known.last_message_id = message_id
        if heartbeat_sequence is not None:
            known.last_heartbeat_sequence = heartbeat_sequence

        if device.last_observed_session_id == session_id:
            if self._alarms.get_active_for_update(device.id, self.REBOOT_KEY):
                event = self._event(
                    device_id=device.id,
                    event_type="device.reboot.stable",
                    severity="info",
                    source="device",
                    title="Пристрій працює після перезапуску",
                    occurred_at=_utc(occurred_at),
                    source_message_id=message_id,
                    data={"session_id": str(session_id)},
                )
                self._lifecycle.resolve_alarm(
                    device_id=device.id,
                    alarm_key=self.REBOOT_KEY,
                    occurred_at=_utc(occurred_at),
                    event_id=event.id,
                    reason="Надійшов наступний пакет тієї самої session",
                    commit=False,
                )
            return "current_session"

        previous_id = device.last_observed_session_id
        device.last_observed_session_id = session_id
        if previous_id is None:
            return "session_tracking_initialized"

        event = self._event(
            device_id=device.id,
            event_type="device.reboot",
            severity="warning",
            source="device",
            title="Контролер перезапустився",
            occurred_at=_utc(occurred_at),
            source_message_id=message_id,
            data={
                "previous_session_id": str(previous_id),
                "session_id": str(session_id),
            },
        )
        self._lifecycle.raise_alarm(
            device_id=device.id,
            alarm_key=self.REBOOT_KEY,
            alarm_type=self.REBOOT_KEY,
            severity="warning",
            title=event.title,
            occurred_at=_utc(occurred_at),
            event_id=event.id,
            context={"session_id": str(session_id)},
            commit=False,
        )
        return "new_session"

    def record_command_outcome(
        self,
        *,
        command: DeviceCommand,
        occurred_at: datetime,
        source_message_id: uuid.UUID | None = None,
    ) -> bool:
        """Помилка відкриває Alarm для типу команди, пізніший успіх її закриває."""

        if command.status not in {"failed", "expired", "succeeded"}:
            return False
        device = self._alarms.lock_device(command.device_id)
        if device is None:
            return False

        key = f"command.failed.{command.command_type}"
        active = self._alarms.get_active_for_update(device.id, key)
        created_at = _utc(command.created_at)

        if command.status == "succeeded":
            if active is None:
                return False
            failed_at = (active.context or {}).get("command_created_at")
            if failed_at and _utc(datetime.fromisoformat(failed_at)) > created_at:
                return False
            event = self._event(
                device_id=device.id,
                event_type="command.recovered",
                severity="info",
                source="command",
                title="Команда знову виконується",
                occurred_at=_utc(occurred_at),
                source_message_id=source_message_id,
                data={
                    "command_id": str(command.id),
                    "command_type": command.command_type,
                },
            )
            self._lifecycle.resolve_alarm(
                device_id=device.id,
                alarm_key=key,
                occurred_at=_utc(occurred_at),
                event_id=event.id,
                reason="Успішна новіша команда того самого типу",
                commit=False,
            )
            return True

        event = self._event(
            device_id=device.id,
            event_type="command.failed",
            severity="warning",
            source="command",
            title="Команда не виконана",
            occurred_at=_utc(occurred_at),
            source_message_id=source_message_id,
            data={
                "command_id": str(command.id),
                "command_type": command.command_type,
                "status": command.status,
                "error_code": command.error_code,
            },
        )
        # Запізніла помилка не повинна повертати вже виправлену проблему.
        newer_success = self._session.scalar(
            select(DeviceCommand.id)
            .where(
                DeviceCommand.device_id == command.device_id,
                DeviceCommand.command_type == command.command_type,
                DeviceCommand.status == "succeeded",
                DeviceCommand.created_at > command.created_at,
            )
            .limit(1)
        )
        latest_failure = (active.context or {}).get("command_created_at") if active else None
        if newer_success is not None or (
            latest_failure and _utc(datetime.fromisoformat(latest_failure)) > created_at
        ):
            return False

        self._lifecycle.raise_alarm(
            device_id=device.id,
            alarm_key=key,
            alarm_type="command.failed",
            severity="warning",
            title=event.title,
            occurred_at=_utc(occurred_at),
            event_id=event.id,
            context={
                "command_id": str(command.id),
                "command_created_at": created_at.isoformat(),
                "error_code": command.error_code,
            },
            commit=False,
        )
        return True

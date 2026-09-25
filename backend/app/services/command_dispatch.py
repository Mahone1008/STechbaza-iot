import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.command import DeviceCommand
from app.mqtt_client import command_topic, publish_command_message
from app.repositories.commands import CommandRepository
from app.repositories.devices import DeviceRepository
from app.schemas.command import CommandEnvelope
from app.services.device_presence import DevicePresenceService
from app.services.system_alarms import SystemAlarmService


COMMAND_RETRY_INTERVAL_SECONDS = int(
    os.getenv("COMMAND_RETRY_INTERVAL_SECONDS", "10")
)


@dataclass(frozen=True)
class CommandDispatchResult:
    """Результат однієї спроби передати durable-команду в MQTT."""

    command: DeviceCommand
    published: bool
    reason: str
    topic: str | None = None


class CommandDispatchNotFoundError(Exception):
    """Команду для dispatch не знайдено."""


class CommandDispatchService:
    """Надійно публікує queued/published command з row-level locking."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._commands = CommandRepository(session)
        self._devices = DeviceRepository(session)
        self._presence = DevicePresenceService(session)
        self._system_alarms = SystemAlarmService(session)

    def dispatch(
        self,
        command_id: uuid.UUID,
        *,
        now: datetime | None = None,
        allow_retry: bool = False,
    ) -> CommandDispatchResult:
        command = self._commands.get_for_update(command_id)
        if command is None:
            raise CommandDispatchNotFoundError

        current_time = now or datetime.now(timezone.utc)

        if command.status not in {"queued", "published"}:
            return CommandDispatchResult(
                command=command,
                published=False,
                reason=f"status_{command.status}",
            )

        if command.status == "published" and not allow_retry:
            return CommandDispatchResult(
                command=command,
                published=False,
                reason="already_published",
            )

        if command.expires_at <= current_time:
            command.status = "expired"
            command.completed_at = current_time
            command.error_code = "command_expired"
            command.error_message = (
                "TTL команди завершився до підтвердження доставки Device"
            )
            try:
                self._system_alarms.record_command_outcome(
                    command=command,
                    occurred_at=current_time,
                )
                self._session.commit()
            except Exception:
                self._session.rollback()
                raise
            self._session.refresh(command)
            return CommandDispatchResult(
                command=command,
                published=False,
                reason="expired",
            )

        if (
            allow_retry
            and command.last_publish_attempt_at is not None
            and current_time - command.last_publish_attempt_at
            < timedelta(seconds=COMMAND_RETRY_INTERVAL_SECONDS)
        ):
            return CommandDispatchResult(
                command=command,
                published=False,
                reason="retry_not_due",
            )

        device = self._devices.get(command.device_id)
        if device is None:
            return CommandDispatchResult(
                command=command,
                published=False,
                reason="device_not_found",
            )

        availability = self._presence.get_availability(
            device_id=command.device_id,
            now=current_time,
        )
        if not availability.online:
            return CommandDispatchResult(
                command=command,
                published=False,
                reason="device_offline",
            )

        topic = command_topic(device.uid)
        envelope = CommandEnvelope(
            command_id=command.id,
            request_id=command.request_id,
            issued_at=command.created_at,
            expires_at=command.expires_at,
            ttl_seconds=command.ttl_seconds,
            command_type=command.command_type,
            payload=command.payload,
        )

        command.publish_attempts += 1
        command.last_publish_attempt_at = current_time

        published, reason = publish_command_message(
            topic=topic,
            payload=envelope.model_dump(mode="json"),
            command_id=command.id,
            device_uid=device.uid,
        )

        if not published:
            command.last_publish_error = reason
            self._session.commit()
            self._session.refresh(command)
            return CommandDispatchResult(
                command=command,
                published=False,
                reason=reason,
                topic=topic,
            )

        command.status = "published"
        if command.published_at is None:
            command.published_at = current_time
        command.last_publish_error = None
        command.error_code = None
        command.error_message = None

        self._session.commit()
        self._session.refresh(command)

        return CommandDispatchResult(
            command=command,
            published=True,
            reason="published",
            topic=topic,
        )

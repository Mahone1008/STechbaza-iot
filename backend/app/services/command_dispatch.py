import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.command import DeviceCommand
from app.mqtt_client import command_topic, publish_command_message
from app.repositories.commands import CommandRepository
from app.repositories.devices import DeviceRepository
from app.schemas.command import CommandEnvelope


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
    """Перетворює queued command на MQTT message без втрати durable record."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._commands = CommandRepository(session)
        self._devices = DeviceRepository(session)

    def dispatch(
        self,
        command_id: uuid.UUID,
        *,
        now: datetime | None = None,
    ) -> CommandDispatchResult:
        command = self._commands.get(command_id)
        if command is None:
            raise CommandDispatchNotFoundError

        # Повторний HTTP GET/POST не повинен повторно публікувати вже
        # відправлену команду. Повторна доставка буде окремою reliability-логікою.
        if command.status != "queued":
            return CommandDispatchResult(
                command=command,
                published=False,
                reason=f"status_{command.status}",
            )

        current_time = now or datetime.now(timezone.utc)
        if command.expires_at <= current_time:
            command.status = "expired"
            command.completed_at = current_time
            command.error_code = "command_expired"
            command.error_message = "TTL команди завершився до MQTT publish"
            self._session.commit()
            self._session.refresh(command)
            return CommandDispatchResult(
                command=command,
                published=False,
                reason="expired_before_publish",
            )

        device = self._devices.get(command.device_id)
        if device is None:
            # FK з ON DELETE CASCADE робить цей сценарій малоймовірним,
            # але dispatch не має публікувати команду без валідної цілі.
            return CommandDispatchResult(
                command=command,
                published=False,
                reason="device_not_found",
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

        published, reason = publish_command_message(
            topic=topic,
            payload=envelope.model_dump(mode="json"),
            command_id=command.id,
            device_uid=device.uid,
        )
        if not published:
            # Durable record залишається queued. У наступній reliability-операції
            # queued-команди отримають контрольований retry policy.
            return CommandDispatchResult(
                command=command,
                published=False,
                reason=reason,
                topic=topic,
            )

        command.status = "published"
        command.published_at = current_time
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

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.command import DeviceCommand
from app.mqtt_client import command_topic, publish_command_message
from app.repositories.commands import CommandRepository
from app.repositories.devices import DeviceRepository
from app.schemas.command import CommandEnvelope
from app.services.device_presence import DevicePresenceService
from app.services.command_config import result_timeout_seconds, COMMAND_RETRY_INTERVAL_SECONDS
from app.services.command_policy import dispatch_rejection
from app.services.command_outcomes import stop_delivery


@dataclass(frozen=True)
class CommandDispatchResult:
    command: DeviceCommand
    published: bool
    reason: str
    topic: str | None = None


class CommandDispatchNotFoundError(Exception):
    pass


class CommandDispatchService:
    def __init__(self, session: Session) -> None:
        self._session = session
        self._commands = CommandRepository(session)
        self._devices = DeviceRepository(session)
        self._presence = DevicePresenceService(session)

    def dispatch(self, command_id: uuid.UUID, *, now: datetime | None = None,
                 allow_retry: bool = False) -> CommandDispatchResult:
        device_id = self._session.scalar(select(DeviceCommand.device_id).where(DeviceCommand.id == command_id))
        if device_id is None:
            raise CommandDispatchNotFoundError
        # Усі зміни блокують Device перед Command, щоб уникнути взаємного очікування.
        device = self._devices.get_for_update(device_id)
        command = self._commands.get_for_update(command_id)
        if command is None or device is None:
            raise CommandDispatchNotFoundError
        current_time = now or datetime.now(timezone.utc)

        def finish(reason, published=False, topic=None):
            self._session.commit()
            return CommandDispatchResult(command, published, reason, topic)

        if command.status == "acknowledged":
            if command.result_deadline_at is None:
                command.result_deadline_at = (command.acknowledged_at or command.published_at or command.created_at) + timedelta(seconds=result_timeout_seconds(command))
            if command.result_deadline_at <= current_time:
                stop_delivery(self._session, command, current_time, code="command_result_timeout",
                    message="Результат не надійшов; фактичний стан потребує перевірки")
                return finish("result_unknown")
            return finish("awaiting_result")
        if command.status not in {"queued", "published"}:
            return finish(f"status_{command.status}")
        if command.status == "published" and not allow_retry:
            return finish("already_published")
        if command.expires_at <= current_time:
            stop_delivery(self._session, command, current_time, code="command_expired",
                message="Строк доставки минув; відсутність відповіді не доводить невиконання",
                unsent_status="expired")
            return finish(command.status)
        if (allow_retry and command.last_publish_attempt_at is not None
                and current_time - command.last_publish_attempt_at < timedelta(seconds=COMMAND_RETRY_INTERVAL_SECONDS)):
            return finish("retry_not_due")
        rejection = dispatch_rejection(self._session, command, current_time)
        if rejection:
            stop_delivery(self._session, command, current_time, code=rejection,
                message="Подальшу доставку заборонено: змінився доступ, конфігурація або протокол")
            return finish(rejection)
        if not self._presence.get_availability(device_id=device_id, now=current_time).online:
            return finish("device_offline")

        uid = device.uid
        topic = command_topic(uid)
        envelope = CommandEnvelope(schema_version=3 if command.equipment_target else 2,
            equipment_target=command.equipment_target, control_sequence=command.control_sequence,
            command_id=command.id, request_id=command.request_id, issued_at=command.created_at,
            expires_at=command.expires_at, ttl_seconds=command.ttl_seconds,
            command_type=command.command_type, payload=command.payload)
        # Спробу фіксуємо ДО мережевого виклику, щоб збій не приховав можливе виконання.
        # Це також блокує конкурентний повтор до завершення retry interval.
        command.status = "published"
        command.publish_attempts += 1
        command.last_publish_attempt_at = current_time
        command.published_at = command.published_at or current_time
        command.last_publish_error = None
        attempt = command.publish_attempts
        self._session.commit()
        published, reason = publish_command_message(topic=topic,
            payload=envelope.model_dump(mode="json", exclude_none=True), command_id=command_id, device_uid=uid)
        # Під час MQTT publish можуть бути збережені ACK/Result або новий Stop.
        # Не перезаписуємо їхній lifecycle чи діагностику новішої спроби.
        self._devices.get_for_update(device_id)
        command = self._commands.get_for_update(command_id)
        if command is None:
            raise CommandDispatchNotFoundError
        if command.publish_attempts == attempt:
            command.last_publish_error = None if published else reason
        return finish(reason, published, topic)

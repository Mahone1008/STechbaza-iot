from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.command import DeviceCommand
from app.repositories.commands import CommandRepository
from app.repositories.devices import DeviceRepository
from app.schemas.command_ack import CommandAckEnvelope
from app.services.command_outcomes import stop_delivery
from app.services.command_config import COMMAND_RESULT_TIMEOUT_SECONDS


@dataclass(frozen=True)
class CommandAckResult:
    """Результат обробки одного MQTT ACK."""

    command: DeviceCommand
    duplicate: bool
    updated: bool
    reason: str


class CommandAckDeviceNotFoundError(Exception):
    """Device з UID із MQTT topic не знайдено."""


class CommandAckCommandNotFoundError(Exception):
    """ACK посилається на невідомий command_id."""


class CommandAckDeviceMismatchError(Exception):
    """Command належить іншому Device."""


class CommandAckExpiredError(Exception):
    """ACK прийшов після завершення TTL."""


class CommandAckInvalidTransitionError(Exception):
    """ACK не дозволений з поточного lifecycle status."""

    def __init__(self, status: str) -> None:
        super().__init__(status)
        self.status = status


class CommandAckService:
    """Зберігає ACK, включно із запізнілим, без повторного виконання."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._commands = CommandRepository(session)
        self._devices = DeviceRepository(session)

    def acknowledge(
        self,
        *,
        device_uid: str,
        payload: CommandAckEnvelope,
        now: datetime | None = None,
    ) -> CommandAckResult:
        device = self._devices.get_by_uid_for_update(device_uid)
        if device is None:
            raise CommandAckDeviceNotFoundError

        command = self._commands.get_for_update(payload.command_id)
        if command is None:
            raise CommandAckCommandNotFoundError

        if command.device_id != device.id:
            raise CommandAckDeviceMismatchError

        # Receipt time may be later than controller acceptance. Keep the evidence;
        # never reactivate delivery or extend a deadline on a duplicate ACK.
        if command.acknowledged_at is not None or command.status in {"succeeded", "failed"}:
            return CommandAckResult(command, True, False, "already_acknowledged")
        attempted = bool(command.publish_attempts or command.published_at)
        if command.status not in {"published", "result_unknown", "expired"} or not attempted:
            raise CommandAckInvalidTransitionError(command.status)
        current_time = now or datetime.now(timezone.utc)
        late = command.expires_at <= current_time or command.status in {"result_unknown", "expired"}
        command.acknowledged_at = current_time
        if late:
            if command.status != "result_unknown":
                stop_delivery(self._session, command, current_time, code="command_ack_late",
                    message="Прийом підтверджено із затримкою; результат потребує перевірки")
        else:
            command.status = "acknowledged"
            command.result_deadline_at = current_time + timedelta(seconds=COMMAND_RESULT_TIMEOUT_SECONDS)

        self._session.commit()
        self._session.refresh(command)

        return CommandAckResult(
            command=command,
            duplicate=False,
            updated=True,
            reason="late_acknowledged" if late else "acknowledged",
        )


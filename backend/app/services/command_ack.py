from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.command import DeviceCommand
from app.repositories.commands import CommandRepository
from app.repositories.devices import DeviceRepository
from app.schemas.command_ack import CommandAckEnvelope


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
    """Переводить published command у acknowledged за server receipt time."""

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
        device = self._devices.get_by_uid(device_uid)
        if device is None:
            raise CommandAckDeviceNotFoundError

        command = self._commands.get_for_update(payload.command_id)
        if command is None:
            raise CommandAckCommandNotFoundError

        if command.device_id != device.id:
            raise CommandAckDeviceMismatchError

        # Повторний ACK після вже прийнятого ACK/Result є idempotent.
        if command.status in {"acknowledged", "succeeded", "failed"}:
            return CommandAckResult(
                command=command,
                duplicate=True,
                updated=False,
                reason="already_acknowledged",
            )

        current_time = now or datetime.now(timezone.utc)

        if command.status == "expired" or command.expires_at <= current_time:
            if command.status != "expired":
                command.status = "expired"
                command.completed_at = current_time
                command.error_code = "command_expired"
                command.error_message = (
                    "ACK надійшов після завершення TTL команди"
                )
                self._session.commit()
                self._session.refresh(command)
            raise CommandAckExpiredError

        if command.status != "published":
            raise CommandAckInvalidTransitionError(command.status)

        command.status = "acknowledged"
        command.acknowledged_at = current_time

        self._session.commit()
        self._session.refresh(command)

        return CommandAckResult(
            command=command,
            duplicate=False,
            updated=True,
            reason="acknowledged",
        )

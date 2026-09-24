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

        command = self._commands.get(payload.command_id)
        if command is None:
            raise CommandAckCommandNotFoundError

        if command.device_id != device.id:
            raise CommandAckDeviceMismatchError

        # ACK означає лише "Device отримав command".
        # Повторна доставка MQTT ACK після acknowledged є безпечною ідемпотентною.
        if command.status in {"acknowledged", "succeeded", "failed"}:
            return CommandAckResult(
                command=command,
                duplicate=True,
                updated=False,
                reason="already_acknowledged",
            )

        if command.status != "published":
            raise CommandAckInvalidTransitionError(command.status)

        acknowledged_at = now or datetime.now(timezone.utc)
        command.status = "acknowledged"
        command.acknowledged_at = acknowledged_at

        self._session.commit()
        self._session.refresh(command)

        return CommandAckResult(
            command=command,
            duplicate=False,
            updated=True,
            reason="acknowledged",
        )

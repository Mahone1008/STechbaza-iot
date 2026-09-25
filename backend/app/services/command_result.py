from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.command import DeviceCommand
from app.repositories.commands import CommandRepository
from app.repositories.devices import DeviceRepository
from app.schemas.command_result import CommandResultEnvelope
from app.services.system_alarms import SystemAlarmService


@dataclass(frozen=True)
class CommandResultProcessing:
    """Результат обробки одного MQTT command result."""

    command: DeviceCommand
    duplicate: bool
    updated: bool
    reason: str


class CommandResultDeviceNotFoundError(Exception):
    """Device з UID із MQTT topic не знайдено."""


class CommandResultCommandNotFoundError(Exception):
    """Result посилається на невідомий command_id."""


class CommandResultDeviceMismatchError(Exception):
    """Command належить іншому Device."""


class CommandResultExpiredError(Exception):
    """Final result без ACK надійшов після завершення TTL."""


class CommandResultInvalidTransitionError(Exception):
    """Result не дозволений з поточного lifecycle status."""

    def __init__(self, status: str) -> None:
        super().__init__(status)
        self.status = status


class CommandResultConflictError(Exception):
    """Повторний final result суперечить уже збереженому terminal state."""


class CommandResultService:
    """Фіксує фінальний succeeded/failed результат виконання command."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._commands = CommandRepository(session)
        self._devices = DeviceRepository(session)
        self._system_alarms = SystemAlarmService(session)

    @staticmethod
    def _matches_terminal_result(
        command: DeviceCommand,
        payload: CommandResultEnvelope,
    ) -> bool:
        return (
            command.status == payload.status
            and command.result == payload.result
            and command.error_code == payload.error_code
            and command.error_message == payload.error_message
        )

    def complete(
        self,
        *,
        device_uid: str,
        payload: CommandResultEnvelope,
        now: datetime | None = None,
    ) -> CommandResultProcessing:
        device = self._devices.get_by_uid(device_uid)
        if device is None:
            raise CommandResultDeviceNotFoundError

        command = self._commands.get_for_update(payload.command_id)
        if command is None:
            raise CommandResultCommandNotFoundError

        if command.device_id != device.id:
            raise CommandResultDeviceMismatchError

        if command.status in {"succeeded", "failed"}:
            if not self._matches_terminal_result(command, payload):
                raise CommandResultConflictError

            return CommandResultProcessing(
                command=command,
                duplicate=True,
                updated=False,
                reason="already_completed",
            )

        current_time = now or datetime.now(timezone.utc)

        # Якщо ACK вже був прийнятий до deadline, виконання може завершитися
        # пізніше. Але Result не може вперше "підтвердити" прострочену command.
        if (
            command.status == "published"
            and command.expires_at <= current_time
        ):
            command.status = "expired"
            command.completed_at = current_time
            command.error_code = "command_expired"
            command.error_message = (
                "Result без ACK надійшов після завершення TTL команди"
            )
            try:
                self._system_alarms.record_command_outcome(
                    command=command,
                    occurred_at=current_time,
                    source_message_id=payload.message_id,
                )
                self._session.commit()
            except Exception:
                self._session.rollback()
                raise
            self._session.refresh(command)
            raise CommandResultExpiredError

        if command.status == "expired":
            raise CommandResultExpiredError

        if command.status not in {"published", "acknowledged"}:
            raise CommandResultInvalidTransitionError(command.status)

        if command.acknowledged_at is None:
            command.acknowledged_at = current_time

        command.status = payload.status
        command.completed_at = current_time
        command.result = payload.result
        command.error_code = payload.error_code
        command.error_message = payload.error_message

        try:
            self._system_alarms.record_command_outcome(
                command=command,
                occurred_at=current_time,
                source_message_id=payload.message_id,
            )
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise
        self._session.refresh(command)

        return CommandResultProcessing(
            command=command,
            duplicate=False,
            updated=True,
            reason=payload.status,
        )

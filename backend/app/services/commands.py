import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.command import DeviceCommand
from app.repositories.capabilities import CapabilityRepository
from app.repositories.commands import CommandRepository
from app.repositories.devices import DeviceRepository
from app.schemas.command import DeviceCommandCreate


COMMAND_REQUIRED_CAPABILITY: dict[str, str] = {
    "vfd.start": "vfd.control",
    "vfd.stop": "vfd.control",
    "vfd.frequency.set": "vfd.control",
}


class CommandDeviceNotFoundError(Exception):
    """Пристрій для команди не знайдено."""


class CommandNotFoundError(Exception):
    """Команду не знайдено."""


class CommandCapabilityViolationError(Exception):
    """Device не має активної capability для цієї команди."""

    def __init__(self, capability_code: str) -> None:
        super().__init__(capability_code)
        self.capability_code = capability_code


class CommandService:
    """Створює та читає команди без прямого доступу API до MQTT."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._commands = CommandRepository(session)
        self._devices = DeviceRepository(session)
        self._capabilities = CapabilityRepository(session)

    def create(
        self,
        device_id: uuid.UUID,
        payload: DeviceCommandCreate,
        *,
        now: datetime | None = None,
    ) -> DeviceCommand:
        device = self._devices.get(device_id)
        if device is None:
            raise CommandDeviceNotFoundError

        required_capability = COMMAND_REQUIRED_CAPABILITY[payload.command_type]
        enabled = self._capabilities.get_enabled_codes_for_device(device_id)
        if required_capability not in enabled:
            raise CommandCapabilityViolationError(required_capability)

        created_at = now or datetime.now(timezone.utc)
        command = DeviceCommand(
            device_id=device_id,
            command_type=payload.command_type,
            payload=payload.payload,
            status="queued",
            expires_at=created_at + timedelta(seconds=payload.ttl_seconds),
        )

        created = self._commands.add(command)
        self._session.commit()
        return created

    def get(self, command_id: uuid.UUID) -> DeviceCommand:
        command = self._commands.get(command_id)
        if command is None:
            raise CommandNotFoundError
        return command

    def list_for_device(
        self,
        device_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
    ) -> list[DeviceCommand]:
        if self._devices.get(device_id) is None:
            raise CommandDeviceNotFoundError

        return self._commands.list_for_device(
            device_id,
            limit=limit,
            offset=offset,
        )

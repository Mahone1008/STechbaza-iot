import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.device_contract import COMMAND_REQUIRED_CAPABILITY
from app.models.command import DeviceCommand
from app.repositories.capabilities import CapabilityRepository
from app.repositories.commands import CommandRepository
from app.repositories.devices import DeviceRepository
from app.schemas.command import DeviceCommandCreate
from app.services.command_policy import frequency_allowed
from app.services.command_outcomes import stop_delivery


@dataclass(frozen=True)
class CommandActorSnapshot:
    """Незмінний identity/RBAC snapshot автора command."""

    user_id: uuid.UUID
    auth_session_id: uuid.UUID
    organization_id: uuid.UUID
    platform_role: str
    organization_role: str | None
    email: str
    display_name: str


class CommandDeviceNotFoundError(Exception):
    """Пристрій для команди не знайдено."""


class CommandNotFoundError(Exception):
    """Команду не знайдено."""


class CommandCapabilityViolationError(Exception):
    """Device не має активної capability для цієї команди."""

    def __init__(self, capability_code: str) -> None:
        super().__init__(capability_code)
        self.capability_code = capability_code


class CommandRequestConflictError(Exception):
    """request_id повторно використано для іншої команди або actor."""


class CommandFrequencyProfileError(Exception):
    """A validated installation-specific frequency range is required."""


class CommandService:
    """Створює durable-команди, audit snapshot та HTTP idempotency."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._commands = CommandRepository(session)
        self._devices = DeviceRepository(session)
        self._capabilities = CapabilityRepository(session)

    @staticmethod
    def _matches_request(
        command: DeviceCommand,
        device_id: uuid.UUID,
        payload: DeviceCommandCreate,
        actor: CommandActorSnapshot,
    ) -> bool:
        # Actor session/role snapshots не входять в idempotency key:
        # той самий User може легітимно повторити request після token refresh.
        # Але інший User не може "успадкувати" чужий request_id.
        return (
            command.device_id == device_id
            and command.command_type == payload.command_type
            and command.payload == payload.payload
            and command.ttl_seconds == payload.ttl_seconds
            and command.supersedes_request_id == payload.supersedes_request_id
            and command.actor_user_id == actor.user_id
        )

    def create(
        self,
        device_id: uuid.UUID,
        payload: DeviceCommandCreate,
        *,
        actor: CommandActorSnapshot,
        now: datetime | None = None,
    ) -> tuple[DeviceCommand, bool]:
        device = self._devices.get(device_id)
        if device is None:
            raise CommandDeviceNotFoundError

        required_capability = COMMAND_REQUIRED_CAPABILITY[payload.command_type]
        enabled = self._capabilities.get_enabled_codes_for_device(device_id)
        if required_capability not in enabled:
            raise CommandCapabilityViolationError(required_capability)

        existing = self._commands.get_by_request_id(payload.request_id)
        if existing is not None:
            if not self._matches_request(existing, device_id, payload, actor):
                raise CommandRequestConflictError
            return existing, False

        created_at = now or datetime.now(timezone.utc)
        device = self._devices.get_for_update(device_id)
        if device is None:
            raise CommandDeviceNotFoundError
        # Recheck after serialization; two HTTP retries allocate only one sequence.
        existing = self._commands.get_by_request_id(payload.request_id)
        if existing is not None:
            if not self._matches_request(existing, device_id, payload, actor):
                raise CommandRequestConflictError
            return existing, False
        if required_capability not in self._capabilities.get_enabled_codes_for_device(device_id):
            raise CommandCapabilityViolationError(required_capability)
        if payload.command_type == "vfd.frequency.set" and not frequency_allowed(self._session, device_id, payload.payload):
            raise CommandFrequencyProfileError
        device.command_sequence += 1
        if device.command_sequence > 9007199254740991:
            raise RuntimeError("Command sequence exhausted; re-enrollment required")
        if payload.command_type == "vfd.stop":
            for older in self._commands.pending_for_device(device_id):
                stop_delivery(self._session, older, created_at, code="command_superseded_by_stop",
                    message="Доставку попередньої команди припинено новішою командою Stop; перевірте результат")
        command = DeviceCommand(
            request_id=payload.request_id,
            device_id=device_id,
            command_type=payload.command_type,
            control_sequence=device.command_sequence,
            supersedes_request_id=payload.supersedes_request_id,
            payload=payload.payload,
            status="queued",
            ttl_seconds=payload.ttl_seconds,
            expires_at=created_at + timedelta(seconds=payload.ttl_seconds),
            actor_user_id=actor.user_id,
            actor_auth_session_id=actor.auth_session_id,
            actor_organization_id=actor.organization_id,
            actor_platform_role=actor.platform_role,
            actor_organization_role=actor.organization_role,
            actor_email=actor.email,
            actor_display_name=actor.display_name,
            created_at=created_at,
            updated_at=created_at,
        )

        try:
            created = self._commands.add(command)
            # A slow HTTP Start can arrive AFTER its Stop. The Stop's durable
            # reference cancels that exact intent, scoped to device and author.
            if self._commands.superseding_stop(device_id, payload.request_id, actor.user_id) is not None:
                stop_delivery(self._session, created, created_at, code="command_superseded_by_stop",
                    message="Запит надійшов після Stop, який уже скасував його доставку")
            self._session.commit()
            return created, True
        except IntegrityError as exc:
            # Захищаємося від двох одночасних POST з однаковим request_id.
            self._session.rollback()
            existing = self._commands.get_by_request_id(payload.request_id)
            if existing is None:
                raise

            if not self._matches_request(
                existing,
                device_id,
                payload,
                actor,
            ):
                raise CommandRequestConflictError from exc

            return existing, False

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
        before_created_at: datetime | None = None,
        before_id: uuid.UUID | None = None,
    ) -> list[DeviceCommand]:
        if self._devices.get(device_id) is None:
            raise CommandDeviceNotFoundError

        return self._commands.list_for_device(
            device_id,
            limit=limit,
            offset=offset,
            before_created_at=before_created_at,
            before_id=before_id,
        )

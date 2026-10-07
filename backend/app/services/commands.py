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
from app.services.command_profile import frequency_allowed
from app.services.command_outcomes import stop_delivery
from app.services.program_policy import program_rejection
from app.services.equipment import EquipmentConflict, command_target


@dataclass(frozen=True)
class CommandActorSnapshot:
    """Незмінний identity/RBAC snapshot автора command."""

    user_id: uuid.UUID
    auth_session_id: uuid.UUID | None
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
    """Потрібен перевірений робочий діапазон частоти конкретної установки."""


class CommandProgramError(Exception):
    """Підтримка програм, поточне керування або профіль обладнання змінилися."""


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
            and command.equipment_target == (payload.equipment_target.model_dump(mode="json") if payload.equipment_target else None)
            and command.requested_control_mode_revision == payload.expected_control_mode_revision
            and command.actor_user_id == actor.user_id
        )

    def create(
        self,
        device_id: uuid.UUID,
        payload: DeviceCommandCreate,
        *,
        actor: CommandActorSnapshot,
        now: datetime | None = None,
        schedule_id: uuid.UUID | None = None,
        commit: bool = True,
    ) -> tuple[DeviceCommand, bool]:
        if payload.command_type == "vfd.schedule.start" and schedule_id is None:
            raise CommandProgramError("schedule_requires_calendar")
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
        # Повтор під lock: два HTTP retries отримують один запис та один номер.
        existing = self._commands.get_by_request_id(payload.request_id)
        if existing is not None:
            if not self._matches_request(existing, device_id, payload, actor):
                raise CommandRequestConflictError
            return existing, False
        if required_capability not in self._capabilities.get_enabled_codes_for_device(device_id):
            raise CommandCapabilityViolationError(required_capability)
        if (payload.command_type != "vfd.stop" and payload.expected_control_mode_revision is not None
                and payload.expected_control_mode_revision != device.control_mode_revision):
            raise CommandProgramError("control_mode_changed")
        if payload.command_type == "vfd.frequency.set" and not frequency_allowed(self._session, device_id, payload.payload):
            raise CommandFrequencyProfileError
        rejection = program_rejection(self._session, device, payload.command_type, payload.payload, created_at)
        if rejection:
            raise CommandProgramError(rejection)
        target = command_target(self._session, device, created_at, stop=payload.command_type == "vfd.stop")
        expected_target = payload.equipment_target.model_dump(mode="json") if payload.equipment_target else None
        if expected_target != target:
            raise EquipmentConflict("Прив'язка обладнання змінилася; оновіть панель і підтвердьте нову команду")
        device.command_sequence += 1
        if device.command_sequence > 9007199254740991:
            raise RuntimeError("Command sequence exhausted; re-enrollment required")
        superseded = self._commands.superseding_stop(device_id, payload.request_id, actor.user_id) is not None
        if (not superseded and device.control_mode == "schedule"
                and payload.command_type in {"vfd.start", "vfd.stop", "vfd.program.start"}):
            from app.services.control_mode import set_control_mode
            set_control_mode(self._session, device, "manual", actor, created_at, reason="manual_command", stop=payload.command_type == "vfd.stop")
        if payload.command_type == "vfd.stop" and not superseded:
            device.last_stop_requested_at = created_at
            for older in self._commands.pending_for_device(device_id):
                stop_delivery(self._session, older, created_at, code="command_superseded_by_stop",
                    message="Доставку попередньої команди припинено новішою командою Stop; перевірте результат")
        command = DeviceCommand(
            schedule_id=schedule_id,
            request_id=payload.request_id,
            device_id=device_id,
            command_type=payload.command_type,
            control_sequence=device.command_sequence,
            control_mode_revision=device.control_mode_revision,
            requested_control_mode_revision=payload.expected_control_mode_revision,
            equipment_target=target,
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
            # Повільний HTTP Start може надійти ПІСЛЯ свого Stop. Збережене
            # посилання скасовує саме цей запит у межах пристрою та автора.
            if superseded:
                stop_delivery(self._session, created, created_at, code="command_superseded_by_stop",
                    message="Запит надійшов після Stop, який уже скасував його доставку")
            if commit:
                self._session.commit()
            return created, True
        except IntegrityError as exc:
            if not commit:
                raise
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

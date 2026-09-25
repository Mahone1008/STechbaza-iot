import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.telemetry import TelemetryMessage
from app.repositories.capabilities import CapabilityRepository
from app.repositories.devices import DeviceRepository
from app.repositories.telemetry import TelemetryRepository
from app.schemas.telemetry import TelemetryEnvelope
from app.services.alarm_rule_engine import TelemetryAlarmRuleEngine
from app.services.system_alarms import SystemAlarmService
from app.services.telemetry_ordering import (
    SnapshotOrderingDecision,
    decide_snapshot_update,
)
from app.services.telemetry_policy import validate_telemetry_capabilities


class TelemetryDeviceNotFoundError(Exception):
    """Device UID з MQTT topic не зареєстрований у TechBaza."""


class TelemetryCapabilityViolationError(Exception):
    """Payload не відповідає активним capabilities пристрою."""

    def __init__(
        self,
        *,
        missing_capabilities: tuple[str, ...],
        unsupported_keys: tuple[str, ...],
    ) -> None:
        super().__init__("Telemetry payload violates device capabilities")
        self.missing_capabilities = missing_capabilities
        self.unsupported_keys = unsupported_keys


@dataclass(frozen=True, slots=True)
class TelemetryIngestResult:
    """Результат ingestion одного MQTT-пакета."""

    telemetry_id: uuid.UUID
    duplicate: bool
    state_updated: bool
    ordering_reason: str


class TelemetryService:
    """Приймає телеметрію, зберігає історію та захищає current state."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._devices = DeviceRepository(session)
        self._capabilities = CapabilityRepository(session)
        self._telemetry = TelemetryRepository(session)
        self._alarm_rules = TelemetryAlarmRuleEngine(session)
        self._system_alarms = SystemAlarmService(session)

    def ingest(
        self,
        *,
        device_uid: str,
        payload: TelemetryEnvelope,
        received_at: datetime | None = None,
    ) -> TelemetryIngestResult:
        # Lock before reading the snapshot: concurrent packets must decide
        # ordering against the latest committed state of this Device.
        device = self._devices.get_by_uid_for_update(device_uid)
        if device is None:
            raise TelemetryDeviceNotFoundError

        existing = self._telemetry.get_by_message_id(payload.message_id)
        if existing is not None:
            return TelemetryIngestResult(
                telemetry_id=existing.id,
                duplicate=True,
                state_updated=False,
                ordering_reason="duplicate_message_id",
            )

        enabled_capabilities = self._capabilities.get_enabled_codes_for_device(
            device.id
        )
        policy = validate_telemetry_capabilities(
            value_keys=set(payload.values),
            state_keys=set(payload.state),
            enabled_capabilities=enabled_capabilities,
        )
        if not policy.allowed:
            raise TelemetryCapabilityViolationError(
                missing_capabilities=policy.missing_capabilities,
                unsupported_keys=policy.unsupported_keys,
            )

        server_received_at = received_at or datetime.now(timezone.utc)
        current_snapshot = self._telemetry.get_state(device.id)

        incoming_session_seen_before = False
        if payload.session_id is not None:
            incoming_session_seen_before = self._telemetry.has_session_for_device(
                device.id,
                payload.session_id,
            )

        known_system_session = (
            payload.session_id is not None
            and self._system_alarms.has_seen_session(
                device_id=device.id,
                session_id=payload.session_id,
            )
        )
        if (
            known_system_session
            and device.last_observed_session_id != payload.session_id
        ):
            ordering = SnapshotOrderingDecision(
                False, "old_session_reappeared"
            )
        elif (
            payload.session_id is not None
            and payload.session_id == device.last_observed_session_id
            and current_snapshot is not None
            and current_snapshot.last_session_id != payload.session_id
        ):
            # Heartbeat уже зафіксував reboot, а telemetry нової session
            # може починатися з sequence=0 після попередньої з великим seq.
            ordering = SnapshotOrderingDecision(
                True, "new_session_from_heartbeat"
            )
        else:
            ordering = decide_snapshot_update(
                current_session_id=(
                    current_snapshot.last_session_id
                    if current_snapshot is not None
                    else None
                ),
                current_reported_at=(
                    current_snapshot.last_reported_at
                    if current_snapshot is not None
                    else None
                ),
                current_sequence=(
                    current_snapshot.last_sequence
                    if current_snapshot is not None
                    else None
                ),
                incoming_session_id=payload.session_id,
                incoming_reported_at=payload.sent_at,
                incoming_sequence=payload.sequence,
                incoming_session_seen_before=incoming_session_seen_before,
                has_snapshot=current_snapshot is not None,
            )

        message = TelemetryMessage(
            message_id=payload.message_id,
            device_id=device.id,
            session_id=payload.session_id,
            schema_version=payload.schema_version,
            sequence=payload.sequence,
            sent_at=payload.sent_at,
            received_at=server_received_at,
            values=payload.values,
            state=payload.state,
        )

        try:
            saved_message = self._telemetry.add_message(message)

            if ordering.should_update:
                self._telemetry.save_state(
                    device_id=device.id,
                    telemetry_id=saved_message.id,
                    session_id=payload.session_id,
                    sequence=payload.sequence,
                    reported_at=payload.sent_at,
                    received_at=server_received_at,
                    values=payload.values,
                    state=payload.state,
                )
                if payload.session_id is not None:
                    self._system_alarms.observe_session(
                        device=device,
                        session_id=payload.session_id,
                        message_id=payload.message_id,
                        occurred_at=server_received_at,
                    )
                self._alarm_rules.evaluate(
                    device_id=device.id,
                    values=payload.values,
                    state=payload.state,
                    source_message_id=saved_message.id,
                    occurred_at=server_received_at,
                    commit=False,
                )

            # Запізніла попередня session не може удавати online-пристрій.
            if ordering.reason != "old_session_reappeared":
                if (
                    device.last_seen_at is None
                    or device.last_seen_at < server_received_at
                ):
                    device.last_seen_at = server_received_at
                self._system_alarms.mark_online(
                    device=device,
                    occurred_at=server_received_at,
                    source_message_id=payload.message_id,
                )

            self._session.commit()
        except IntegrityError:
            self._session.rollback()
            existing = self._telemetry.get_by_message_id(payload.message_id)
            if existing is not None:
                return TelemetryIngestResult(
                    telemetry_id=existing.id,
                    duplicate=True,
                    state_updated=False,
                    ordering_reason="duplicate_message_id_race",
                )
            raise
        except Exception:
            self._session.rollback()
            raise

        return TelemetryIngestResult(
            telemetry_id=saved_message.id,
            duplicate=False,
            state_updated=ordering.should_update,
            ordering_reason=ordering.reason,
        )

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.telemetry import TelemetryMessage
from app.repositories.devices import DeviceRepository
from app.repositories.telemetry import TelemetryRepository
from app.schemas.telemetry import TelemetryEnvelope


class TelemetryDeviceNotFoundError(Exception):
    """Device UID з MQTT topic не зареєстрований у TechBaza."""


@dataclass(frozen=True, slots=True)
class TelemetryIngestResult:
    """Результат idempotent ingestion одного MQTT-пакета."""

    telemetry_id: uuid.UUID
    duplicate: bool


class TelemetryService:
    """Приймає валідовану телеметрію та атомарно оновлює стан пристрою."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._devices = DeviceRepository(session)
        self._telemetry = TelemetryRepository(session)

    def ingest(
        self,
        *,
        device_uid: str,
        payload: TelemetryEnvelope,
        received_at: datetime | None = None,
    ) -> TelemetryIngestResult:
        device = self._devices.get_by_uid(device_uid)
        if device is None:
            raise TelemetryDeviceNotFoundError

        existing = self._telemetry.get_by_message_id(payload.message_id)
        if existing is not None:
            return TelemetryIngestResult(
                telemetry_id=existing.id,
                duplicate=True,
            )

        server_received_at = received_at or datetime.now(timezone.utc)

        message = TelemetryMessage(
            message_id=payload.message_id,
            device_id=device.id,
            schema_version=payload.schema_version,
            sequence=payload.sequence,
            sent_at=payload.sent_at,
            received_at=server_received_at,
            values=payload.values,
            state=payload.state,
        )

        try:
            saved_message = self._telemetry.add_message(message)

            self._telemetry.save_state(
                device_id=device.id,
                telemetry_id=saved_message.id,
                reported_at=payload.sent_at,
                received_at=server_received_at,
                values=payload.values,
                state=payload.state,
            )

            # last_seen_at оновлюється тільки після валідного нового пакета.
            # Дубль message_id не повинен штучно продовжувати online-стан.
            device.last_seen_at = server_received_at

            self._session.commit()
        except IntegrityError:
            # Unique(message_id) є фінальним захистом від race condition, якщо
            # однаковий MQTT-пакет обробляється майже одночасно двічі.
            self._session.rollback()
            existing = self._telemetry.get_by_message_id(payload.message_id)
            if existing is not None:
                return TelemetryIngestResult(
                    telemetry_id=existing.id,
                    duplicate=True,
                )
            raise

        return TelemetryIngestResult(
            telemetry_id=saved_message.id,
            duplicate=False,
        )

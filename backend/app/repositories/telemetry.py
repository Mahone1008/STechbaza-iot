import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.telemetry import DeviceState, TelemetryMessage


class TelemetryRepository:
    """Інкапсулює запис історії телеметрії та поточного snapshot."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_message_id(
        self,
        message_id: uuid.UUID,
    ) -> TelemetryMessage | None:
        statement = select(TelemetryMessage).where(
            TelemetryMessage.message_id == message_id
        )
        return self._session.scalar(statement)

    def add_message(self, message: TelemetryMessage) -> TelemetryMessage:
        self._session.add(message)
        self._session.flush()
        return message

    def get_state(self, device_id: uuid.UUID) -> DeviceState | None:
        return self._session.get(DeviceState, device_id)

    def save_state(
        self,
        *,
        device_id: uuid.UUID,
        telemetry_id: uuid.UUID,
        reported_at: datetime | None,
        received_at: datetime,
        values: dict,
        state: dict,
    ) -> DeviceState:
        snapshot = self.get_state(device_id)

        if snapshot is None:
            snapshot = DeviceState(
                device_id=device_id,
                last_telemetry_id=telemetry_id,
                last_reported_at=reported_at,
                last_received_at=received_at,
                values=values,
                state=state,
            )
            self._session.add(snapshot)
        else:
            snapshot.last_telemetry_id = telemetry_id
            snapshot.last_reported_at = reported_at
            snapshot.last_received_at = received_at
            snapshot.values = values
            snapshot.state = state

        self._session.flush()
        return snapshot

    def list_for_device(
        self,
        device_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
    ) -> list[TelemetryMessage]:
        statement = (
            select(TelemetryMessage)
            .where(TelemetryMessage.device_id == device_id)
            .order_by(TelemetryMessage.received_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self._session.scalars(statement))

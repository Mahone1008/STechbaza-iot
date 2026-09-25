import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.event_alarm import DeviceEvent


class EventRepository:
    """Read/write доступ до append-only журналу Device events."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, event: DeviceEvent) -> DeviceEvent:
        self._session.add(event)
        self._session.flush()
        self._session.refresh(event)
        return event

    def get(self, event_id: uuid.UUID) -> DeviceEvent | None:
        return self._session.get(DeviceEvent, event_id)

    def list_for_device(
        self,
        device_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
        event_type: str | None = None,
        severity: str | None = None,
        source: str | None = None,
        occurred_from: datetime | None = None,
        occurred_to: datetime | None = None,
    ) -> list[DeviceEvent]:
        statement = select(DeviceEvent).where(
            DeviceEvent.device_id == device_id
        )

        if event_type is not None:
            statement = statement.where(DeviceEvent.event_type == event_type)

        if severity is not None:
            statement = statement.where(DeviceEvent.severity == severity)

        if source is not None:
            statement = statement.where(DeviceEvent.source == source)

        if occurred_from is not None:
            statement = statement.where(
                DeviceEvent.occurred_at >= occurred_from
            )

        if occurred_to is not None:
            statement = statement.where(
                DeviceEvent.occurred_at <= occurred_to
            )

        statement = (
            statement.order_by(
                DeviceEvent.occurred_at.desc(),
                DeviceEvent.received_at.desc(),
                DeviceEvent.id.desc(),
            )
            .limit(limit)
            .offset(offset)
        )

        return list(self._session.scalars(statement))

import uuid

from datetime import datetime, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models.command import DeviceCommand


class CommandRepository:
    """Інкапсулює SQL-операції durable-черги команд пристроїв."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, command: DeviceCommand) -> DeviceCommand:
        self._session.add(command)
        self._session.flush()
        self._session.refresh(command)
        return command

    def get(self, command_id: uuid.UUID) -> DeviceCommand | None:
        return self._session.get(DeviceCommand, command_id)

    def get_for_update(
        self,
        command_id: uuid.UUID,
    ) -> DeviceCommand | None:
        statement = (
            select(DeviceCommand)
            .where(DeviceCommand.id == command_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return self._session.scalar(statement)

    def list_delivery_candidate_ids(
        self,
        *,
        limit: int = 100,
    ) -> list[uuid.UUID]:
        statement = (
            select(DeviceCommand.id)
            .where(or_(
                DeviceCommand.status.in_(("queued", "published")),
                and_(
                    DeviceCommand.status == "acknowledged",
                    or_(
                        DeviceCommand.result_deadline_at <= datetime.now(timezone.utc),
                        DeviceCommand.result_deadline_at.is_(None),
                    ),
                ),
            ))
            .order_by(
                func.coalesce(DeviceCommand.result_deadline_at, DeviceCommand.expires_at),
                DeviceCommand.created_at.asc(),
            )
            .limit(limit)
        )
        return list(self._session.scalars(statement))

    def get_by_request_id(
        self,
        request_id: uuid.UUID,
    ) -> DeviceCommand | None:
        statement = select(DeviceCommand).where(
            DeviceCommand.request_id == request_id
        )
        return self._session.scalar(statement)

    def list_for_device(
        self,
        device_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
    ) -> list[DeviceCommand]:
        statement = (
            select(DeviceCommand)
            .where(DeviceCommand.device_id == device_id)
            .order_by(DeviceCommand.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self._session.scalars(statement))

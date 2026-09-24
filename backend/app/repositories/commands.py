import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.command import DeviceCommand


class CommandRepository:
    """Інкапсулює SQL-операції черги команд пристроїв."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, command: DeviceCommand) -> DeviceCommand:
        self._session.add(command)
        self._session.flush()
        self._session.refresh(command)
        return command

    def get(self, command_id: uuid.UUID) -> DeviceCommand | None:
        return self._session.get(DeviceCommand, command_id)

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

import uuid

from datetime import datetime

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.models.command import DeviceCommand
from app.models.device import Device


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
        now: datetime,
        retry_before: datetime,
        online_since: datetime,
        limit: int = 100,
    ) -> list[uuid.UUID]:
        """Відсіює offline/backoff до LIMIT; dispatch повторює перевірки під lock."""
        device_online = (
            select(Device.id)
            .where(Device.id == DeviceCommand.device_id, Device.last_seen_at >= online_since)
            .exists()
        )
        deadline = func.coalesce(DeviceCommand.result_deadline_at, DeviceCommand.expires_at)
        # Завершення TTL/очікування результату має пріоритет. Для доставки
        # спроба пересуває ready_at уперед, тому due retry не монополізує пачку.
        maintenance = or_(DeviceCommand.expires_at <= now, DeviceCommand.status == "acknowledged")
        ready_at = func.coalesce(
            DeviceCommand.last_publish_attempt_at + (now - retry_before),
            DeviceCommand.created_at,
        )
        statement = (
            select(DeviceCommand.id)
            .where(or_(
                and_(
                    DeviceCommand.status.in_(("queued", "published")),
                    or_(
                        DeviceCommand.expires_at <= now,
                        and_(
                            device_online,
                            or_(
                                DeviceCommand.last_publish_attempt_at.is_(None),
                                DeviceCommand.last_publish_attempt_at <= retry_before,
                            ),
                        ),
                    ),
                ),
                and_(
                    DeviceCommand.status == "acknowledged",
                    or_(
                        DeviceCommand.result_deadline_at <= now,
                        DeviceCommand.result_deadline_at.is_(None),
                    ),
                ),
            ))
            .order_by(
                case((maintenance, 0), else_=1),
                case((maintenance, deadline), else_=ready_at),
                deadline,
                DeviceCommand.created_at.asc(),
                DeviceCommand.id.asc(),
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

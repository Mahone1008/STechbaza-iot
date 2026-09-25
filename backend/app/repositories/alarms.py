import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.event_alarm import AlarmTransition, DeviceAlarm


class AlarmRepository:
    """SQL-доступ до Alarm lifecycle та append-only transition history."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def lock_device(self, device_id: uuid.UUID) -> Device | None:
        """Серіалізує lifecycle-зміни Alarm у межах одного Device."""

        statement = (
            select(Device)
            .where(Device.id == device_id)
            .with_for_update()
        )
        return self._session.scalar(statement)

    def add_alarm(self, alarm: DeviceAlarm) -> DeviceAlarm:
        self._session.add(alarm)
        self._session.flush()
        return alarm

    def add_transition(
        self,
        transition: AlarmTransition,
    ) -> AlarmTransition:
        self._session.add(transition)
        self._session.flush()
        return transition

    def get(self, alarm_id: uuid.UUID) -> DeviceAlarm | None:
        return self._session.get(DeviceAlarm, alarm_id)

    def get_for_update(self, alarm_id: uuid.UUID) -> DeviceAlarm | None:
        statement = (
            select(DeviceAlarm)
            .where(DeviceAlarm.id == alarm_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return self._session.scalar(statement)

    def get_active_for_update(
        self,
        device_id: uuid.UUID,
        alarm_key: str,
    ) -> DeviceAlarm | None:
        statement = (
            select(DeviceAlarm)
            .where(
                DeviceAlarm.device_id == device_id,
                DeviceAlarm.alarm_key == alarm_key,
                DeviceAlarm.state == "active",
            )
            .with_for_update()
        )
        return self._session.scalar(statement)

    def get_latest_for_key(
        self,
        device_id: uuid.UUID,
        alarm_key: str,
    ) -> DeviceAlarm | None:
        statement = (
            select(DeviceAlarm)
            .where(
                DeviceAlarm.device_id == device_id,
                DeviceAlarm.alarm_key == alarm_key,
            )
            .order_by(
                DeviceAlarm.first_raised_at.desc(),
                DeviceAlarm.created_at.desc(),
                DeviceAlarm.id.desc(),
            )
            .limit(1)
        )
        return self._session.scalar(statement)

    def find_transition_for_event_and_key(
        self,
        event_id: uuid.UUID,
        alarm_key: str,
    ) -> AlarmTransition | None:
        statement = (
            select(AlarmTransition)
            .join(
                DeviceAlarm,
                DeviceAlarm.id == AlarmTransition.alarm_id,
            )
            .where(
                AlarmTransition.event_id == event_id,
                DeviceAlarm.alarm_key == alarm_key,
            )
            .order_by(
                AlarmTransition.occurred_at.desc(),
                AlarmTransition.id.desc(),
            )
            .limit(1)
        )
        return self._session.scalar(statement)

    def list_for_device(
        self,
        device_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
        state: str | None = None,
        severity: str | None = None,
        alarm_type: str | None = None,
    ) -> list[DeviceAlarm]:
        statement = select(DeviceAlarm).where(
            DeviceAlarm.device_id == device_id
        )

        if state is not None:
            statement = statement.where(DeviceAlarm.state == state)

        if severity is not None:
            statement = statement.where(DeviceAlarm.severity == severity)

        if alarm_type is not None:
            statement = statement.where(
                DeviceAlarm.alarm_type == alarm_type
            )

        statement = (
            statement.order_by(
                DeviceAlarm.first_raised_at.desc(),
                DeviceAlarm.created_at.desc(),
                DeviceAlarm.id.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
        return list(self._session.scalars(statement))

    def list_transitions(
        self,
        alarm_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
    ) -> list[AlarmTransition]:
        statement = (
            select(AlarmTransition)
            .where(AlarmTransition.alarm_id == alarm_id)
            .order_by(
                AlarmTransition.occurred_at.desc(),
                AlarmTransition.id.desc(),
            )
            .limit(limit)
            .offset(offset)
        )
        return list(self._session.scalars(statement))

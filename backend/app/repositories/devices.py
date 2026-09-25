import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device import Device


class DeviceRepository:
    """Інкапсулює SQL-операції для пристроїв."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def list_for_site(
        self,
        site_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
    ) -> list[Device]:
        statement = (
            select(Device)
            .where(Device.site_id == site_id)
            .order_by(Device.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self._session.scalars(statement))

    def get(self, device_id: uuid.UUID) -> Device | None:
        return self._session.get(Device, device_id)

    def lock_id(self, device_id: uuid.UUID) -> uuid.UUID | None:
        """Спільне блокування для змін конфігурації та приймання телеметрії."""

        return self._session.scalar(
            select(Device.id).where(Device.id == device_id).with_for_update()
        )

    def get_by_uid(self, uid: str) -> Device | None:
        statement = select(Device).where(Device.uid == uid)
        return self._session.scalar(statement)

    def get_by_uid_for_update(self, uid: str) -> Device | None:
        """Серіалізує ingestion, ordering і alarm rules одного Device."""

        statement = select(Device).where(Device.uid == uid).with_for_update()
        return self._session.scalar(statement)

    def add(self, device: Device) -> Device:
        self._session.add(device)
        self._session.flush()
        self._session.refresh(device)
        return device

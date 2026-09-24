import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.capability import Capability, DeviceCapability


class CapabilityRepository:
    """Інкапсулює SQL-операції каталогу та прив'язок capabilities."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def list_catalog(self, *, limit: int, offset: int) -> list[Capability]:
        statement = (
            select(Capability)
            .order_by(Capability.code.asc())
            .limit(limit)
            .offset(offset)
        )
        return list(self._session.scalars(statement))

    def get(self, capability_id: uuid.UUID) -> Capability | None:
        return self._session.get(Capability, capability_id)

    def get_by_code(self, code: str) -> Capability | None:
        statement = select(Capability).where(Capability.code == code)
        return self._session.scalar(statement)

    def add_catalog_item(self, capability: Capability) -> Capability:
        self._session.add(capability)
        self._session.flush()
        self._session.refresh(capability)
        return capability

    def list_for_device(self, device_id: uuid.UUID) -> list[DeviceCapability]:
        statement = (
            select(DeviceCapability)
            .options(selectinload(DeviceCapability.capability))
            .where(DeviceCapability.device_id == device_id)
            .order_by(DeviceCapability.created_at.asc())
        )
        return list(self._session.scalars(statement))

    def get_assignment(
        self,
        device_id: uuid.UUID,
        capability_id: uuid.UUID,
    ) -> DeviceCapability | None:
        statement = (
            select(DeviceCapability)
            .options(selectinload(DeviceCapability.capability))
            .where(
                DeviceCapability.device_id == device_id,
                DeviceCapability.capability_id == capability_id,
            )
        )
        return self._session.scalar(statement)

    def add_assignment(self, assignment: DeviceCapability) -> DeviceCapability:
        self._session.add(assignment)
        self._session.flush()
        self._session.refresh(assignment)
        return assignment

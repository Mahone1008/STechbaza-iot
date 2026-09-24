import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.device import Device


class Capability(TimestampMixin, Base):
    """Каталог функціональних можливостей, які може підтримувати обладнання."""

    __tablename__ = "capabilities"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    code: Mapped[str] = mapped_column(String(96), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    devices: Mapped[list["DeviceCapability"]] = relationship(
        back_populates="capability",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class DeviceCapability(TimestampMixin, Base):
    """Прив'язка можливості до конкретного пристрою з локальною конфігурацією."""

    __tablename__ = "device_capabilities"
    __table_args__ = (
        UniqueConstraint(
            "device_id",
            "capability_id",
            name="uq_device_capabilities_device_capability",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    capability_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("capabilities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    config: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
    )

    device: Mapped["Device"] = relationship(back_populates="capabilities")
    capability: Mapped["Capability"] = relationship(back_populates="devices")

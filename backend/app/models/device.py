import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.capability import DeviceCapability
    from app.models.command import DeviceCommand
    from app.models.event_alarm import DeviceAlarm, DeviceEvent
    from app.models.site import Site
    from app.models.telemetry import DeviceState, TelemetryMessage


class Device(TimestampMixin, Base):
    """Польовий контролер або інший керований пристрій TechBaza."""

    __tablename__ = "devices"
    __table_args__ = (
        CheckConstraint("control_mode IN ('manual', 'schedule')", name="ck_devices_control_mode"),
        CheckConstraint("control_mode_revision >= 0", name="ck_devices_control_mode_revision"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    uid: Mapped[str] = mapped_column(String(96), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    device_type: Mapped[str] = mapped_column(
        String(48),
        nullable=False,
        default="controller",
    )
    lifecycle_status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="provisioning",
        index=True,
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_observed_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
    )
    command_sequence: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    last_stop_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    control_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="manual", server_default="manual")
    control_mode_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    control_mode_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    site: Mapped["Site"] = relationship(back_populates="devices")
    capabilities: Mapped[list["DeviceCapability"]] = relationship(
        back_populates="device",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    telemetry_messages: Mapped[list["TelemetryMessage"]] = relationship(
        back_populates="device",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    state_snapshot: Mapped["DeviceState | None"] = relationship(
        back_populates="device",
        cascade="all, delete-orphan",
        passive_deletes=True,
        uselist=False,
    )
    commands: Mapped[list["DeviceCommand"]] = relationship(
        back_populates="device",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    events: Mapped[list["DeviceEvent"]] = relationship(
        back_populates="device",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    alarms: Mapped[list["DeviceAlarm"]] = relationship(
        back_populates="device",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

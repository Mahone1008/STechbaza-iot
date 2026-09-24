import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, SmallInteger, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.device import Device


class TelemetryMessage(Base):
    """Один валідований пакет телеметрії, отриманий від пристрою."""

    __tablename__ = "telemetry_messages"
    __table_args__ = (
        CheckConstraint(
            "schema_version >= 1",
            name="ck_telemetry_messages_schema_version_positive",
        ),
        CheckConstraint(
            "sequence IS NULL OR sequence >= 0",
            name="ck_telemetry_messages_sequence_non_negative",
        ),
        Index(
            "ix_telemetry_messages_device_received_at",
            "device_id",
            "received_at",
        ),
        Index(
            "ix_telemetry_messages_device_session_id",
            "device_id",
            "session_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
        unique=True,
        index=True,
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
    )
    schema_version: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=1,
        server_default="1",
    )
    sequence: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )
    sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    values: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    state: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )

    device: Mapped["Device"] = relationship(back_populates="telemetry_messages")


class DeviceState(TimestampMixin, Base):
    """Останній відомий телеметричний стан конкретного пристрою."""

    __tablename__ = "device_states"
    __table_args__ = (
        CheckConstraint(
            "last_sequence IS NULL OR last_sequence >= 0",
            name="ck_device_states_last_sequence_non_negative",
        ),
    )

    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        primary_key=True,
    )
    last_telemetry_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("telemetry_messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
    )
    last_sequence: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )
    last_reported_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    values: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    state: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )

    device: Mapped["Device"] = relationship(back_populates="state_snapshot")
    last_telemetry: Mapped[TelemetryMessage | None] = relationship(
        foreign_keys=[last_telemetry_id],
    )

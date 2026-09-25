import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.models.device import Device


class DeviceEvent(Base):
    """Незмінний факт, який стався з Device або його backend-контуром."""

    __tablename__ = "device_events"
    __table_args__ = (
        CheckConstraint(
            "severity IN ('info', 'warning', 'critical')",
            name="ck_device_events_severity",
        ),
        CheckConstraint(
            "source IN ('telemetry', 'presence', 'command', 'device', 'system')",
            name="ck_device_events_source",
        ),
        Index(
            "ix_device_events_device_occurred_at",
            "device_id",
            "occurred_at",
        ),
        Index(
            "ix_device_events_device_type_occurred_at",
            "device_id",
            "event_type",
            "occurred_at",
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
    event_type: Mapped[str] = mapped_column(
        String(96),
        nullable=False,
        index=True,
    )
    severity: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="info",
        server_default="info",
        index=True,
    )
    source: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True,
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    source_message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(
        String(160),
        nullable=False,
    )
    message: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    data: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )

    device: Mapped["Device"] = relationship(back_populates="events")
    alarm_transitions: Mapped[list["AlarmTransition"]] = relationship(
        back_populates="event",
        passive_deletes=True,
    )


class DeviceAlarm(TimestampMixin, Base):
    """Поточний lifecycle конкретної alarm-проблеми для Device."""

    __tablename__ = "device_alarms"
    __table_args__ = (
        CheckConstraint(
            "severity IN ('warning', 'critical')",
            name="ck_device_alarms_severity",
        ),
        CheckConstraint(
            "state IN ('active', 'resolved')",
            name="ck_device_alarms_state",
        ),
        CheckConstraint(
            "occurrence_count >= 1",
            name="ck_device_alarms_occurrence_count_positive",
        ),
        Index(
            "ix_device_alarms_device_state",
            "device_id",
            "state",
        ),
        Index(
            "ix_device_alarms_device_severity_state",
            "device_id",
            "severity",
            "state",
        ),
        Index(
            "uq_device_alarms_active_key",
            "device_id",
            "alarm_key",
            unique=True,
            postgresql_where=text("state = 'active'"),
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
    alarm_key: Mapped[str] = mapped_column(
        String(160),
        nullable=False,
    )
    alarm_type: Mapped[str] = mapped_column(
        String(96),
        nullable=False,
        index=True,
    )
    severity: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        index=True,
    )
    state: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="active",
        server_default="active",
        index=True,
    )
    title: Mapped[str] = mapped_column(
        String(160),
        nullable=False,
    )
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    first_raised_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    last_raised_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    acknowledged_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        index=True,
    )
    acknowledged_by_email: Mapped[str | None] = mapped_column(
        String(320),
        nullable=True,
    )
    acknowledged_by_display_name: Mapped[str | None] = mapped_column(
        String(160),
        nullable=True,
    )
    last_event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_events.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    occurrence_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default="1",
    )
    context: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )

    device: Mapped["Device"] = relationship(back_populates="alarms")
    last_event: Mapped[DeviceEvent | None] = relationship(
        foreign_keys=[last_event_id],
    )
    transitions: Mapped[list["AlarmTransition"]] = relationship(
        back_populates="alarm",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class AlarmTransition(Base):
    """Append-only історія зміни lifecycle Alarm."""

    __tablename__ = "alarm_transitions"
    __table_args__ = (
        CheckConstraint(
            "transition_type IN ('raised', 'repeated', 'acknowledged', 'resolved', 'reopened', 'severity_changed')",
            name="ck_alarm_transitions_type",
        ),
        CheckConstraint(
            "from_state IS NULL OR from_state IN ('active', 'resolved')",
            name="ck_alarm_transitions_from_state",
        ),
        CheckConstraint(
            "to_state IS NULL OR to_state IN ('active', 'resolved')",
            name="ck_alarm_transitions_to_state",
        ),
        Index(
            "ix_alarm_transitions_alarm_occurred_at",
            "alarm_id",
            "occurred_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    alarm_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_alarms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_events.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    transition_type: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        index=True,
    )
    from_state: Mapped[str | None] = mapped_column(
        String(16),
        nullable=True,
    )
    to_state: Mapped[str | None] = mapped_column(
        String(16),
        nullable=True,
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    # Actor snapshot заповнюється для user-дій, наприклад acknowledge.
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        index=True,
    )
    actor_auth_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        index=True,
    )
    actor_organization_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        index=True,
    )
    actor_organization_role: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )
    actor_email: Mapped[str | None] = mapped_column(
        String(320),
        nullable=True,
    )
    actor_display_name: Mapped[str | None] = mapped_column(
        String(160),
        nullable=True,
    )
    reason: Mapped[str | None] = mapped_column(
        String(160),
        nullable=True,
    )
    data: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )

    alarm: Mapped[DeviceAlarm] = relationship(back_populates="transitions")
    event: Mapped[DeviceEvent | None] = relationship(
        back_populates="alarm_transitions",
        foreign_keys=[event_id],
    )

"""Правило, незмінні ревізії та журнал окремих календарних запусків."""
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.mixins import TimestampMixin


class DeviceSchedule(TimestampMixin, Base):
    __tablename__ = "device_schedules"
    __table_args__ = (
        CheckConstraint("revision > 0", name="ck_device_schedules_revision"),
        Index("ix_device_schedules_due", "next_check_at", postgresql_where=text("enabled = true")),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    author_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    revision: Mapped[int] = mapped_column(Integer)
    enabled: Mapped[bool] = mapped_column(Boolean)
    spec: Mapped[dict[str, Any]] = mapped_column(JSONB)
    next_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_check_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ScheduleRevision(Base):
    __tablename__ = "schedule_revisions"
    schedule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("device_schedules.id", ondelete="CASCADE"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    actor_auth_session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    spec: Mapped[dict[str, Any]] = mapped_column(JSONB)
    enabled: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ScheduleOccurrence(Base):
    __tablename__ = "schedule_occurrences"
    __table_args__ = (
        UniqueConstraint("schedule_id", "starts_at", name="uq_schedule_occurrences_start"),
        Index("ix_schedule_occurrences_history", "schedule_id", "starts_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    schedule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("device_schedules.id", ondelete="CASCADE"))
    revision: Mapped[int] = mapped_column(Integer)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    stops_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str | None] = mapped_column(String(96))
    command_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("device_commands.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

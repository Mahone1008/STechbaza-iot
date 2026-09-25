"""Durable in-app повідомлення та незалежні позначки прочитання."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AlarmNotification(Base):
    """Незмінний snapshot значущого переходу Alarm, спільний для tenant."""

    __tablename__ = "alarm_notifications"
    __table_args__ = (
        UniqueConstraint("transition_id", name="uq_alarm_notifications_transition"),
        CheckConstraint(
            "kind IN ('raised', 'severity_changed', 'resolved')",
            name="ck_alarm_notifications_kind",
        ),
        CheckConstraint(
            "severity IN ('warning', 'critical')",
            name="ck_alarm_notifications_severity",
        ),
        Index("ix_alarm_notifications_org_created", "organization_id", "created_at", "id"),
        Index("ix_alarm_notifications_device", "device_id"),
        Index("ix_alarm_notifications_alarm", "alarm_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False,
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False,
    )
    alarm_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("device_alarms.id", ondelete="CASCADE"), nullable=False,
    )
    transition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("alarm_transitions.id", ondelete="CASCADE"), nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()"),
    )


class NotificationRead(Base):
    """Перше прочитання конкретним користувачем; не є acknowledge Alarm."""

    __tablename__ = "notification_reads"
    __table_args__ = (Index("ix_notification_reads_user", "user_id"),)

    notification_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("alarm_notifications.id", ondelete="CASCADE"), primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True,
    )
    read_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()"),
    )

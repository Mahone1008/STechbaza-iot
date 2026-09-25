import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.mixins import TimestampMixin


class DeviceAlarmRuleState(TimestampMixin, Base):
    """Durable debounce-state одного alarm rule для конкретного Device."""

    __tablename__ = "device_alarm_rule_states"
    __table_args__ = (
        UniqueConstraint(
            "device_id",
            "rule_key",
            name="uq_device_alarm_rule_states_device_rule",
        ),
        CheckConstraint(
            "pending_action IS NULL OR pending_action IN ('raise', 'resolve')",
            name="ck_device_alarm_rule_states_pending_action",
        ),
        CheckConstraint(
            "pending_count >= 0",
            name="ck_device_alarm_rule_states_pending_count",
        ),
        Index(
            "ix_device_alarm_rule_states_device_pending",
            "device_id",
            "pending_action",
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
    rule_key: Mapped[str] = mapped_column(
        String(160),
        nullable=False,
    )
    pending_action: Mapped[str | None] = mapped_column(
        String(16),
        nullable=True,
    )
    pending_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    last_value: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        nullable=True,
    )
    last_observed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_source_message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
        index=True,
    )

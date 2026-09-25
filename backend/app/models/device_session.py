import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class DeviceSession(Base):
    """Відомий boot session пристрою: захист від повтору старого heartbeat."""

    __tablename__ = "device_sessions"
    __table_args__ = (
        CheckConstraint(
            "last_heartbeat_sequence IS NULL OR last_heartbeat_sequence >= 0",
            name="ck_device_sessions_sequence_non_negative",
        ),
    )

    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        primary_key=True,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
    )
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    last_message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
    )
    last_heartbeat_sequence: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )

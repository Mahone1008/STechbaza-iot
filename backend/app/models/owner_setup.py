"""Одна чернетка первинного налаштування для конкретного Device."""
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class DeviceSetupDraft(Base):
    __tablename__ = "device_setup_drafts"
    __table_args__ = (CheckConstraint("revision > 0", name="ck_device_setup_draft_revision"),)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    controller_generation: Mapped[int] = mapped_column(Integer, nullable=False)
    credential_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    configuration_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    applied_revision: Mapped[int | None] = mapped_column(Integer)
    applied_configuration_revision: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    updated_by_helper_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    accepted_configuration_hash: Mapped[str | None] = mapped_column(String(64))
    accepted_control_mode: Mapped[str | None] = mapped_column(String(24))
    accepted_draft_revision: Mapped[int | None] = mapped_column(Integer)

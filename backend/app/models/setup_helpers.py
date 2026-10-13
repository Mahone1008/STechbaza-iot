"""Коротка анонімна допомога тільки з чернеткою первинного налаштування."""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class DeviceSetupHelper(Base):
    __tablename__ = "device_setup_helpers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True)
    controller_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("factory_controllers.id", ondelete="CASCADE"), nullable=False)
    issuer_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    issuer_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    membership_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    membership_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    controller_generation: Mapped[int] = mapped_column(Integer, nullable=False)
    credential_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    configuration_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

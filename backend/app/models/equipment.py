"""Інвентар не надає capability; конфігурації зберігаються незмінними."""
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.mixins import TimestampMixin


class PumpInstallation(TimestampMixin, Base):
    __tablename__ = "pump_installations"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))


class EquipmentModule(TimestampMixin, Base):
    __tablename__ = "equipment_modules"
    __table_args__ = (UniqueConstraint("device_id", "slot", name="uq_equipment_modules_slot"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    installation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pump_installations.id", deferrable=True, initially="DEFERRED"), index=True)
    slot: Mapped[str] = mapped_column(String(48))
    kind: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(160))
    manufacturer: Mapped[str] = mapped_column(String(80))
    series: Mapped[str] = mapped_column(String(80))
    model: Mapped[str] = mapped_column(String(120))
    serial_number: Mapped[str | None] = mapped_column(String(120))
    hardware_revision: Mapped[str | None] = mapped_column(String(80))
    software_revision: Mapped[str | None] = mapped_column(String(80))
    motor: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EquipmentConfiguration(Base):
    __tablename__ = "equipment_configurations"
    __table_args__ = (CheckConstraint("revision > 0", name="ck_equipment_configurations_revision"),)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    module_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("equipment_modules.id", deferrable=True, initially="DEFERRED"), index=True)
    configuration_hash: Mapped[str] = mapped_column(String(64))
    # Точні байти manifest є входом SHA-256 і передаються firmware без повторної серіалізації.
    canonical_manifest: Mapped[str] = mapped_column(Text)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    actor_auth_session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

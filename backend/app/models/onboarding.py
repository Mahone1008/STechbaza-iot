"""Factory inventory is independent of customers; ownership never moves history."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.mixins import TimestampMixin


class FactoryController(TimestampMixin, Base):
    __tablename__ = "factory_controllers"
    __table_args__ = (
        CheckConstraint(
            "status IN ('ready','claimed','releasing','quarantined','retired')",
            name="ck_factory_controller_status",
        ),
        CheckConstraint("generation > 0", name="ck_factory_controller_generation"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    serial_number: Mapped[str] = mapped_column(String(96), unique=True, nullable=False)
    hardware_model: Mapped[str] = mapped_column(String(80), nullable=False)
    hardware_revision: Mapped[str] = mapped_column(String(80), nullable=False)
    batch: Mapped[str] = mapped_column(String(80), nullable=False)
    distributor: Mapped[str | None] = mapped_column(String(160))
    test_reference: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="ready", nullable=False)
    generation: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    activation_hash: Mapped[str | None] = mapped_column(String(64))
    buyer_login: Mapped[str | None] = mapped_column(String(96), unique=True)
    buyer_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    bootstrap_hash: Mapped[str | None] = mapped_column(String(64))
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="SET NULL"), unique=True
    )
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_contact_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    firmware_version: Mapped[str | None] = mapped_column(String(32))
    credential_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    access_revoked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class ControllerCredential(Base):
    __tablename__ = "controller_credentials"
    device_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True
    )
    controller_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("factory_controllers.id"), index=True
    )
    secret: Mapped[str] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    applied_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class FactoryAudit(Base):
    __tablename__ = "factory_audit"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    controller_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("factory_controllers.id"), index=True
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    actor_session_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    action: Mapped[str] = mapped_column(String(48), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    details: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class PersonalWorkspace(Base):
    __tablename__ = "personal_workspaces"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), unique=True
    )


class AccountSecurity(TimestampMixin, Base):
    __tablename__ = "account_security"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    recovery_hash: Mapped[str | None] = mapped_column(String(64))
    totp_secret: Mapped[str | None] = mapped_column(String(512))
    totp_enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    totp_last_counter: Mapped[int | None] = mapped_column(Integer)

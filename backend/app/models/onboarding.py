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
        CheckConstraint("network_transport IN ('wifi','lte')", name="ck_factory_controller_network_transport"),
        CheckConstraint("last_contact_transport IS NULL OR last_contact_transport IN ('wifi','lte')",
                        name="ck_factory_controller_contact_transport"),
        CheckConstraint("preparation_revision >= 0 AND control_revision >= 0", name="ck_factory_controller_preparation_revisions"),
        CheckConstraint("firmware_control_capability IN ('read_only','bench','full')", name="ck_factory_controller_control_capability"),
        CheckConstraint("(control_mode IS NULL AND control_configuration_hash IS NULL) OR (control_mode IS NOT NULL AND control_configuration_hash IS NOT NULL AND control_mode IN ('read_only','bench_without_motor','extended_test') AND control_configuration_hash ~ '^[0-9a-f]{64}$' AND control_revision > 0)", name="ck_factory_controller_control_grant"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    serial_number: Mapped[str] = mapped_column(String(96), unique=True, nullable=False)
    hardware_model: Mapped[str] = mapped_column(String(80), nullable=False)
    hardware_revision: Mapped[str] = mapped_column(String(80), nullable=False)
    network_transport: Mapped[str] = mapped_column(String(8), default="wifi", server_default="wifi", nullable=False)
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
    last_contact_transport: Mapped[str | None] = mapped_column(String(8))
    firmware_version: Mapped[str | None] = mapped_column(String(32))
    credential_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    access_revoked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    prepared_equipment: Mapped[dict | None] = mapped_column(JSONB)
    preparation_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    control_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    firmware_control_capability: Mapped[str] = mapped_column(String(12), default="read_only", server_default="read_only", nullable=False)
    control_mode: Mapped[str | None] = mapped_column(String(24))
    control_configuration_hash: Mapped[str | None] = mapped_column(String(64))


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

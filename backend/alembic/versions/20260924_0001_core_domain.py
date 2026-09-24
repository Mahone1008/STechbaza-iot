"""Початкова доменна модель TechBaza.

Revision ID: 20260924_0001
Revises:
Create Date: 2026-09-24
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260924_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_organizations_slug", "organizations", ["slug"], unique=False)

    op.create_table(
        "capabilities",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(length=96), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_capabilities_code", "capabilities", ["code"], unique=False)

    op.create_table(
        "sites",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "code", name="uq_sites_organization_code"),
    )
    op.create_index("ix_sites_organization_id", "sites", ["organization_id"], unique=False)

    op.create_table(
        "devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("uid", sa.String(length=96), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("device_type", sa.String(length=48), nullable=False),
        sa.Column("lifecycle_status", sa.String(length=32), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uid"),
    )
    op.create_index("ix_devices_site_id", "devices", ["site_id"], unique=False)
    op.create_index("ix_devices_uid", "devices", ["uid"], unique=False)
    op.create_index("ix_devices_lifecycle_status", "devices", ["lifecycle_status"], unique=False)

    op.create_table(
        "device_capabilities",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("capability_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["capability_id"], ["capabilities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_id", "capability_id", name="uq_device_capabilities_device_capability"),
    )
    op.create_index("ix_device_capabilities_device_id", "device_capabilities", ["device_id"], unique=False)
    op.create_index("ix_device_capabilities_capability_id", "device_capabilities", ["capability_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_device_capabilities_capability_id", table_name="device_capabilities")
    op.drop_index("ix_device_capabilities_device_id", table_name="device_capabilities")
    op.drop_table("device_capabilities")

    op.drop_index("ix_devices_lifecycle_status", table_name="devices")
    op.drop_index("ix_devices_uid", table_name="devices")
    op.drop_index("ix_devices_site_id", table_name="devices")
    op.drop_table("devices")

    op.drop_index("ix_sites_organization_id", table_name="sites")
    op.drop_table("sites")

    op.drop_index("ix_capabilities_code", table_name="capabilities")
    op.drop_table("capabilities")

    op.drop_index("ix_organizations_slug", table_name="organizations")
    op.drop_table("organizations")

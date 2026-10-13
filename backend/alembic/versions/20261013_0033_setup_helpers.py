"""Обмежені посилання для анонімної допомоги власнику.

Revision ID: 20261013_0033
Revises: 20261013_0032
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261013_0033"
down_revision = "20261013_0032"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("device_setup_helpers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("controller_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("factory_controllers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("issuer_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("issuer_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("membership_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("membership_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("controller_generation", sa.Integer(), nullable=False),
        sa.Column("credential_revision", sa.Integer(), nullable=False),
        sa.Column("configuration_revision", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)))
    op.create_index("ix_device_setup_helpers_device_id", "device_setup_helpers", ["device_id"])


def downgrade():
    op.drop_table("device_setup_helpers")

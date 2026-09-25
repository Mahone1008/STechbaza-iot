"""Додати durable state для Rule Engine.

Revision ID: 20260925_0012
Revises: 20260925_0011
Create Date: 2026-09-25
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260925_0012"
down_revision: str | None = "20260925_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device_alarm_rule_states",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("rule_key", sa.String(length=160), nullable=False),
        sa.Column(
            "pending_action",
            sa.String(length=16),
            nullable=True,
        ),
        sa.Column(
            "pending_count",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column(
            "last_value",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "last_observed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "last_source_message_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "pending_action IS NULL OR pending_action IN ('raise', 'resolve')",
            name="ck_device_alarm_rule_states_pending_action",
        ),
        sa.CheckConstraint(
            "pending_count >= 0",
            name="ck_device_alarm_rule_states_pending_count",
        ),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["devices.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "device_id",
            "rule_key",
            name="uq_device_alarm_rule_states_device_rule",
        ),
    )
    op.create_index(
        "ix_device_alarm_rule_states_device_id",
        "device_alarm_rule_states",
        ["device_id"],
        unique=False,
    )
    op.create_index(
        "ix_device_alarm_rule_states_last_source_message_id",
        "device_alarm_rule_states",
        ["last_source_message_id"],
        unique=False,
    )
    op.create_index(
        "ix_device_alarm_rule_states_device_pending",
        "device_alarm_rule_states",
        ["device_id", "pending_action"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_device_alarm_rule_states_device_pending",
        table_name="device_alarm_rule_states",
    )
    op.drop_index(
        "ix_device_alarm_rule_states_last_source_message_id",
        table_name="device_alarm_rule_states",
    )
    op.drop_index(
        "ix_device_alarm_rule_states_device_id",
        table_name="device_alarm_rule_states",
    )
    op.drop_table("device_alarm_rule_states")

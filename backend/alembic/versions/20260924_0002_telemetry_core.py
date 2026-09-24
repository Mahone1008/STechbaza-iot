"""Додати історію телеметрії та поточний стан пристрою.

Revision ID: 20260924_0002
Revises: 20260924_0001
Create Date: 2026-09-24
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260924_0002"
down_revision: str | None = "20260924_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "telemetry_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "schema_version",
            sa.SmallInteger(),
            server_default="1",
            nullable=False,
        ),
        sa.Column("sequence", sa.BigInteger(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "values",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "state",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "schema_version >= 1",
            name="ck_telemetry_messages_schema_version_positive",
        ),
        sa.CheckConstraint(
            "sequence IS NULL OR sequence >= 0",
            name="ck_telemetry_messages_sequence_non_negative",
        ),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["devices.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id"),
    )
    op.create_index(
        "ix_telemetry_messages_message_id",
        "telemetry_messages",
        ["message_id"],
        unique=False,
    )
    op.create_index(
        "ix_telemetry_messages_device_id",
        "telemetry_messages",
        ["device_id"],
        unique=False,
    )
    op.create_index(
        "ix_telemetry_messages_device_received_at",
        "telemetry_messages",
        ["device_id", "received_at"],
        unique=False,
    )

    op.create_table(
        "device_states",
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "last_telemetry_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("last_reported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "last_received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "values",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "state",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
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
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["devices.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["last_telemetry_id"],
            ["telemetry_messages.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("device_id"),
    )


def downgrade() -> None:
    op.drop_table("device_states")

    op.drop_index(
        "ix_telemetry_messages_device_received_at",
        table_name="telemetry_messages",
    )
    op.drop_index(
        "ix_telemetry_messages_device_id",
        table_name="telemetry_messages",
    )
    op.drop_index(
        "ix_telemetry_messages_message_id",
        table_name="telemetry_messages",
    )
    op.drop_table("telemetry_messages")

"""Додати базову чергу команд керування Device.

Revision ID: 20260924_0005
Revises: 20260924_0004
Create Date: 2026-09-24
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260924_0005"
down_revision: str | None = "20260924_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device_commands",
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
        sa.Column(
            "command_type",
            sa.String(length=96),
            nullable=False,
        ),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=32),
            server_default="queued",
            nullable=False,
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "published_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "acknowledged_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "completed_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "result",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "error_code",
            sa.String(length=96),
            nullable=True,
        ),
        sa.Column(
            "error_message",
            sa.Text(),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["devices.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index(
        "ix_device_commands_device_id",
        "device_commands",
        ["device_id"],
        unique=False,
    )
    op.create_index(
        "ix_device_commands_command_type",
        "device_commands",
        ["command_type"],
        unique=False,
    )
    op.create_index(
        "ix_device_commands_status",
        "device_commands",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_device_commands_device_created_at",
        "device_commands",
        ["device_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_device_commands_device_status",
        "device_commands",
        ["device_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_device_commands_device_status",
        table_name="device_commands",
    )
    op.drop_index(
        "ix_device_commands_device_created_at",
        table_name="device_commands",
    )
    op.drop_index(
        "ix_device_commands_status",
        table_name="device_commands",
    )
    op.drop_index(
        "ix_device_commands_command_type",
        table_name="device_commands",
    )
    op.drop_index(
        "ix_device_commands_device_id",
        table_name="device_commands",
    )
    op.drop_table("device_commands")

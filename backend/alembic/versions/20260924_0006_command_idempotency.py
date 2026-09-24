"""Посилити command queue ідемпотентністю та TTL metadata.

Revision ID: 20260924_0006
Revises: 20260924_0005
Create Date: 2026-09-24
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260924_0006"
down_revision: str | None = "20260924_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "device_commands",
        sa.Column(
            "request_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.execute(
        "UPDATE device_commands "
        "SET request_id = gen_random_uuid() "
        "WHERE request_id IS NULL"
    )
    op.alter_column(
        "device_commands",
        "request_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.create_index(
        "ix_device_commands_request_id",
        "device_commands",
        ["request_id"],
        unique=True,
    )

    op.add_column(
        "device_commands",
        sa.Column(
            "ttl_seconds",
            sa.Integer(),
            server_default="30",
            nullable=False,
        ),
    )
    op.create_index(
        "ix_device_commands_status_expires_at",
        "device_commands",
        ["status", "expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_device_commands_status_expires_at",
        table_name="device_commands",
    )
    op.drop_column("device_commands", "ttl_seconds")

    op.drop_index(
        "ix_device_commands_request_id",
        table_name="device_commands",
    )
    op.drop_column("device_commands", "request_id")

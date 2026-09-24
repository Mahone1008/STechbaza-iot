"""Додати session identity до telemetry ordering.

Revision ID: 20260924_0004
Revises: 20260924_0003
Create Date: 2026-09-24
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260924_0004"
down_revision: str | None = "20260924_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "telemetry_messages",
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index(
        "ix_telemetry_messages_device_session_id",
        "telemetry_messages",
        ["device_id", "session_id"],
        unique=False,
    )

    op.add_column(
        "device_states",
        sa.Column("last_session_id", postgresql.UUID(as_uuid=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("device_states", "last_session_id")

    op.drop_index(
        "ix_telemetry_messages_device_session_id",
        table_name="telemetry_messages",
    )
    op.drop_column("telemetry_messages", "session_id")

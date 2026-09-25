"""Зберегти відомі boot sessions для системних тривог.

Revision ID: 20260925_0013
Revises: 20260925_0012
Create Date: 2026-09-25
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260925_0013"
down_revision: str | None = "20260925_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "devices",
        sa.Column(
            "last_observed_session_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_table(
        "device_sessions",
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "first_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_message_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("last_heartbeat_sequence", sa.BigInteger(), nullable=True),
        sa.CheckConstraint(
            "last_heartbeat_sequence IS NULL OR last_heartbeat_sequence >= 0",
            name="ck_device_sessions_sequence_non_negative",
        ),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["devices.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("device_id", "session_id"),
    )
    # Збережені telemetry sessions не можуть повторно виглядати як reboot.
    op.execute(
        """
        INSERT INTO device_sessions (device_id, session_id, first_seen_at)
        SELECT device_id, session_id, MIN(received_at)
        FROM telemetry_messages
        WHERE session_id IS NOT NULL
        GROUP BY device_id, session_id
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        UPDATE devices AS d
        SET last_observed_session_id = s.last_session_id
        FROM device_states AS s
        WHERE s.device_id = d.id AND s.last_session_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_table("device_sessions")
    op.drop_column("devices", "last_observed_session_id")

"""Додати metadata повторної MQTT доставки command.

Revision ID: 20260924_0007
Revises: 20260924_0006
Create Date: 2026-09-24
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260924_0007"
down_revision: str | None = "20260924_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "device_commands",
        sa.Column(
            "publish_attempts",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
    )
    op.add_column(
        "device_commands",
        sa.Column(
            "last_publish_attempt_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "device_commands",
        sa.Column(
            "last_publish_error",
            sa.String(length=96),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("device_commands", "last_publish_error")
    op.drop_column("device_commands", "last_publish_attempt_at")
    op.drop_column("device_commands", "publish_attempts")

"""Спільний між backend workers ліміт auth-запитів.

Revision ID: 20260926_0016
Revises: 20260925_0015
"""

from alembic import op
import sqlalchemy as sa

revision = "20260926_0016"
down_revision = "20260925_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "auth_rate_limits",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_auth_rate_limits_expires_at", "auth_rate_limits", ["expires_at"])


def downgrade() -> None:
    op.drop_table("auth_rate_limits")

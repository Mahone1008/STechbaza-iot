"""Isolated staff sessions and a structured operations audit."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261006_0027"
down_revision = "20261005_0026"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("auth_sessions", sa.Column("audience", sa.String(80), nullable=False, server_default="techbaza-api"))
    op.add_column("auth_sessions", sa.Column("client_ip", sa.String(64)))
    op.add_column("auth_sessions", sa.Column("user_agent", sa.String(240)))
    op.create_table(
        "platform_audit",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True)),
        sa.Column("actor_session_id", postgresql.UUID(as_uuid=True)),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("resource_type", sa.String(32), nullable=False),
        sa.Column("resource_id", sa.String(96)),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("client_ip", sa.String(64)),
        sa.Column("status", sa.Integer(), nullable=False),
        sa.Column("details", postgresql.JSONB(), nullable=False),
    )
    for column in ("occurred_at", "actor_user_id", "action", "request_id"):
        op.create_index(f"ix_platform_audit_{column}", "platform_audit", [column])


def downgrade():
    op.drop_table("platform_audit")
    for column in ("user_agent", "client_ip", "audience"):
        op.drop_column("auth_sessions", column)

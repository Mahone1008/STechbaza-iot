"""Додати атомарну in-app стрічку аварій і персональне прочитання.

Revision ID: 20260925_0015
Revises: 20260925_0014
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260925_0015"
down_revision = "20260925_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "alarm_notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("device_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("alarm_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("device_alarms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("transition_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("alarm_transitions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("transition_id", name="uq_alarm_notifications_transition"),
        sa.CheckConstraint("kind IN ('raised', 'severity_changed', 'resolved')",
                           name="ck_alarm_notifications_kind"),
        sa.CheckConstraint("severity IN ('warning', 'critical')",
                           name="ck_alarm_notifications_severity"),
    )
    op.create_index("ix_alarm_notifications_org_created", "alarm_notifications", ["organization_id", "created_at", "id"])
    op.create_index("ix_alarm_notifications_device", "alarm_notifications", ["device_id"])
    op.create_index("ix_alarm_notifications_alarm", "alarm_notifications", ["alarm_id"])
    op.create_table(
        "notification_reads",
        sa.Column("notification_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("alarm_notifications.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_notification_reads_user", "notification_reads", ["user_id"])


def downgrade() -> None:
    op.drop_table("notification_reads")
    op.drop_table("alarm_notifications")

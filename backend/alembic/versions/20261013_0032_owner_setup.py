"""Первинна підготовка власником і незворотна ознака її завершення.

Revision ID: 20261013_0032
Revises: 20261012_0031
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261013_0032"
down_revision = "20261012_0031"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("devices", sa.Column("initial_setup_completed_at", sa.DateTime(timezone=True)))
    # Після обслуговування lifecycle знову може стати provisioning. Минуле
    # commissioning поточного покоління не повинно відкривати первинний доступ.
    op.execute("""UPDATE devices AS d SET initial_setup_completed_at = COALESCE(
        (SELECT min(a.occurred_at) FROM factory_audit a JOIN factory_controllers f ON f.id=a.controller_id
         WHERE f.device_id=d.id AND a.action='commissioned' AND a.occurred_at>=f.claimed_at), d.created_at)
        WHERE d.lifecycle_status IN ('active','maintenance','retired') OR EXISTS (
        SELECT 1 FROM factory_audit a JOIN factory_controllers f ON f.id=a.controller_id
        WHERE f.device_id=d.id AND a.action='commissioned' AND a.occurred_at>=f.claimed_at)""")
    op.create_table("device_setup_drafts",
        sa.Column("device_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        sa.Column("controller_generation", sa.Integer(), nullable=False),
        sa.Column("credential_revision", sa.Integer(), nullable=False),
        sa.Column("configuration_revision", sa.Integer(), nullable=False),
        sa.Column("applied_revision", sa.Integer()),
        sa.Column("applied_configuration_revision", sa.Integer()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by_user_id", postgresql.UUID(as_uuid=True)),
        sa.Column("updated_by_helper_id", postgresql.UUID(as_uuid=True)),
        sa.Column("accepted_configuration_hash", sa.String(64)),
        sa.Column("accepted_control_mode", sa.String(24)),
        sa.Column("accepted_draft_revision", sa.Integer()),
        sa.CheckConstraint("revision > 0", name="ck_device_setup_draft_revision"))


def downgrade():
    op.drop_table("device_setup_drafts")
    op.drop_column("devices", "initial_setup_completed_at")

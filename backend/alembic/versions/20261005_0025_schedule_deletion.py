"""Видалення розкладів зі збереженням ревізій та історії запусків."""

from alembic import op
import sqlalchemy as sa

revision = "20261005_0025"
down_revision = "20261005_0024"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("device_schedules", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.add_column("schedule_revisions", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.create_check_constraint("ck_device_schedules_deleted", "device_schedules",
        "deleted_at IS NULL OR (NOT enabled AND next_start_at IS NULL AND next_check_at IS NULL)")
    op.drop_index("ix_device_schedules_due", table_name="device_schedules")
    op.create_index("ix_device_schedules_due", "device_schedules", ["next_check_at"],
        postgresql_where=sa.text("enabled = true AND deleted_at IS NULL"))


def downgrade():
    # Deleted rules remain disabled when returning to the previous schema.
    op.drop_index("ix_device_schedules_due", table_name="device_schedules")
    op.create_index("ix_device_schedules_due", "device_schedules", ["next_check_at"],
        postgresql_where=sa.text("enabled = true"))
    op.drop_constraint("ck_device_schedules_deleted", "device_schedules", type_="check")
    op.drop_column("schedule_revisions", "deleted_at")
    op.drop_column("device_schedules", "deleted_at")

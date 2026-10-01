"""Календарні правила, ревізії та ідемпотентні запуски."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = "20261001_0020"
down_revision = "20261001_0019"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("devices", sa.Column("last_stop_requested_at", sa.DateTime(timezone=True)))
    op.create_table("device_schedules",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("device_id", pg.UUID(as_uuid=True), sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("author_user_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("spec", pg.JSONB(), nullable=False),
        sa.Column("next_start_at", sa.DateTime(timezone=True)),
        sa.Column("next_check_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("revision > 0", name="ck_device_schedules_revision"))
    op.create_index("ix_device_schedules_device_id", "device_schedules", ["device_id"])
    op.create_index("ix_device_schedules_due", "device_schedules", ["next_check_at"], postgresql_where=sa.text("enabled = true"))
    op.create_table("schedule_revisions",
        sa.Column("schedule_id", pg.UUID(as_uuid=True), sa.ForeignKey("device_schedules.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision", sa.Integer(), primary_key=True),
        sa.Column("actor_user_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_auth_session_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("spec", pg.JSONB(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.add_column("device_commands", sa.Column("schedule_id", pg.UUID(as_uuid=True)))
    op.create_foreign_key("fk_device_commands_schedule_id", "device_commands", "device_schedules", ["schedule_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_device_commands_schedule_id", "device_commands", ["schedule_id"])
    op.create_table("schedule_occurrences",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("schedule_id", pg.UUID(as_uuid=True), sa.ForeignKey("device_schedules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stops_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("reason", sa.String(96)),
        sa.Column("command_id", pg.UUID(as_uuid=True), sa.ForeignKey("device_commands.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("schedule_id", "starts_at", name="uq_schedule_occurrences_start"))
    op.create_index("ix_schedule_occurrences_history", "schedule_occurrences", ["schedule_id", "starts_at"])


def downgrade():
    op.drop_table("schedule_occurrences")
    op.drop_index("ix_device_commands_schedule_id", "device_commands")
    op.drop_constraint("fk_device_commands_schedule_id", "device_commands", type_="foreignkey")
    op.drop_column("device_commands", "schedule_id")
    op.drop_table("schedule_revisions")
    op.drop_table("device_schedules")
    op.drop_column("devices", "last_stop_requested_at")

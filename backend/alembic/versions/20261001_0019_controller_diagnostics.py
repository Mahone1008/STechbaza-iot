"""Необов'язкова діагностика в історії телеметрії та її snapshot."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261001_0019"
down_revision = "20260929_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("telemetry_messages", "device_states"):
        op.add_column(table, sa.Column("diagnostics", postgresql.JSONB(none_as_null=True), nullable=True))


def downgrade() -> None:
    for table in ("device_states", "telemetry_messages"):
        op.drop_column(table, "diagnostics")

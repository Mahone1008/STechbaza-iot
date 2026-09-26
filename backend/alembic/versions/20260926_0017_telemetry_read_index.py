"""Індекс стабільної часової вибірки телеметрії.

Revision ID: 20260926_0017
Revises: 20260926_0016
"""

from alembic import op

revision = "20260926_0017"
down_revision = "20260926_0016"
branch_labels = None
depends_on = None

INDEX = "ix_telemetry_messages_device_received_at"


def upgrade() -> None:
    op.drop_index(INDEX, table_name="telemetry_messages")
    op.create_index(INDEX, "telemetry_messages", ["device_id", "received_at", "id"])


def downgrade() -> None:
    op.drop_index(INDEX, table_name="telemetry_messages")
    op.create_index(INDEX, "telemetry_messages", ["device_id", "received_at"])

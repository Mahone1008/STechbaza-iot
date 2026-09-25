"""Додати deadline очікування результату вже прийнятої команди.

Revision ID: 20260925_0014
Revises: 20260925_0013
"""

from alembic import op
import sqlalchemy as sa

revision = "20260925_0014"
down_revision = "20260925_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("device_commands", sa.Column("result_deadline_at", sa.DateTime(timezone=True)))
    op.add_column("device_commands", sa.Column("result_timed_out_at", sa.DateTime(timezone=True)))
    # Історичні ACK отримують типовий deadline; нові беруть його з конфігурації.
    op.execute("""
        UPDATE device_commands
        SET result_deadline_at = COALESCE(acknowledged_at, published_at, created_at)
                                 + INTERVAL '120 seconds'
        WHERE status = 'acknowledged'
    """)
    op.create_index("ix_device_commands_status_result_deadline", "device_commands",
                    ["status", "result_deadline_at"])


def downgrade() -> None:
    # Старий worker не розуміє result_unknown. Повертаємо очікування без retry.
    op.execute("""
        UPDATE device_commands SET status = 'acknowledged',
            error_code = NULL, error_message = NULL
        WHERE status = 'result_unknown'
    """)
    op.drop_index("ix_device_commands_status_result_deadline", table_name="device_commands")
    op.drop_column("device_commands", "result_timed_out_at")
    op.drop_column("device_commands", "result_deadline_at")

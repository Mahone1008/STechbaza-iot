"""Впорядковані команди protocol v2 та збережені свідчення спроб доставки.

Міграція потребує зупинених API/workers. Доставку legacy pending припинено;
міграція не надсилає команди та не припускає невиконання надісланої дії.
"""
from alembic import op
import sqlalchemy as sa

revision = "20260929_0018"
down_revision = "20260926_0017"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("devices", sa.Column("command_sequence", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("device_commands", sa.Column("control_sequence", sa.BigInteger(), nullable=True))
    op.add_column("device_commands", sa.Column("supersedes_request_id", sa.UUID(), nullable=True))
    op.create_index("ix_device_commands_supersedes_request_id", "device_commands", ["supersedes_request_id"])
    op.create_unique_constraint("uq_device_commands_control_sequence", "device_commands", ["device_id", "control_sequence"])
    op.create_check_constraint("ck_device_commands_control_sequence", "device_commands", "control_sequence IS NULL OR control_sequence > 0")
    # Старий код фіксував спробу ПІСЛЯ відправлення: навіть queued/0 міг бути
    # виконаний перед збоєм. Результат кожної legacy pending вважаємо невідомим.
    op.execute("""UPDATE device_commands SET
        status = 'result_unknown',
        completed_at = NULL, result_timed_out_at = now(),
        error_code = 'protocol_upgrade_quarantine',
        error_message = 'Доставку legacy-команди зупинено під час переходу на protocol v2; перевірте стан пристрою',
        updated_at = now()
        WHERE status IN ('queued', 'published', 'acknowledged')""")


def downgrade():
    # Downgrade не повинен відновлювати доставку раніше скасованої команди.
    op.execute("""UPDATE device_commands SET status='expired',
        error_code='protocol_downgrade_quarantine', updated_at=now()
        WHERE status IN ('queued', 'published', 'acknowledged', 'cancelled')""")
    op.drop_constraint("ck_device_commands_control_sequence", "device_commands", type_="check")
    op.drop_constraint("uq_device_commands_control_sequence", "device_commands", type_="unique")
    op.drop_index("ix_device_commands_supersedes_request_id", table_name="device_commands")
    op.drop_column("device_commands", "supersedes_request_id")
    op.drop_column("device_commands", "control_sequence")
    op.drop_column("devices", "command_sequence")

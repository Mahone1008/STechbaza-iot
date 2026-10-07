"""Збережений режим ручного керування та календарних запусків."""
from alembic import op
import sqlalchemy as sa

revision = "20261007_0028"
down_revision = "20261006_0027"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("devices", sa.Column("control_mode", sa.String(16), nullable=False, server_default="manual"))
    op.add_column("devices", sa.Column("control_mode_revision", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("devices", sa.Column("control_mode_changed_at", sa.DateTime(timezone=True)))
    op.create_check_constraint("ck_devices_control_mode", "devices", "control_mode IN ('manual', 'schedule')")
    op.create_check_constraint("ck_devices_control_mode_revision", "devices", "control_mode_revision >= 0")
    op.add_column("device_commands", sa.Column("control_mode_revision", sa.Integer()))
    op.add_column("device_commands", sa.Column("requested_control_mode_revision", sa.Integer()))
    # Чинні розклади зберігають поведінку; нові пристрої починають у ручному режимі.
    op.execute("UPDATE devices SET control_mode='schedule' WHERE EXISTS ("
               "SELECT 1 FROM device_schedules s WHERE s.device_id=devices.id "
               "AND s.enabled AND s.deleted_at IS NULL)")


def downgrade():
    for column in ("requested_control_mode_revision", "control_mode_revision"):
        op.drop_column("device_commands", column)
    op.drop_constraint("ck_devices_control_mode_revision", "devices", type_="check")
    op.drop_constraint("ck_devices_control_mode", "devices", type_="check")
    for column in ("control_mode_changed_at", "control_mode_revision", "control_mode"):
        op.drop_column("devices", column)

"""Prepared factory equipment and monotonic runtime control grants.

Revision ID: 20261012_0031
Revises: 20261012_0030
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261012_0031"
down_revision = "20261012_0030"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("factory_controllers", sa.Column("prepared_equipment", postgresql.JSONB(), nullable=True))
    op.add_column("factory_controllers", sa.Column("preparation_revision", sa.Integer(), server_default="0", nullable=False))
    op.add_column("factory_controllers", sa.Column("control_revision", sa.Integer(), server_default="0", nullable=False))
    op.add_column("factory_controllers", sa.Column("firmware_control_capability", sa.String(12), server_default="read_only", nullable=False))
    op.add_column("factory_controllers", sa.Column("control_mode", sa.String(24), nullable=True))
    op.add_column("factory_controllers", sa.Column("control_configuration_hash", sa.String(64), nullable=True))
    op.create_check_constraint("ck_factory_controller_preparation_revisions", "factory_controllers", "preparation_revision >= 0 AND control_revision >= 0")
    op.create_check_constraint("ck_factory_controller_control_capability", "factory_controllers", "firmware_control_capability IN ('read_only','bench','full')")
    op.create_check_constraint("ck_factory_controller_control_grant", "factory_controllers", "(control_mode IS NULL AND control_configuration_hash IS NULL) OR (control_mode IS NOT NULL AND control_configuration_hash IS NOT NULL AND control_mode IN ('read_only','bench_without_motor','extended_test') AND control_configuration_hash ~ '^[0-9a-f]{64}$' AND control_revision > 0)")


def downgrade():
    op.drop_constraint("ck_factory_controller_control_grant", "factory_controllers", type_="check")
    op.drop_constraint("ck_factory_controller_control_capability", "factory_controllers", type_="check")
    op.drop_constraint("ck_factory_controller_preparation_revisions", "factory_controllers", type_="check")
    for name in ("control_configuration_hash", "control_mode", "firmware_control_capability", "control_revision", "preparation_revision", "prepared_equipment"):
        op.drop_column("factory_controllers", name)

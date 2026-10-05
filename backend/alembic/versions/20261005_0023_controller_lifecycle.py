"""Ключі контролера та історія заміни обладнання."""

from alembic import op
import sqlalchemy as sa

revision = "20261005_0023"
down_revision = "20261002_0022"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("ck_factory_controller_status", "factory_controllers", type_="check")
    op.create_check_constraint(
        "ck_factory_controller_status",
        "factory_controllers",
        "status IN ('ready','claimed','releasing','quarantined','retired')",
    )
    op.add_column(
        "factory_controllers",
        sa.Column("credential_revision", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "factory_controllers",
        sa.Column("access_revoked", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column("equipment_modules", sa.Column("retired_at", sa.DateTime(timezone=True)))
    op.create_table(
        "controller_credentials",
        sa.Column(
            "device_id",
            sa.Uuid(),
            sa.ForeignKey("devices.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "controller_id", sa.Uuid(), sa.ForeignKey("factory_controllers.id"), nullable=False
        ),
        sa.Column("secret", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("applied_revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index(
        "ix_controller_credentials_controller_id", "controller_credentials", ["controller_id"]
    )


def downgrade():
    op.drop_table("controller_credentials")
    op.drop_column("equipment_modules", "retired_at")
    for name in ("access_revoked", "credential_revision"):
        op.drop_column("factory_controllers", name)
    op.execute("UPDATE factory_controllers SET status='quarantined' WHERE status='releasing'")
    op.drop_constraint("ck_factory_controller_status", "factory_controllers", type_="check")
    op.create_check_constraint(
        "ck_factory_controller_status",
        "factory_controllers",
        "status IN ('ready','claimed','quarantined','retired')",
    )

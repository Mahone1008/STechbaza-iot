"""Вхід із комплекту контролера без відкритої реєстрації."""

from alembic import op
import sqlalchemy as sa

revision = "20261005_0024"
down_revision = "20261005_0023"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("login_name", sa.String(96)))
    op.create_unique_constraint("uq_users_login_name", "users", ["login_name"])
    op.add_column("factory_controllers", sa.Column("buyer_login", sa.String(96)))
    op.create_unique_constraint(
        "uq_factory_controllers_buyer_login", "factory_controllers", ["buyer_login"]
    )
    op.add_column("factory_controllers", sa.Column("buyer_user_id", sa.Uuid()))
    op.create_foreign_key(
        "fk_factory_buyer_user",
        "factory_controllers",
        "users",
        ["buyer_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_factory_controllers_buyer_user_id", "factory_controllers", ["buyer_user_id"]
    )
    # Existing unclaimed kits keep their activation secret; it also proves the label login.
    op.execute(
        "UPDATE factory_controllers SET buyer_login = 'kr-' || replace(id::text, '-', '') || '-g' || generation::text WHERE status='ready'"
    )


def downgrade():
    op.drop_index("ix_factory_controllers_buyer_user_id", table_name="factory_controllers")
    op.drop_constraint("fk_factory_buyer_user", "factory_controllers", type_="foreignkey")
    op.drop_column("factory_controllers", "buyer_user_id")
    op.drop_constraint("uq_factory_controllers_buyer_login", "factory_controllers", type_="unique")
    op.drop_column("factory_controllers", "buyer_login")
    op.drop_constraint("uq_users_login_name", "users", type_="unique")
    op.drop_column("users", "login_name")

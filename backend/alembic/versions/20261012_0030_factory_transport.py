"""Remember the manufactured and authenticated controller network transport."""
from alembic import op
import sqlalchemy as sa

revision = "20261012_0030"
down_revision = "20261007_0029"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("factory_controllers", sa.Column("network_transport", sa.String(8), nullable=False, server_default="wifi"))
    op.add_column("factory_controllers", sa.Column("last_contact_transport", sa.String(8)))
    # Existing factory builds were Wi-Fi only; preserve their authenticated contacts.
    op.execute("UPDATE factory_controllers SET last_contact_transport='wifi' WHERE last_contact_at IS NOT NULL")
    op.create_check_constraint("ck_factory_controller_network_transport", "factory_controllers", "network_transport IN ('wifi','lte')")
    op.create_check_constraint("ck_factory_controller_contact_transport", "factory_controllers", "last_contact_transport IS NULL OR last_contact_transport IN ('wifi','lte')")


def downgrade():
    op.drop_constraint("ck_factory_controller_contact_transport", "factory_controllers", type_="check")
    op.drop_constraint("ck_factory_controller_network_transport", "factory_controllers", type_="check")
    op.drop_column("factory_controllers", "last_contact_transport")
    op.drop_column("factory_controllers", "network_transport")

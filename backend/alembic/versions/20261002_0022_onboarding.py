"""Factory registration, single-use claims and account security."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = "20261002_0022"
down_revision = "20261002_0021"
branch_labels = None
depends_on = None


def timestamps():
    return [sa.Column(name, sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")) for name in ("created_at", "updated_at")]


def upgrade():
    op.create_table("factory_controllers",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        *[sa.Column(name, sa.String(size), nullable=False) for name, size in (("serial_number",96),("hardware_model",80),("hardware_revision",80),("batch",80),("test_reference",160),("status",24))],
        sa.Column("distributor", sa.String(160)),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("activation_hash", sa.String(64)), sa.Column("bootstrap_hash", sa.String(64)),
        sa.Column("device_id", pg.UUID(as_uuid=True), sa.ForeignKey("devices.id", ondelete="SET NULL")),
        *[sa.Column(name, sa.DateTime(timezone=True)) for name in ("claimed_at", "last_contact_at")],
        sa.Column("firmware_version", sa.String(32)), *timestamps(),
        sa.UniqueConstraint("serial_number", name="uq_factory_controllers_serial_number"),
        sa.UniqueConstraint("device_id", name="uq_factory_controllers_device_id"),
        sa.CheckConstraint("status IN ('ready','claimed','quarantined','retired')", name="ck_factory_controller_status"),
        sa.CheckConstraint("generation > 0", name="ck_factory_controller_generation"))
    op.create_table("factory_audit",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("controller_id", pg.UUID(as_uuid=True), sa.ForeignKey("factory_controllers.id"), nullable=False),
        sa.Column("actor_user_id", pg.UUID(as_uuid=True)), sa.Column("actor_session_id", pg.UUID(as_uuid=True)),
        sa.Column("action", sa.String(48), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("details", pg.JSONB(), nullable=False))
    op.create_index("ix_factory_audit_controller_id", "factory_audit", ["controller_id"])
    op.create_table("personal_workspaces",
        sa.Column("user_id", pg.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("organization_id", pg.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, unique=True))
    op.create_table("account_security",
        sa.Column("user_id", pg.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("recovery_hash", sa.String(64)), sa.Column("totp_secret", sa.String(512)),
        sa.Column("totp_enabled_at", sa.DateTime(timezone=True)), sa.Column("totp_last_counter", sa.Integer()), *timestamps())
    op.add_column("organization_memberships", sa.Column("site_ids", sa.JSON()))
    op.add_column("organization_memberships", sa.Column("expires_at", sa.DateTime(timezone=True)))
    op.add_column("auth_sessions", sa.Column("mfa_verified_at", sa.DateTime(timezone=True)))


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM factory_controllers) OR EXISTS (SELECT 1 FROM account_security) OR EXISTS (SELECT 1 FROM organization_memberships WHERE site_ids IS NOT NULL OR expires_at IS NOT NULL)")):
        raise RuntimeError("Provisioned controllers and recovery keys require an explicit offline rollback")
    op.drop_column("organization_memberships", "expires_at")
    op.drop_column("organization_memberships", "site_ids")
    op.drop_column("auth_sessions", "mfa_verified_at")
    for table in ("account_security", "personal_workspaces", "factory_audit", "factory_controllers"):
        op.drop_table(table)

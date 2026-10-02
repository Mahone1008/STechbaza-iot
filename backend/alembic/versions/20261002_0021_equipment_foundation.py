"""Установки, екземпляри модулів та версійована прив'язка команд."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = "20261002_0021"
down_revision = "20261001_0020"
branch_labels = None
depends_on = None


def timestamps():
    return [sa.Column(name, sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()"))
            for name in ("created_at", "updated_at")]


def upgrade() -> None:
    op.create_table("pump_installations",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("site_id", pg.UUID(as_uuid=True), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(160), nullable=False), *timestamps())
    op.create_index("ix_pump_installations_site_id", "pump_installations", ["site_id"])
    op.create_table("equipment_modules",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("device_id", pg.UUID(as_uuid=True), sa.ForeignKey("devices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("installation_id", pg.UUID(as_uuid=True), sa.ForeignKey("pump_installations.id", deferrable=True, initially="DEFERRED"), nullable=False),
        *[sa.Column(name, sa.String(size), nullable=False) for name, size in
          (("slot",48),("kind",32),("name",160),("manufacturer",80),("series",80),("model",120))],
        *[sa.Column(name, sa.String(size), nullable=True) for name, size in
          (("serial_number",120),("hardware_revision",80),("software_revision",80))],
        sa.Column("motor", pg.JSONB(none_as_null=True), nullable=True), *timestamps(),
        sa.UniqueConstraint("device_id", "slot", name="uq_equipment_modules_slot"))
    for name in ("device_id", "installation_id"):
        op.create_index(f"ix_equipment_modules_{name}", "equipment_modules", [name])
    op.create_table("equipment_configurations",
        sa.Column("device_id", pg.UUID(as_uuid=True), sa.ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision", sa.Integer(), primary_key=True),
        sa.Column("module_id", pg.UUID(as_uuid=True), sa.ForeignKey("equipment_modules.id", deferrable=True, initially="DEFERRED"), nullable=False),
        sa.Column("configuration_hash", sa.String(64), nullable=False),
        sa.Column("canonical_manifest", sa.Text(), nullable=False),
        sa.Column("actor_user_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_auth_session_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("revision > 0", name="ck_equipment_configurations_revision"))
    op.create_index("ix_equipment_configurations_module_id", "equipment_configurations", ["module_id"])
    op.add_column("device_commands", sa.Column("equipment_target", pg.JSONB(none_as_null=True), nullable=True))


def downgrade() -> None:
    # Не дозволяємо downgrade прибрати захист прив'язки вже введеного в експлуатацію обладнання.
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM equipment_configurations)")):
        raise RuntimeError("Active equipment configurations require an explicit offline rollback procedure")
    op.drop_column("device_commands", "equipment_target")
    op.drop_table("equipment_configurations")
    op.drop_table("equipment_modules")
    op.drop_table("pump_installations")

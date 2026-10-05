"""Personal account registration and organization invitations."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261005_0026"
down_revision = "20261005_0025"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "account_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("purpose", sa.String(24), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
        ),
        sa.Column("role", sa.String(32)),
        sa.Column("site_ids", sa.JSON()),
        sa.Column("access_expires_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_by_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "target_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
        ),
        sa.Column(
            "controller_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("factory_controllers.id", ondelete="CASCADE"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "purpose IN ('registration', 'invitation')", name="ck_account_link_purpose"
        ),
        sa.CheckConstraint(
            "(purpose = 'registration' AND organization_id IS NULL AND role IS NULL) OR "
            "(purpose = 'invitation' AND organization_id IS NOT NULL AND role IS NOT NULL)",
            name="ck_account_link_context",
        ),
    )
    for column in ("email", "organization_id"):
        op.create_index(f"ix_account_links_{column}", "account_links", [column])


def downgrade():
    op.drop_table("account_links")

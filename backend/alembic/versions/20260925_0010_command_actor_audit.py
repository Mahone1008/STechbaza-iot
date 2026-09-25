"""Додати actor attribution до device_commands.

Revision ID: 20260925_0010
Revises: 20260925_0009
Create Date: 2026-09-25
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260925_0010"
down_revision: str | None = "20260925_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Actor metadata є денормалізованим audit snapshot.
    # Навмисно без FK: історичний command audit не повинен ламатися або
    # втрачати identity metadata після деактивації/видалення account/session.
    op.add_column(
        "device_commands",
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column(
        "device_commands",
        sa.Column(
            "actor_auth_session_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column(
        "device_commands",
        sa.Column(
            "actor_organization_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column(
        "device_commands",
        sa.Column(
            "actor_platform_role",
            sa.String(length=32),
            nullable=True,
        ),
    )
    op.add_column(
        "device_commands",
        sa.Column(
            "actor_organization_role",
            sa.String(length=32),
            nullable=True,
        ),
    )
    op.add_column(
        "device_commands",
        sa.Column(
            "actor_email",
            sa.String(length=320),
            nullable=True,
        ),
    )
    op.add_column(
        "device_commands",
        sa.Column(
            "actor_display_name",
            sa.String(length=160),
            nullable=True,
        ),
    )

    op.create_index(
        "ix_device_commands_actor_user_id",
        "device_commands",
        ["actor_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_device_commands_actor_auth_session_id",
        "device_commands",
        ["actor_auth_session_id"],
        unique=False,
    )
    op.create_index(
        "ix_device_commands_actor_organization_id",
        "device_commands",
        ["actor_organization_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_device_commands_actor_organization_id",
        table_name="device_commands",
    )
    op.drop_index(
        "ix_device_commands_actor_auth_session_id",
        table_name="device_commands",
    )
    op.drop_index(
        "ix_device_commands_actor_user_id",
        table_name="device_commands",
    )

    op.drop_column("device_commands", "actor_display_name")
    op.drop_column("device_commands", "actor_email")
    op.drop_column("device_commands", "actor_organization_role")
    op.drop_column("device_commands", "actor_platform_role")
    op.drop_column("device_commands", "actor_organization_id")
    op.drop_column("device_commands", "actor_auth_session_id")
    op.drop_column("device_commands", "actor_user_id")

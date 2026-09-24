"""Додати ordering metadata до device_states.

Revision ID: 20260924_0003
Revises: 20260924_0002
Create Date: 2026-09-24
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260924_0003"
down_revision: str | None = "20260924_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "device_states",
        sa.Column("last_sequence", sa.BigInteger(), nullable=True),
    )

    # Існуючий snapshot уже посилається на останній telemetry message.
    # Підтягуємо sequence, щоб після міграції ordering одразу мав контекст.
    op.execute(
        """
        UPDATE device_states AS ds
        SET last_sequence = tm.sequence
        FROM telemetry_messages AS tm
        WHERE ds.last_telemetry_id = tm.id
        """
    )

    op.create_check_constraint(
        "ck_device_states_last_sequence_non_negative",
        "device_states",
        "last_sequence IS NULL OR last_sequence >= 0",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_device_states_last_sequence_non_negative",
        "device_states",
        type_="check",
    )
    op.drop_column("device_states", "last_sequence")

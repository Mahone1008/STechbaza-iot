"""Додати фундамент Events & Alarms Core.

Revision ID: 20260925_0011
Revises: 20260925_0010
Create Date: 2026-09-25
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20260925_0011"
down_revision: str | None = "20260925_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(length=96), nullable=False),
        sa.Column(
            "severity",
            sa.String(length=16),
            server_default="info",
            nullable=False,
        ),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "source_message_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column(
            "data",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "severity IN ('info', 'warning', 'critical')",
            name="ck_device_events_severity",
        ),
        sa.CheckConstraint(
            "source IN ('telemetry', 'presence', 'command', 'device', 'system')",
            name="ck_device_events_source",
        ),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["devices.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_device_events_device_id",
        "device_events",
        ["device_id"],
        unique=False,
    )
    op.create_index(
        "ix_device_events_event_type",
        "device_events",
        ["event_type"],
        unique=False,
    )
    op.create_index(
        "ix_device_events_severity",
        "device_events",
        ["severity"],
        unique=False,
    )
    op.create_index(
        "ix_device_events_source",
        "device_events",
        ["source"],
        unique=False,
    )
    op.create_index(
        "ix_device_events_source_message_id",
        "device_events",
        ["source_message_id"],
        unique=False,
    )
    op.create_index(
        "ix_device_events_device_occurred_at",
        "device_events",
        ["device_id", "occurred_at"],
        unique=False,
    )
    op.create_index(
        "ix_device_events_device_type_occurred_at",
        "device_events",
        ["device_id", "event_type", "occurred_at"],
        unique=False,
    )

    op.create_table(
        "device_alarms",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "device_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("alarm_key", sa.String(length=160), nullable=False),
        sa.Column("alarm_type", sa.String(length=96), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column(
            "state",
            sa.String(length=16),
            server_default="active",
            nullable=False,
        ),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "first_raised_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "last_raised_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "resolved_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "acknowledged_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "acknowledged_by_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "acknowledged_by_email",
            sa.String(length=320),
            nullable=True,
        ),
        sa.Column(
            "acknowledged_by_display_name",
            sa.String(length=160),
            nullable=True,
        ),
        sa.Column(
            "last_event_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "occurrence_count",
            sa.Integer(),
            server_default="1",
            nullable=False,
        ),
        sa.Column(
            "context",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "severity IN ('warning', 'critical')",
            name="ck_device_alarms_severity",
        ),
        sa.CheckConstraint(
            "state IN ('active', 'resolved')",
            name="ck_device_alarms_state",
        ),
        sa.CheckConstraint(
            "occurrence_count >= 1",
            name="ck_device_alarms_occurrence_count_positive",
        ),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["devices.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["last_event_id"],
            ["device_events.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_device_alarms_device_id",
        "device_alarms",
        ["device_id"],
        unique=False,
    )
    op.create_index(
        "ix_device_alarms_alarm_type",
        "device_alarms",
        ["alarm_type"],
        unique=False,
    )
    op.create_index(
        "ix_device_alarms_severity",
        "device_alarms",
        ["severity"],
        unique=False,
    )
    op.create_index(
        "ix_device_alarms_state",
        "device_alarms",
        ["state"],
        unique=False,
    )
    op.create_index(
        "ix_device_alarms_acknowledged_by_user_id",
        "device_alarms",
        ["acknowledged_by_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_device_alarms_last_event_id",
        "device_alarms",
        ["last_event_id"],
        unique=False,
    )
    op.create_index(
        "ix_device_alarms_device_state",
        "device_alarms",
        ["device_id", "state"],
        unique=False,
    )
    op.create_index(
        "ix_device_alarms_device_severity_state",
        "device_alarms",
        ["device_id", "severity", "state"],
        unique=False,
    )
    op.create_index(
        "uq_device_alarms_active_key",
        "device_alarms",
        ["device_id", "alarm_key"],
        unique=True,
        postgresql_where=sa.text("state = 'active'"),
    )

    op.create_table(
        "alarm_transitions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "alarm_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("transition_type", sa.String(length=32), nullable=False),
        sa.Column("from_state", sa.String(length=16), nullable=True),
        sa.Column("to_state", sa.String(length=16), nullable=True),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "actor_auth_session_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "actor_organization_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "actor_organization_role",
            sa.String(length=32),
            nullable=True,
        ),
        sa.Column(
            "actor_email",
            sa.String(length=320),
            nullable=True,
        ),
        sa.Column(
            "actor_display_name",
            sa.String(length=160),
            nullable=True,
        ),
        sa.Column("reason", sa.String(length=160), nullable=True),
        sa.Column(
            "data",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "transition_type IN ('raised', 'repeated', 'acknowledged', 'resolved', 'reopened', 'severity_changed')",
            name="ck_alarm_transitions_type",
        ),
        sa.CheckConstraint(
            "from_state IS NULL OR from_state IN ('active', 'resolved')",
            name="ck_alarm_transitions_from_state",
        ),
        sa.CheckConstraint(
            "to_state IS NULL OR to_state IN ('active', 'resolved')",
            name="ck_alarm_transitions_to_state",
        ),
        sa.ForeignKeyConstraint(
            ["alarm_id"],
            ["device_alarms.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["device_events.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_alarm_transitions_alarm_id",
        "alarm_transitions",
        ["alarm_id"],
        unique=False,
    )
    op.create_index(
        "ix_alarm_transitions_event_id",
        "alarm_transitions",
        ["event_id"],
        unique=False,
    )
    op.create_index(
        "ix_alarm_transitions_transition_type",
        "alarm_transitions",
        ["transition_type"],
        unique=False,
    )
    op.create_index(
        "ix_alarm_transitions_actor_user_id",
        "alarm_transitions",
        ["actor_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_alarm_transitions_actor_auth_session_id",
        "alarm_transitions",
        ["actor_auth_session_id"],
        unique=False,
    )
    op.create_index(
        "ix_alarm_transitions_actor_organization_id",
        "alarm_transitions",
        ["actor_organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_alarm_transitions_alarm_occurred_at",
        "alarm_transitions",
        ["alarm_id", "occurred_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_alarm_transitions_alarm_occurred_at",
        table_name="alarm_transitions",
    )
    op.drop_index(
        "ix_alarm_transitions_actor_organization_id",
        table_name="alarm_transitions",
    )
    op.drop_index(
        "ix_alarm_transitions_actor_auth_session_id",
        table_name="alarm_transitions",
    )
    op.drop_index(
        "ix_alarm_transitions_actor_user_id",
        table_name="alarm_transitions",
    )
    op.drop_index(
        "ix_alarm_transitions_transition_type",
        table_name="alarm_transitions",
    )
    op.drop_index(
        "ix_alarm_transitions_event_id",
        table_name="alarm_transitions",
    )
    op.drop_index(
        "ix_alarm_transitions_alarm_id",
        table_name="alarm_transitions",
    )
    op.drop_table("alarm_transitions")

    op.drop_index(
        "uq_device_alarms_active_key",
        table_name="device_alarms",
    )
    op.drop_index(
        "ix_device_alarms_device_severity_state",
        table_name="device_alarms",
    )
    op.drop_index(
        "ix_device_alarms_device_state",
        table_name="device_alarms",
    )
    op.drop_index(
        "ix_device_alarms_last_event_id",
        table_name="device_alarms",
    )
    op.drop_index(
        "ix_device_alarms_acknowledged_by_user_id",
        table_name="device_alarms",
    )
    op.drop_index("ix_device_alarms_state", table_name="device_alarms")
    op.drop_index("ix_device_alarms_severity", table_name="device_alarms")
    op.drop_index("ix_device_alarms_alarm_type", table_name="device_alarms")
    op.drop_index("ix_device_alarms_device_id", table_name="device_alarms")
    op.drop_table("device_alarms")

    op.drop_index(
        "ix_device_events_device_type_occurred_at",
        table_name="device_events",
    )
    op.drop_index(
        "ix_device_events_device_occurred_at",
        table_name="device_events",
    )
    op.drop_index(
        "ix_device_events_source_message_id",
        table_name="device_events",
    )
    op.drop_index("ix_device_events_source", table_name="device_events")
    op.drop_index("ix_device_events_severity", table_name="device_events")
    op.drop_index("ix_device_events_event_type", table_name="device_events")
    op.drop_index("ix_device_events_device_id", table_name="device_events")
    op.drop_table("device_events")

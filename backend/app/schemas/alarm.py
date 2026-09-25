import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


AlarmSeverity = Literal["warning", "critical"]
AlarmState = Literal["active", "resolved"]
AlarmTransitionType = Literal[
    "raised",
    "repeated",
    "acknowledged",
    "resolved",
    "reopened",
    "severity_changed",
]


class DeviceAlarmRead(BaseModel):
    """Read model одного Alarm incident."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_id: uuid.UUID
    alarm_key: str
    alarm_type: str
    severity: AlarmSeverity
    state: AlarmState
    title: str
    description: str | None
    first_raised_at: datetime
    last_raised_at: datetime
    resolved_at: datetime | None
    acknowledged_at: datetime | None
    acknowledged_by_user_id: uuid.UUID | None
    acknowledged_by_email: str | None
    acknowledged_by_display_name: str | None
    last_event_id: uuid.UUID | None
    occurrence_count: int
    context: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class AlarmTransitionRead(BaseModel):
    """Append-only read model lifecycle transition."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    alarm_id: uuid.UUID
    event_id: uuid.UUID | None
    transition_type: AlarmTransitionType
    from_state: AlarmState | None
    to_state: AlarmState | None
    occurred_at: datetime
    actor_user_id: uuid.UUID | None
    actor_auth_session_id: uuid.UUID | None
    actor_organization_id: uuid.UUID | None
    actor_organization_role: str | None
    actor_email: str | None
    actor_display_name: str | None
    reason: str | None
    data: dict[str, Any]

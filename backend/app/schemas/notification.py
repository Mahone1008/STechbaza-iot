import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class AlarmNotificationRead(BaseModel):
    """Snapshot повідомлення з персональним read_at поточного користувача."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    device_id: uuid.UUID
    alarm_id: uuid.UUID
    transition_id: uuid.UUID
    kind: Literal["raised", "severity_changed", "resolved"]
    severity: Literal["warning", "critical"]
    title: str
    description: str | None
    occurred_at: datetime
    created_at: datetime
    read_at: datetime | None = None


class NotificationReadReceipt(BaseModel):
    notification_id: uuid.UUID
    read_at: datetime


class NotificationUnreadCount(BaseModel):
    unread_count: int

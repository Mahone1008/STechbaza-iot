import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


EventSeverity = Literal["info", "warning", "critical"]
EventSource = Literal["telemetry", "presence", "command", "device", "system"]


class DeviceEventRead(BaseModel):
    """Публічне read-представлення одного append-only Device event."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_id: uuid.UUID
    event_type: str
    severity: EventSeverity
    source: EventSource
    occurred_at: datetime
    received_at: datetime
    source_message_id: uuid.UUID | None
    title: str
    message: str | None
    data: dict[str, Any]

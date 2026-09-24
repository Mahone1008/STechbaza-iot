import uuid
from datetime import datetime

from pydantic import BaseModel


class DeviceAvailabilityRead(BaseModel):
    """Поточна серверна оцінка доступності пристрою."""

    device_id: uuid.UUID
    uid: str
    online: bool
    last_seen_at: datetime | None
    timeout_seconds: int
    seconds_since_seen: float | None

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class CommandAckEnvelope(BaseModel):
    """MQTT ACK: Device підтверджує отримання command, але ще не її виконання."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    message_id: uuid.UUID
    command_id: uuid.UUID
    session_id: uuid.UUID
    sent_at: datetime | None = None

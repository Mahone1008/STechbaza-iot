import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class HeartbeatEnvelope(BaseModel):
    """Легкий heartbeat-пакет від польового контролера."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1]
    message_id: uuid.UUID
    sent_at: datetime | None = None
    sequence: int | None = Field(default=None, ge=0)

    @field_validator("sent_at")
    @classmethod
    def validate_sent_at_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("sent_at має містити часовий пояс")
        return value

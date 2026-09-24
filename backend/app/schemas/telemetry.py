import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TelemetryEnvelope(BaseModel):
    """Валідований MQTT envelope телеметрії версії 1."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1]
    message_id: uuid.UUID
    sent_at: datetime | None = None
    sequence: int | None = Field(default=None, ge=0)
    values: dict[str, Any] = Field(default_factory=dict, max_length=128)
    state: dict[str, Any] = Field(default_factory=dict, max_length=128)

    @field_validator("sent_at")
    @classmethod
    def validate_sent_at_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("sent_at має містити часовий пояс")
        return value


class TelemetryMessageRead(BaseModel):
    """Один збережений пакет телеметрії."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    message_id: uuid.UUID
    device_id: uuid.UUID
    schema_version: int
    sequence: int | None
    sent_at: datetime | None
    received_at: datetime
    values: dict[str, Any]
    state: dict[str, Any]


class DeviceStateRead(BaseModel):
    """Останній відомий snapshot пристрою."""

    model_config = ConfigDict(from_attributes=True)

    device_id: uuid.UUID
    last_telemetry_id: uuid.UUID | None
    last_sequence: int | None
    last_reported_at: datetime | None
    last_received_at: datetime
    values: dict[str, Any]
    state: dict[str, Any]
    created_at: datetime
    updated_at: datetime

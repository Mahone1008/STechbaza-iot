import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CommandResultEnvelope(BaseModel):
    """MQTT result: Device повідомляє фінальний результат виконання command."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    message_id: uuid.UUID
    command_id: uuid.UUID
    session_id: uuid.UUID
    sent_at: datetime | None = None
    status: Literal["succeeded", "failed"]
    result: dict[str, Any] = Field(default_factory=dict, max_length=32)
    error_code: str | None = Field(default=None, max_length=96)
    error_message: str | None = Field(default=None, max_length=512)

    @model_validator(mode="after")
    def validate_terminal_payload(self) -> "CommandResultEnvelope":
        if self.status == "succeeded":
            if self.error_code is not None or self.error_message is not None:
                raise ValueError(
                    "succeeded result не повинен містити error_code/error_message"
                )
            return self

        if self.error_code is None:
            raise ValueError("failed result вимагає error_code")

        return self

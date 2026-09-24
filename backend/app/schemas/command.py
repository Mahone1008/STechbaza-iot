import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


CommandType = Literal[
    "vfd.start",
    "vfd.stop",
    "vfd.frequency.set",
]


class DeviceCommandCreate(BaseModel):
    """Запит на створення безпечної короткоживучої команди."""

    command_type: CommandType
    payload: dict[str, Any] = Field(default_factory=dict, max_length=32)
    ttl_seconds: int = Field(default=30, ge=5, le=300)

    @model_validator(mode="after")
    def validate_payload(self) -> "DeviceCommandCreate":
        if self.command_type in {"vfd.start", "vfd.stop"}:
            if self.payload:
                raise ValueError(
                    "vfd.start та vfd.stop не приймають payload"
                )
            return self

        if self.command_type == "vfd.frequency.set":
            if set(self.payload) != {"frequency_hz"}:
                raise ValueError(
                    "vfd.frequency.set вимагає лише поле frequency_hz"
                )

            value = self.payload["frequency_hz"]
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError("frequency_hz має бути числом")

            # Це лише протокольний захист від очевидно некоректних значень.
            # Реальні min/max конкретного VFD будуть братися з конфігурації Device.
            if not 0 <= float(value) <= 100:
                raise ValueError("frequency_hz має бути в діапазоні 0..100")

        return self


class DeviceCommandRead(BaseModel):
    """Публічне представлення команди та її життєвого циклу."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_id: uuid.UUID
    command_type: str
    payload: dict[str, Any]
    status: str
    expires_at: datetime
    published_at: datetime | None
    acknowledged_at: datetime | None
    completed_at: datetime | None
    result: dict[str, Any]
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime

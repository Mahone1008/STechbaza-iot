import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.numeric import finite_number
from app.schemas.program import ProgramPlan
from app.schemas.schedule import ScheduleRun
from app.schemas.equipment import EquipmentTarget

CommandType = Literal[
    "vfd.start",
    "vfd.stop",
    "vfd.frequency.set",
    "vfd.program.start",
    "vfd.schedule.start",
]


class DeviceCommandCreate(BaseModel):
    """Запит на створення ідемпотентної короткоживучої команди."""

    request_id: uuid.UUID = Field(
        description=(
            "UUID, який генерує клієнт перед POST. Повтор запиту з тим самим "
            "request_id не повинен створити другу фізичну команду."
        )
    )
    supersedes_request_id: uuid.UUID | None = None
    command_type: CommandType
    payload: dict[str, Any] = Field(default_factory=dict, max_length=32)
    ttl_seconds: int = Field(default=30, ge=5, le=300)

    @model_validator(mode="after")
    def validate_payload(self) -> "DeviceCommandCreate":
        if self.supersedes_request_id is not None and (self.command_type != "vfd.stop" or self.supersedes_request_id == self.request_id):
            raise ValueError("Only Stop may supersede a different request")
        if self.command_type == "vfd.program.start":
            ProgramPlan.model_validate(self.payload)
            return self
        if self.command_type == "vfd.schedule.start":
            ScheduleRun.model_validate(self.payload)
            return self
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

            value = finite_number(self.payload["frequency_hz"])
            if value is None:
                raise ValueError("frequency_hz має бути скінченним числом")

            # Це протокольний guardrail від очевидно некоректних значень.
            # Реальні min/max конкретного VFD мають братися з конфігурації Device.
            if not 0 <= value <= 100:
                raise ValueError("frequency_hz має бути в діапазоні 0..100")

        return self


class CommandEnvelope(BaseModel):
    """MQTT contract однієї команди Backend → Device."""

    schema_version: Literal[1, 2, 3] = 1
    equipment_target: EquipmentTarget | None = None
    control_sequence: int | None = Field(default=None, strict=True, ge=1, le=9007199254740991)
    command_id: uuid.UUID
    request_id: uuid.UUID
    issued_at: datetime
    expires_at: datetime
    ttl_seconds: int = Field(ge=5, le=300)
    command_type: CommandType
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_protocol(self):
        if (self.schema_version >= 2) != (self.control_sequence is not None):
            raise ValueError("Protocol v2 requires control_sequence; v1 cannot carry it")
        if (self.schema_version == 3) != (self.equipment_target is not None):
            raise ValueError("Protocol v3 requires equipment_target; legacy protocols cannot carry it")
        if self.issued_at.utcoffset() is None or self.expires_at.utcoffset() is None:
            raise ValueError("Command timestamps must have a timezone")
        if self.expires_at <= self.issued_at:
            raise ValueError("Command expiry must follow issue time")
        return self


class DeviceCommandRead(BaseModel):
    """Публічне представлення команди, lifecycle та actor audit."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    request_id: uuid.UUID
    device_id: uuid.UUID
    command_type: str
    control_sequence: int | None = None
    equipment_target: EquipmentTarget | None = None
    schedule_id: uuid.UUID | None = None
    supersedes_request_id: uuid.UUID | None = None
    payload: dict[str, Any]
    status: str
    ttl_seconds: int
    expires_at: datetime

    actor_user_id: uuid.UUID | None
    actor_auth_session_id: uuid.UUID | None
    actor_organization_id: uuid.UUID | None
    actor_platform_role: str | None
    actor_organization_role: str | None
    actor_email: str | None
    actor_display_name: str | None

    published_at: datetime | None
    publish_attempts: int
    last_publish_attempt_at: datetime | None
    last_publish_error: str | None
    acknowledged_at: datetime | None
    result_deadline_at: datetime | None
    result_timed_out_at: datetime | None
    completed_at: datetime | None
    result: dict[str, Any]
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime

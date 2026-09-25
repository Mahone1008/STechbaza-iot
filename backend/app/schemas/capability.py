import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.alarm_rule import parse_alarm_rules


class CapabilityCreate(BaseModel):
    """Дані для створення capability у глобальному каталозі."""

    code: str = Field(
        min_length=3,
        max_length=96,
        pattern=r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
        description="Стабільний технічний код capability.",
    )
    name: str = Field(min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=1000)


class CapabilityRead(BaseModel):
    """Публічне представлення capability."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime


class DeviceCapabilityAssign(BaseModel):
    """Параметри прив'язки capability до конкретного пристрою."""

    is_enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)

    @field_validator("config")
    @classmethod
    def validate_alarm_rules(cls, value: dict[str, Any]) -> dict[str, Any]:
        parse_alarm_rules(value)
        return value


class DeviceCapabilityUpdate(BaseModel):
    """Часткове оновлення capability assignment та його локальної конфігурації."""

    is_enabled: bool | None = None
    config: dict[str, Any] | None = None

    @field_validator("config")
    @classmethod
    def validate_alarm_rules(
        cls,
        value: dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        if value is not None:
            parse_alarm_rules(value)
        return value


class DeviceCapabilityRead(BaseModel):
    """Capability конкретного пристрою разом із локальною конфігурацією."""

    id: uuid.UUID
    device_id: uuid.UUID
    capability_id: uuid.UUID
    is_enabled: bool
    config: dict[str, Any]
    capability: CapabilityRead
    created_at: datetime
    updated_at: datetime

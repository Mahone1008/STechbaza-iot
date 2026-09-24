import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


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

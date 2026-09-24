import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DeviceCreate(BaseModel):
    """Дані для реєстрації пристрою на конкретному об'єкті."""

    uid: str = Field(
        min_length=3,
        max_length=96,
        pattern=r"^[A-Za-z0-9._:-]+$",
        description="Глобально унікальний технічний ідентифікатор пристрою.",
    )
    name: str = Field(min_length=2, max_length=160)
    device_type: str = Field(
        default="controller",
        min_length=2,
        max_length=48,
        pattern=r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$",
    )


class DeviceRead(BaseModel):
    """Публічне представлення пристрою в API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    site_id: uuid.UUID
    uid: str
    name: str
    device_type: str
    lifecycle_status: str
    last_seen_at: datetime | None
    created_at: datetime
    updated_at: datetime

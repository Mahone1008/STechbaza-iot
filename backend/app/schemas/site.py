import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SiteCreate(BaseModel):
    """Дані для створення фізичного об'єкта організації."""

    name: str = Field(min_length=2, max_length=160)
    code: str = Field(
        min_length=2,
        max_length=80,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
        description="Стабільний код об'єкта у kebab-case.",
    )
    timezone: str = Field(default="Europe/Kyiv", min_length=3, max_length=64)


class SiteRead(BaseModel):
    """Публічне представлення об'єкта в API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    code: str
    timezone: str
    created_at: datetime
    updated_at: datetime

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class OrganizationCreate(BaseModel):
    """Дані для створення організації."""

    name: str = Field(min_length=2, max_length=160)
    slug: str = Field(
        min_length=2,
        max_length=80,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
        description="Стабільний URL/системний ідентифікатор у kebab-case.",
    )


class OrganizationRead(BaseModel):
    """Публічне представлення організації в API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

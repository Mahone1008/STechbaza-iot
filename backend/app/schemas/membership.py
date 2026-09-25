import uuid
from datetime import datetime

from pydantic import BaseModel, model_validator

from app.security.roles import OrganizationRole


class MembershipCreate(BaseModel):
    """Дані для додавання існуючого User до Organization."""

    user_id: uuid.UUID
    role: OrganizationRole = OrganizationRole.VIEWER


class MembershipUpdate(BaseModel):
    """Зміни tenant-role або active state membership."""

    role: OrganizationRole | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def require_change(self) -> "MembershipUpdate":
        if self.role is None and self.is_active is None:
            raise ValueError("Потрібно передати role або is_active")
        return self


class MembershipRead(BaseModel):
    """Безпечне API-представлення membership для адмін-панелі."""

    id: uuid.UUID
    organization_id: uuid.UUID
    user_id: uuid.UUID
    user_email: str
    user_display_name: str
    role: OrganizationRole
    is_active: bool
    created_at: datetime
    updated_at: datetime

import uuid
from datetime import datetime

from pydantic import AwareDatetime, BaseModel, Field, model_validator

from app.security.roles import OrganizationRole


class MembershipScope(BaseModel):
    site_ids: list[uuid.UUID] | None = Field(default=None, min_length=1, max_length=100)
    expires_at: AwareDatetime | None = None


class MembershipCreate(MembershipScope):
    """Дані для додавання існуючого User до Organization."""

    user_id: uuid.UUID
    role: OrganizationRole = OrganizationRole.VIEWER


class MembershipUpdate(MembershipScope):
    """Зміни tenant-role або active state membership."""

    role: OrganizationRole | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def require_change(self) -> "MembershipUpdate":
        if not self.model_fields_set:
            raise ValueError("Потрібно передати зміну доступу")
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
    site_ids: list[uuid.UUID] | None = None
    expires_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class CurrentUserMembershipRead(BaseModel):
    organization_id: uuid.UUID
    role: str


class CurrentUserRead(BaseModel):
    id: uuid.UUID
    email: EmailStr
    display_name: str
    platform_role: str
    is_active: bool
    auth_session_id: uuid.UUID
    auth_session_expires_at: datetime
    memberships: list[CurrentUserMembershipRead]

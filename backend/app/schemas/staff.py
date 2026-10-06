import uuid
from datetime import datetime

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from app.schemas.onboarding import SecurityProof
from app.security.roles import PlatformRole
from app.schemas.membership import MembershipScope
from app.security.roles import OrganizationRole


class StaffProof(BaseModel):
    model_config = ConfigDict(extra="forbid")
    proof: SecurityProof
    reason: str = Field(min_length=5, max_length=240)


class UserChange(StaffProof):
    expected_updated_at: AwareDatetime
    display_name: str | None = Field(default=None, min_length=2, max_length=160)
    platform_role: PlatformRole | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def change_required(self):
        if not any(getattr(self, name) is not None for name in ("display_name", "platform_role", "is_active")):
            raise ValueError("Потрібно обрати зміну")
        return self


class UserSecurityReset(StaffProof):
    include_recovery: bool = False


class StaffUserRead(BaseModel):
    id: uuid.UUID
    email: str
    login_name: str | None
    display_name: str
    platform_role: str
    is_active: bool
    email_verified: bool
    mfa_enabled: bool
    active_sessions: int
    last_login_at: datetime | None
    updated_at: datetime


class OrganizationChange(StaffProof):
    expected_updated_at: AwareDatetime
    name: str = Field(min_length=2, max_length=160)
    is_active: bool


class SiteChange(StaffProof):
    expected_updated_at: AwareDatetime
    name: str = Field(min_length=2, max_length=160)
    timezone: str = Field(min_length=3, max_length=64)


class AuditRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    occurred_at: datetime
    actor_user_id: uuid.UUID | None
    actor_email: str | None = None
    action: str
    resource_type: str
    resource_id: str | None
    request_id: str
    client_ip: str | None
    status: int
    details: dict


class StaffSessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: uuid.UUID
    audience: str
    client_ip: str | None
    user_agent: str | None
    created_at: datetime
    expires_at: datetime
    last_used_at: datetime | None
    mfa_verified_at: datetime | None


class StaffOverview(BaseModel):
    organizations: int
    sites: int
    devices: int
    offline_devices: int
    active_alarms: int
    users: int | None
    login_failures_24h: int | None


class StaffDeviceRead(BaseModel):
    id: uuid.UUID
    name: str
    uid: str
    site_id: uuid.UUID
    site_name: str
    organization_id: uuid.UUID
    organization_name: str
    lifecycle_status: str
    last_seen_at: datetime | None
    online: bool


class StaffMonitorRead(BaseModel):
    database: dict
    container: dict
    worker: dict


class StaffMembershipChange(StaffProof, MembershipScope):
    expected_updated_at: AwareDatetime
    role: OrganizationRole
    is_active: bool


class StaffMembershipCreate(StaffProof, MembershipScope):
    user_id: uuid.UUID
    role: OrganizationRole

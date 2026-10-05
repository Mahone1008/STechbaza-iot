import uuid
from datetime import datetime

from pydantic import EmailStr, Field

from app.schemas.membership import MembershipScope
from app.schemas.onboarding import Password, StrictModel
from app.security.roles import OrganizationRole


class RegistrationStart(StrictModel):
    email: EmailStr
    controller_id: uuid.UUID | None = None


class EmailLinkProof(StrictModel):
    token: str = Field(pattern=r"^[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$")


class RegistrationComplete(EmailLinkProof):
    display_name: str = Field(min_length=2, max_length=160)
    password: Password = Field(min_length=12, max_length=128)


class RegistrationPreview(StrictModel):
    email: str


class AccountCreated(StrictModel):
    email: str
    recovery_key: str
    controller_id: uuid.UUID | None = None


class InvitationCreate(MembershipScope, StrictModel):
    email: EmailStr
    role: OrganizationRole = OrganizationRole.VIEWER


class InvitationRead(StrictModel):
    id: uuid.UUID
    email: str
    role: OrganizationRole
    site_ids: list[uuid.UUID] | None
    access_expires_at: datetime | None
    expires_at: datetime
    used_at: datetime | None
    revoked_at: datetime | None


class InvitationPreview(StrictModel):
    email: str
    organization_name: str
    role: OrganizationRole


class InvitationAccepted(StrictModel):
    organization_id: uuid.UUID

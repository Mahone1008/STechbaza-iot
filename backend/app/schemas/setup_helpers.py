"""Публічна відповідь допомоги не містить облікових чи operational даних."""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.onboarding import StrictModel
from app.schemas.owner_setup import SetupCheck, SetupDraftWrite, SetupEquipmentDraft, SetupScope


class SetupHelperCreate(SetupScope):
    expected_draft_revision: int = Field(strict=True, ge=0, le=2147483647)


class SetupHelperRead(StrictModel):
    id: uuid.UUID
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    active: bool


class SetupHelperCreated(SetupHelperRead):
    token: str


class SetupHelperProof(StrictModel):
    token: str = Field(pattern=r"^[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$", min_length=76, max_length=76)


class SetupHelperDraftWrite(SetupDraftWrite, SetupHelperProof):
    pass


class SetupHelperProfile(StrictModel):
    id: str
    version: int
    manufacturer: str
    series: str
    support: Literal["inventory_only", "documented", "bench_limited"]
    tested_model: str | None


class SetupHelperContext(StrictModel):
    helper_id: uuid.UUID
    expires_at: datetime
    serial_number: str
    generation: int
    credential_revision: int
    configuration_revision: int
    draft_revision: int
    equipment: SetupEquipmentDraft
    missing_fields: list[str]
    checks: list[SetupCheck]
    progress: Literal["activated", "connected", "ready"]
    profiles: list[SetupHelperProfile]

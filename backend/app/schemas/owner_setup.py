"""Обмежена первинна підготовка власником: чернетка не змінює контролер."""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.command_profile import FrequencyLimits
from app.schemas.onboarding import StrictModel


class SetupMotorDraft(StrictModel):
    rated_frequency_hz: float | None = Field(default=None, strict=True, gt=0, le=400, allow_inf_nan=False)
    rated_current_a: float | None = Field(default=None, strict=True, gt=0, le=10000, allow_inf_nan=False)
    rated_voltage_v: float | None = Field(default=None, strict=True, gt=0, le=10000, allow_inf_nan=False)
    rated_power_kw: float | None = Field(default=None, strict=True, gt=0, le=10000, allow_inf_nan=False)


class SetupEquipmentDraft(StrictModel):
    profile_id: str | None = Field(default=None, min_length=1, max_length=96)
    profile_version: int = Field(default=1, strict=True, ge=1, le=2147483647)
    model: str | None = Field(default=None, min_length=1, max_length=120)
    serial_number: str | None = Field(default=None, max_length=120)
    hardware_revision: str | None = Field(default=None, max_length=80)
    software_revision: str | None = Field(default=None, max_length=80)
    motor: SetupMotorDraft | None = None
    frequency_limits: FrequencyLimits | None = None


class SetupScope(StrictModel):
    expected_generation: int = Field(strict=True, ge=1)
    expected_credential_revision: int = Field(strict=True, ge=0)
    expected_configuration_revision: int = Field(strict=True, ge=0)


class SetupDraftWrite(SetupScope):
    expected_draft_revision: int = Field(strict=True, ge=0, le=2147483646)
    equipment: SetupEquipmentDraft


class SetupApply(SetupScope):
    expected_draft_revision: int = Field(strict=True, ge=0, le=2147483647)
    nameplate_checked: Literal[True]


class SetupAccept(SetupScope):
    expected_draft_revision: int = Field(strict=True, ge=0, le=2147483647)
    expected_configuration_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    installation_checked: Literal[True]
    control_mode: Literal["extended_test", "read_only"] = "extended_test"


class SetupCheck(StrictModel):
    code: str
    title: str
    status: Literal["passed", "pending", "blocked"]
    detail: str | None = None


class SetupRead(StrictModel):
    controller_id: uuid.UUID
    device_id: uuid.UUID
    generation: int
    credential_revision: int
    configuration_revision: int
    configuration_hash: str | None
    initial_setup_open: bool
    can_setup: bool
    completed_at: datetime | None
    commissioned_control_mode: Literal["extended_test", "bench_without_motor", "read_only"] | None = None
    draft_revision: int
    draft_stale: bool = False
    applied_draft_revision: int | None
    equipment: SetupEquipmentDraft
    configured_equipment: SetupEquipmentDraft | None
    missing_fields: list[str]
    checks: list[SetupCheck]
    progress: Literal["activated", "connected", "ready"]
    needs_apply: bool
    can_apply: bool
    can_accept_control: bool
    can_accept_read_only: bool

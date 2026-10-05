"""Паспорт окремих модулів та незмінна конфігурація контролера."""
import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.command_profile import FrequencyLimits

Hash = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Revision = Annotated[int, Field(strict=True, ge=1, le=2147483647)]
EquipmentConfigurationState = Literal["legacy", "awaiting", "mismatch", "stale", "incompatible", "verified"]


class EquipmentModel(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class InstallationCreate(EquipmentModel):
    name: str = Field(min_length=1, max_length=160, pattern=r"\S")


class InstallationRead(InstallationCreate):
    id: uuid.UUID
    site_id: uuid.UUID


class MotorNameplate(EquipmentModel):
    rated_frequency_hz: float = Field(strict=True, gt=0, le=400, allow_inf_nan=False)
    rated_current_a: float | None = Field(default=None, strict=True, gt=0, le=10000, allow_inf_nan=False)
    rated_voltage_v: float | None = Field(default=None, strict=True, gt=0, le=10000, allow_inf_nan=False)
    rated_power_kw: float | None = Field(default=None, strict=True, gt=0, le=10000, allow_inf_nan=False)


class ModuleCreate(EquipmentModel):
    installation_id: uuid.UUID
    slot: str = Field(min_length=1, max_length=48, pattern=r"^[a-z0-9][a-z0-9_.-]*$")
    kind: Literal["vfd", "pressure_sensor", "digital_input", "relay", "other"]
    name: str = Field(min_length=1, max_length=160, pattern=r"\S")
    manufacturer: str = Field(min_length=1, max_length=80)
    series: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=120)
    serial_number: str | None = Field(default=None, max_length=120)
    hardware_revision: str | None = Field(default=None, max_length=80)
    software_revision: str | None = Field(default=None, max_length=80)
    motor: MotorNameplate | None = None

    @field_validator("serial_number", "hardware_revision", "software_revision", mode="before")
    @classmethod
    def optional_text(cls, value):
        return value.strip() or None if isinstance(value, str) else value


class ModuleRead(ModuleCreate):
    id: uuid.UUID
    device_id: uuid.UUID
    retired_at: datetime | None = None


class ReplacementCreate(EquipmentModel):
    expected_module_id: uuid.UUID
    expected_revision: int = Field(strict=True, ge=0, le=2147483646)
    replacement: ModuleCreate
    stopped_and_isolated: Literal[True]
    reason: str = Field(min_length=5, max_length=240)


class BusSettings(EquipmentModel):
    transport: Literal["modbus_rtu"] = "modbus_rtu"
    address: int = Field(strict=True, ge=1, le=247)
    baud: Literal[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200]
    parity: Literal["none", "even", "odd"]
    stop_bits: Literal[1, 2]

    @field_validator("baud", "stop_bits", mode="before")
    @classmethod
    def strict_integer(cls, value):
        if type(value) is not int:
            raise ValueError("Налаштування шини має бути цілим числом")
        return value


class EquipmentTarget(EquipmentModel):
    binding_id: uuid.UUID
    revision: Revision
    configuration_hash: Hash


class EquipmentReport(EquipmentTarget):
    module_id: uuid.UUID
    binding_generation: Revision
    profile_id: str = Field(min_length=1, max_length=96)
    profile_version: Revision
    profile_hash: Hash
    driver_id: str = Field(min_length=1, max_length=96)
    driver_version: Revision
    command_protocol: Literal[3]
    compatible: bool = Field(strict=True)


class EquipmentManifest(EquipmentModel):
    version: Literal[1] = 1
    device_uid: str = Field(min_length=1, max_length=96, pattern=r"^[A-Za-z0-9._:-]+$")
    module_id: uuid.UUID
    binding_id: uuid.UUID
    binding_generation: Revision
    revision: Revision
    profile_id: str = Field(min_length=1, max_length=96)
    profile_version: Revision
    profile_hash: Hash
    driver_id: str = Field(min_length=1, max_length=96)
    driver_version: Revision
    bus: BusSettings
    frequency_limits: FrequencyLimits

    @field_validator("version", mode="before")
    @classmethod
    def strict_version(cls, value):
        if type(value) is not int:
            raise ValueError("Версія manifest має бути цілим числом")
        return value


class ConfigurationCreate(EquipmentModel):
    expected_revision: int = Field(strict=True, ge=0, le=2147483646)
    module_id: uuid.UUID
    profile_id: str = Field(min_length=1, max_length=96)
    profile_version: Revision
    bus: BusSettings
    frequency_limits: FrequencyLimits
    motor: MotorNameplate | None = None

    @model_validator(mode="after")
    def limit_precision(self):
        from decimal import Decimal
        for value in (self.frequency_limits.min_hz, self.frequency_limits.max_hz):
            if Decimal(str(value)) * 100 % 1:
                raise ValueError("Межі частоти мають не більше двох знаків після коми")
        return self


class ConfigurationRead(EquipmentModel):
    manifest: EquipmentManifest
    configuration_hash: Hash
    created_at: datetime
    actor_user_id: uuid.UUID


class CommissionRequest(EquipmentModel):
    expected_revision: Revision
    installation_checked: Literal[True]
    control_mode: Literal["read_only", "bench_without_motor", "extended_test"] = "read_only"


class ProfileRead(EquipmentModel):
    id: str
    version: Revision
    profile_hash: Hash
    manufacturer: str
    series: str
    parameter_family: str
    support: Literal["documented", "bench_limited"]
    driver_id: str | None
    driver_version: int | None
    command_protocol: int | None
    tested_model: str | None
    manual: str
    manual_sha256: Hash
    manual_pages: list[int]
    notes: list[str]


class EquipmentPassport(EquipmentModel):
    device_id: uuid.UUID
    controller_uid: str
    firmware_version: str | None
    installations: list[InstallationRead]
    modules: list[ModuleRead]
    desired: ConfigurationRead | None
    reported: EquipmentReport | None
    configuration_state: EquipmentConfigurationState
    controller_id: uuid.UUID | None = None

"""Контракти читання для перших екранів; не замінюють write API."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.availability import DeviceAvailabilityRead
from app.schemas.capability import CapabilityRead
from app.schemas.device import DeviceRead
from app.schemas.diagnostics import ControllerDiagnostics
from app.schemas.command_profile import FrequencyLimits
from app.schemas.equipment import EquipmentConfigurationState
from app.schemas.telemetry import DeviceStateRead
from app.schemas.telemetry_read import MetricReadingRead, StateReadingRead, TelemetryFreshnessRead
from app.security.roles import OrganizationRole, Permission, PlatformRole


class OrganizationAccessRead(BaseModel):
    organization_id: uuid.UUID
    platform_role: PlatformRole
    organization_role: OrganizationRole | None
    permissions: list[Permission]


class TelemetryChannelRead(BaseModel):
    key: str
    source: Literal["values", "state"]
    data_type: Literal["number", "boolean", "integer"]
    unit: str | None
    supports_series: bool


class DeviceModuleRead(BaseModel):
    """Enabled capability assignment; не окремий фізичний датчик чи RS-485 адреса."""

    assignment_id: uuid.UUID
    capability_id: uuid.UUID
    code: str
    supported: bool = Field(description="Backend реалізує хоча б один канал або команду цієї capability.")
    channels: list[TelemetryChannelRead]
    command_types: list[str]
    allowed_commands: list[str]


class DeviceOverviewRead(BaseModel):
    equipment_state: EquipmentConfigurationState = "legacy"
    diagnostics: ControllerDiagnostics | None = Field(
        default=None, description="Діагностика того самого telemetry snapshot і boot session; має спільну telemetry_freshness.",
    )
    frequency_limits: FrequencyLimits | None = None
    generated_at: datetime
    device: DeviceRead
    access: OrganizationAccessRead
    availability: DeviceAvailabilityRead
    capabilities: list[CapabilityRead] = Field(
        description="Лише enabled capabilities, призначені цьому Device.",
    )
    modules: list[DeviceModuleRead] = Field(
        description="Ті самі enabled assignments із каналами та командами; довільний config не розкривається.",
    )
    value_keys: list[str]
    state_keys: list[str]
    command_types: list[str] = Field(
        description="Підтримувані команди enabled capabilities, незалежно від ролі.",
    )
    allowed_commands: list[str] = Field(
        description="command_types з урахуванням поточного command.execute; не гарантія виконання.",
    )
    snapshot: DeviceStateRead | None = Field(
        description="null до першої телеметрії; values/state відфільтровані за enabled capabilities.",
    )
    telemetry_freshness: TelemetryFreshnessRead
    readings: list[MetricReadingRead] = Field(
        description="Числові віджети enabled capabilities: значення, одиниці та якість; missing не дорівнює zero.",
    )
    state_readings: list[StateReadingRead] = Field(
        description="Типізовані state-показники: false/0 зберігаються, invalid/missing повертають null.",
    )


class AccessErrorRead(BaseModel):
    detail: str

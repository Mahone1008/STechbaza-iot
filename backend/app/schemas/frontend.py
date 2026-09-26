"""Контракти читання для перших екранів; не замінюють write API."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.availability import DeviceAvailabilityRead
from app.schemas.capability import CapabilityRead
from app.schemas.device import DeviceRead
from app.schemas.telemetry import DeviceStateRead
from app.schemas.telemetry_read import MetricReadingRead, TelemetryFreshnessRead
from app.security.roles import OrganizationRole, Permission, PlatformRole


class OrganizationAccessRead(BaseModel):
    organization_id: uuid.UUID
    platform_role: PlatformRole
    organization_role: OrganizationRole | None
    permissions: list[Permission]


class DeviceOverviewRead(BaseModel):
    generated_at: datetime
    device: DeviceRead
    access: OrganizationAccessRead
    availability: DeviceAvailabilityRead
    capabilities: list[CapabilityRead] = Field(
        description="Лише enabled capabilities, призначені цьому Device.",
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


class AccessErrorRead(BaseModel):
    detail: str

"""Версійована діагностика контролера, незалежна від Wi-Fi/LTE та модулів."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

UptimeMs = Annotated[int, Field(strict=True, ge=0, le=2**53 - 1)]
StopReason = Literal[
    "command", "local_disarm", "bench_timer", "network_lost", "vfd_link_lost",
    "vfd_fault", "configuration_mismatch", "storage_failed",
    "physical_result_unconfirmed", "restart_recovery",
]
ResetReason = Literal[
    "unknown", "power_on", "external", "software", "panic", "interrupt_watchdog",
    "task_watchdog", "watchdog", "deep_sleep", "brownout", "sdio",
]


class DiagnosticModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SignalDiagnostics(DiagnosticModel):
    metric: Literal["rssi", "rsrp"]
    dbm: int = Field(strict=True, ge=-160, le=0)


class ConnectionDiagnostics(DiagnosticModel):
    transport: Literal["wifi", "cellular", "ethernet", "unknown"]
    signal: SignalDiagnostics | None = None

    @model_validator(mode="after")
    def validate_signal(self):
        if self.signal is not None:
            if self.transport not in {"wifi", "cellular"}:
                raise ValueError("This transport has no radio signal")
            if self.transport == "wifi" and (
                self.signal.metric != "rssi" or self.signal.dbm < -127
            ):
                raise ValueError("Wi-Fi requires RSSI in -127..0 dBm")
        return self


class StopDiagnostics(DiagnosticModel):
    """Останній запит STOP цього запуску; підтвердження — читання частотника."""

    reason: StopReason
    uptime_ms: UptimeMs
    requested_at: datetime | None = None
    confirmed: bool = Field(strict=True)

    @field_validator("requested_at")
    @classmethod
    def validate_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("Stop time must include a timezone")
        return value


class ControllerDiagnostics(DiagnosticModel):
    version: Literal[1]
    firmware_version: str = Field(min_length=1, max_length=32, pattern=r"^[0-9A-Za-z.+_-]+$")
    uptime_ms: UptimeMs
    reset_reason: ResetReason
    connection: ConnectionDiagnostics
    last_stop: StopDiagnostics | None = None

    @field_validator("version", mode="before")
    @classmethod
    def validate_version_type(cls, value):
        if type(value) is not int:
            raise ValueError("Diagnostic version must be an integer")
        return value

    @model_validator(mode="after")
    def validate_stop_uptime(self):
        if self.last_stop is not None and self.last_stop.uptime_ms > self.uptime_ms:
            raise ValueError("Stop request cannot occur after the diagnostic sample")
        return self

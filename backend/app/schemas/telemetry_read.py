import math
import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictBool, StrictInt, model_validator

from app.services.telemetry_read_config import SERIES_MAX_BUCKETS, SERIES_MAX_DAYS


class TelemetryFreshnessRead(BaseModel):
    status: Literal["missing", "fresh", "stale"]
    reason: Literal["no_telemetry", "recent", "timeout", "session_changed", "future_timestamp", "delayed_report"]
    received_at: datetime | None
    reported_at: datetime | None
    received_age_seconds: float | None
    stale_after_seconds: int


class MetricReadingRead(BaseModel):
    key: str
    unit: str
    value: float | None
    status: Literal["missing", "invalid", "fresh", "stale"]


class StateReadingRead(BaseModel):
    key: str
    value: StrictBool | StrictInt | None
    status: Literal["missing", "invalid", "fresh", "stale"]


class TelemetrySeriesQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metric: str = Field(min_length=1, max_length=96)
    start: AwareDatetime = Field(description="Початок включно; ISO 8601 з часовим поясом")
    end: AwareDatetime = Field(description="Кінець не включно; не більше 7 днів після start")
    bucket_seconds: int = Field(default=300, ge=1, le=86400)

    @model_validator(mode="after")
    def check_window(self):
        try:
            self.start = self.start.astimezone(timezone.utc)
            self.end = self.end.astimezone(timezone.utc)
        except (OverflowError, ValueError) as exc:
            raise ValueError("Час поза підтримуваним UTC діапазоном") from exc
        seconds = (self.end - self.start).total_seconds()
        if not 0 < seconds <= SERIES_MAX_DAYS * 86400:
            raise ValueError("Потрібно start < end і період не більше 7 днів")
        if math.ceil(seconds / self.bucket_seconds) > SERIES_MAX_BUCKETS:
            raise ValueError("Не більше 1000 інтервалів; збільште bucket_seconds")
        return self


class TelemetryBucketRead(BaseModel):
    start: datetime
    end: datetime
    status: Literal["ok", "partial", "missing", "invalid", "empty"]
    sample_count: int
    missing_count: int
    invalid_count: int
    minimum: float | None
    maximum: float | None
    average: float | None


class TelemetrySeriesRead(BaseModel):
    device_id: uuid.UUID
    metric: str
    unit: str
    start: datetime
    end: datetime
    bucket_seconds: int
    time_basis: Literal["server_received_at"] = "server_received_at"
    generated_at: datetime
    message_count: int
    sample_count: int
    max_messages: int
    buckets: list[TelemetryBucketRead]

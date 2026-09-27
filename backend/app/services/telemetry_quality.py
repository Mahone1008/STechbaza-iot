import math
from datetime import datetime

from app.device_contract import STATE_CHANNELS
from app.numeric import finite_number
from app.schemas.telemetry_read import MetricReadingRead, StateReadingRead, TelemetryFreshnessRead
from app.services.telemetry_read_config import (
    METRIC_UNITS, REPORTED_CLOCK_TOLERANCE_SECONDS, TELEMETRY_STALE_AFTER_SECONDS,
)


def numeric_value(value) -> float | None:
    return finite_number(value)


def freshness(snapshot, *, device_session_id, now: datetime) -> TelemetryFreshnessRead:
    if snapshot is None:
        return TelemetryFreshnessRead(status="missing", reason="no_telemetry", received_at=None,
            reported_at=None, received_age_seconds=None, stale_after_seconds=TELEMETRY_STALE_AFTER_SECONDS)
    age = (now - snapshot.last_received_at).total_seconds()
    reported_age = ((now - snapshot.last_reported_at).total_seconds()
                    if snapshot.last_reported_at is not None else None)
    reason = "recent"
    if device_session_id is not None and snapshot.last_session_id != device_session_id:
        reason = "session_changed"
    elif age < 0 or (reported_age is not None and reported_age < -REPORTED_CLOCK_TOLERANCE_SECONDS):
        reason = "future_timestamp"
    elif age > TELEMETRY_STALE_AFTER_SECONDS:
        reason = "timeout"
    elif reported_age is not None and reported_age > TELEMETRY_STALE_AFTER_SECONDS:
        reason = "delayed_report"
    return TelemetryFreshnessRead(
        status="fresh" if reason == "recent" else "stale", reason=reason,
        received_at=snapshot.last_received_at, reported_at=snapshot.last_reported_at,
        received_age_seconds=max(0, age), stale_after_seconds=TELEMETRY_STALE_AFTER_SECONDS,
    )


def readings(keys: list[str], snapshot, quality: TelemetryFreshnessRead) -> list[MetricReadingRead]:
    result = []
    for key in keys:
        raw = snapshot.values.get(key) if snapshot is not None else None
        value = numeric_value(raw)
        status = "missing" if raw is None else "invalid" if value is None else quality.status
        result.append(MetricReadingRead(key=key, unit=METRIC_UNITS[key], value=value, status=status))
    return result


def state_readings(keys: list[str], snapshot, quality: TelemetryFreshnessRead) -> list[StateReadingRead]:
    result = []
    for key in keys:
        raw = snapshot.state.get(key) if snapshot is not None else None
        kind = STATE_CHANNELS[key].data_type
        value = None
        if kind == "boolean" and isinstance(raw, bool):
            value = raw
        elif kind == "integer" and type(raw) is int and abs(raw) <= 2**53 - 1:
            # JSON number має зберегти точне ціле значення у JavaScript UI.
            value = raw
        status = "missing" if raw is None else "invalid" if value is None else quality.status
        result.append(StateReadingRead(key=key, value=value, status=status))
    return result


def json_safe(value):
    """Історичний JSONB може містити число, що не вміщується у Python float."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    return value

import os


TELEMETRY_STALE_AFTER_SECONDS = int(os.getenv("TELEMETRY_STALE_AFTER_SECONDS", "120"))
if not 1 <= TELEMETRY_STALE_AFTER_SECONDS <= 86400:
    raise RuntimeError("TELEMETRY_STALE_AFTER_SECONDS має бути від 1 до 86400")

SERIES_MAX_DAYS = 7
SERIES_MAX_BUCKETS = 1000
SERIES_MAX_MESSAGES = 100_000
SERIES_STATEMENT_TIMEOUT_MS = 3000
REPORTED_CLOCK_TOLERANCE_SECONDS = 30

# Capability mapping залишається у telemetry_policy; тут лише одиниці UI.
METRIC_UNITS = {
    "vfd.frequency_hz": "Hz",
    "vfd.current_a": "A",
    "pressure.bar": "bar",
    "water_level.percent": "%",
}

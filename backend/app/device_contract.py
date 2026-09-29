"""Спільний контракт підтримуваних каналів і команд протоколу v1.

Capability у каталозі не додає новий handler автоматично. Цей registry
описує реалізовану підтримку; конкретний Device додатково потребує enabled
assignment. Фізичні адреси та повторювані датчики не виводяться з config.
"""

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class TelemetryChannel:
    key: str
    source: Literal["values", "state"]
    capability_code: str
    data_type: Literal["number", "boolean", "integer"]
    unit: str | None = None

    @property
    def supports_series(self) -> bool:
        return self.source == "values" and self.data_type == "number"


TELEMETRY_CHANNELS = (
    TelemetryChannel("vfd.frequency_hz", "values", "vfd.frequency.read", "number", "Hz"),
    TelemetryChannel("vfd.current_a", "values", "vfd.current.read", "number", "A"),
    TelemetryChannel("vfd.set_frequency_hz", "values", "vfd.set_frequency.read", "number", "Hz"),
    TelemetryChannel("vfd.voltage_v", "values", "vfd.voltage.read", "number", "V"),
    TelemetryChannel("vfd_link", "state", "vfd.diagnostics.read", "boolean"),
    TelemetryChannel("vfd_configuration_valid", "state", "vfd.diagnostics.read", "boolean"),
    TelemetryChannel("control_armed", "state", "vfd.diagnostics.read", "boolean"),
    TelemetryChannel("pressure.bar", "values", "pressure.read", "number", "bar"),
    TelemetryChannel("water_level.percent", "values", "water_level.read", "number", "%"),
    TelemetryChannel("pump_running", "state", "vfd.state.read", "boolean"),
    TelemetryChannel("vfd_fault_code", "state", "vfd.state.read", "integer"),
    TelemetryChannel("local_mode", "state", "vfd.state.read", "boolean"),
    TelemetryChannel("emergency_stop", "state", "vfd.state.read", "boolean"),
)

COMMAND_REQUIRED_CAPABILITY: dict[str, str] = {
    "vfd.start": "vfd.control",
    "vfd.stop": "vfd.control",
    "vfd.frequency.set": "vfd.control",
}

# Сумісні проєкції одного registry для ingestion, overview та series.
VALUE_CAPABILITY_REQUIREMENTS = {
    channel.key: channel.capability_code for channel in TELEMETRY_CHANNELS
    if channel.source == "values"
}
STATE_CAPABILITY_REQUIREMENTS = {
    channel.key: channel.capability_code for channel in TELEMETRY_CHANNELS
    if channel.source == "state"
}
METRIC_UNITS = {
    channel.key: channel.unit for channel in TELEMETRY_CHANNELS if channel.supports_series
}
STATE_CHANNELS = {channel.key: channel for channel in TELEMETRY_CHANNELS if channel.source == "state"}


def selected_channels(code: str, config: dict) -> tuple[TelemetryChannel, ...]:
    """An optional installation subset cannot invent channels or grant capabilities."""
    channels = tuple(item for item in TELEMETRY_CHANNELS if item.capability_code == code)
    if "telemetry_keys" not in config:
        return channels
    selection = config["telemetry_keys"]
    if not isinstance(selection, list) or any(not isinstance(key, str) for key in selection):
        return ()
    if len(selection) != len(set(selection)) or not set(selection).issubset({item.key for item in channels}):
        return ()
    return tuple(item for item in channels if item.key in selection)


def validate_channel_selection(config: dict) -> None:
    if "telemetry_keys" not in config:
        return
    selection = config["telemetry_keys"]
    if (not isinstance(selection, list) or len(selection) > len(TELEMETRY_CHANNELS)
            or any(not isinstance(key, str) for key in selection)
            or len(selection) != len(set(selection))
            or not set(selection).issubset({item.key for item in TELEMETRY_CHANNELS})):
        raise ValueError("telemetry_keys must be a unique list of supported channel keys")

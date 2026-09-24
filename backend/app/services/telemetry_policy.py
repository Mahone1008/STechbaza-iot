from dataclasses import dataclass

# Кожен телеметричний ключ має бути явно пов'язаний із capability.
# Це не дозволяє пристрою записувати довільні поля, яких у його
# фактичній конфігурації TechBaza немає.
VALUE_CAPABILITY_REQUIREMENTS: dict[str, str] = {
    "vfd.frequency_hz": "vfd.frequency.read",
    "vfd.current_a": "vfd.current.read",
    "pressure.bar": "pressure.read",
    "water_level.percent": "water_level.read",
}

STATE_CAPABILITY_REQUIREMENTS: dict[str, str] = {
    "pump_running": "vfd.state.read",
    "vfd_fault_code": "vfd.state.read",
    "local_mode": "vfd.state.read",
    "emergency_stop": "vfd.state.read",
}


@dataclass(frozen=True, slots=True)
class TelemetryPolicyResult:
    """Результат перевірки payload проти capabilities конкретного Device."""

    missing_capabilities: tuple[str, ...]
    unsupported_keys: tuple[str, ...]

    @property
    def allowed(self) -> bool:
        return not self.missing_capabilities and not self.unsupported_keys


def validate_telemetry_capabilities(
    *,
    value_keys: set[str],
    state_keys: set[str],
    enabled_capabilities: set[str],
) -> TelemetryPolicyResult:
    """Перевіряє, чи має Device право надсилати всі ключі payload."""

    required_capabilities: set[str] = set()
    unsupported_keys: set[str] = set()

    for key in value_keys:
        required = VALUE_CAPABILITY_REQUIREMENTS.get(key)
        if required is None:
            unsupported_keys.add(f"values.{key}")
        else:
            required_capabilities.add(required)

    for key in state_keys:
        required = STATE_CAPABILITY_REQUIREMENTS.get(key)
        if required is None:
            unsupported_keys.add(f"state.{key}")
        else:
            required_capabilities.add(required)

    missing_capabilities = required_capabilities - enabled_capabilities

    return TelemetryPolicyResult(
        missing_capabilities=tuple(sorted(missing_capabilities)),
        unsupported_keys=tuple(sorted(unsupported_keys)),
    )

from dataclasses import dataclass

from app.device_contract import STATE_CAPABILITY_REQUIREMENTS, VALUE_CAPABILITY_REQUIREMENTS


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

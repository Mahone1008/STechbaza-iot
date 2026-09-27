"""Простори імен системних Alarm; не залежать від services або DB."""

SYSTEM_ALARM_NAMESPACES = ("device", "command")


class ReservedAlarmRuleKeyError(ValueError):
    """Користувацьке telemetry-rule використовує системний простір імен."""


def is_system_alarm_key(key: str) -> bool:
    return any(key == name or key.startswith(name + ".") for name in SYSTEM_ALARM_NAMESPACES)


def validate_rule_key(key: str) -> None:
    if is_system_alarm_key(key):
        raise ReservedAlarmRuleKeyError(
            "rule_key: простори device та command зарезервовані для системних аварій"
        )

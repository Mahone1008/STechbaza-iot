from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class NumericAlarmRuleConfig(BaseModel):
    """Конфігурація одного числового telemetry-rule."""

    model_config = ConfigDict(extra="forbid")

    rule_key: str = Field(
        min_length=3,
        max_length=160,
        pattern=r"^[a-z0-9]+(?:[._:-][a-z0-9]+)*$",
    )
    alarm_type: str = Field(
        min_length=3,
        max_length=80,
        pattern=r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    )
    metric: str = Field(
        min_length=3,
        max_length=160,
        pattern=r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$",
    )
    source: Literal["values", "state"] = "values"
    kind: Literal["low", "high"]
    threshold: float
    clear_threshold: float
    debounce_samples: int = Field(default=2, ge=1, le=100)
    severity: Literal["warning", "critical"]
    title: str = Field(min_length=2, max_length=140)
    description: str | None = Field(default=None, max_length=1000)
    enabled: bool = True

    @model_validator(mode="after")
    def validate_hysteresis(self) -> "NumericAlarmRuleConfig":
        if self.kind == "low" and self.clear_threshold <= self.threshold:
            raise ValueError(
                "Для low-rule clear_threshold має бути більшим за threshold"
            )
        if self.kind == "high" and self.clear_threshold >= self.threshold:
            raise ValueError(
                "Для high-rule clear_threshold має бути меншим за threshold"
            )
        return self


def parse_alarm_rules(config: dict[str, Any]) -> list[NumericAlarmRuleConfig]:
    """Розібрати alarm_rules із generic DeviceCapability.config."""

    raw_rules = config.get("alarm_rules", [])
    if raw_rules is None:
        return []
    if not isinstance(raw_rules, list):
        raise ValueError("config.alarm_rules має бути масивом")

    rules = [
        NumericAlarmRuleConfig.model_validate(item)
        for item in raw_rules
    ]

    keys = [rule.rule_key for rule in rules]
    if len(keys) != len(set(keys)):
        raise ValueError(
            "config.alarm_rules не може містити дублікати rule_key"
        )

    return rules

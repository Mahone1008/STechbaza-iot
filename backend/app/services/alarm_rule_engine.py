import logging
import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.models.event_alarm import DeviceEvent
from app.repositories.alarm_rules import AlarmRuleStateRepository
from app.repositories.alarms import AlarmRepository
from app.repositories.capabilities import CapabilityRepository
from app.repositories.events import EventRepository
from app.schemas.alarm_rule import NumericAlarmRuleConfig, parse_alarm_rules
from app.services.alarms import AlarmLifecycleService

logger = logging.getLogger(__name__)


class AlarmRuleConfigurationError(Exception):
    """DeviceCapability містить конфліктну або невалідну rule-конфігурацію."""


@dataclass(frozen=True, slots=True)
class RuleActionResult:
    """Діагностичний результат обробки одного rule."""

    rule_key: str
    action: str
    value: float | None
    pending_count: int
    debounce_samples: int
    alarm_id: uuid.UUID | None = None
    event_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class RuleEngineResult:
    """Зведений результат одного evaluation telemetry-пакета."""

    configured_rules: int
    evaluated_rules: int
    actions: tuple[RuleActionResult, ...]


class TelemetryAlarmRuleEngine:
    """Config-driven numeric alarm engine з durable debounce та hysteresis.

    Rule Engine викликається лише для current snapshot.
    TelemetryService передає commit=False та комітить усю операцію разом.
    """

    def __init__(self, session: Session) -> None:
        self._session = session
        self._capabilities = CapabilityRepository(session)
        self._rule_states = AlarmRuleStateRepository(session)
        self._alarms = AlarmRepository(session)
        self._events = EventRepository(session)
        self._lifecycle = AlarmLifecycleService(session)

    def _load_rules(
        self,
        device_id: uuid.UUID,
    ) -> list[tuple[str, NumericAlarmRuleConfig]]:
        assignments = self._capabilities.get_enabled_assignments_for_device(
            device_id
        )

        loaded: list[tuple[str, NumericAlarmRuleConfig]] = []
        seen_keys: set[str] = set()

        for assignment in assignments:
            try:
                rules = parse_alarm_rules(assignment.config)
            except (ValidationError, ValueError) as exc:
                raise AlarmRuleConfigurationError(
                    f"Некоректні alarm_rules для capability "
                    f"{assignment.capability.code}"
                ) from exc

            for rule in rules:
                if not rule.enabled:
                    continue

                if rule.rule_key in seen_keys:
                    raise AlarmRuleConfigurationError(
                        f"Дубльований rule_key: {rule.rule_key}"
                    )

                seen_keys.add(rule.rule_key)
                loaded.append((assignment.capability.code, rule))

        return loaded

    @staticmethod
    def _numeric_value(raw: Any) -> float | None:
        if isinstance(raw, bool):
            return None
        if isinstance(raw, (int, float)):
            value = float(raw)
            return value if math.isfinite(value) else None
        return None

    @staticmethod
    def _candidate_action(
        *,
        rule: NumericAlarmRuleConfig,
        value: float,
        alarm_is_active: bool,
    ) -> str | None:
        if rule.kind == "low":
            if alarm_is_active:
                return "resolve" if value >= rule.clear_threshold else None
            return "raise" if value <= rule.threshold else None

        if alarm_is_active:
            return "resolve" if value <= rule.clear_threshold else None
        return "raise" if value >= rule.threshold else None

    @staticmethod
    def _event_type(
        rule: NumericAlarmRuleConfig,
        action: str,
    ) -> str:
        suffix = "detected" if action == "raise" else "cleared"
        return f"{rule.alarm_type}.{suffix}"

    @staticmethod
    def _event_title(
        rule: NumericAlarmRuleConfig,
        action: str,
    ) -> str:
        if action == "raise":
            return rule.title
        return f"{rule.title}: нормалізовано"

    def _create_event(
        self,
        *,
        device_id: uuid.UUID,
        rule: NumericAlarmRuleConfig,
        capability_code: str,
        action: str,
        value: float,
        occurred_at: datetime,
        source_message_id: uuid.UUID,
    ) -> DeviceEvent:
        threshold = (
            rule.threshold
            if action == "raise"
            else rule.clear_threshold
        )
        comparator = (
            "<=" if rule.kind == "low" else ">="
        )
        if action == "resolve":
            comparator = (
                ">=" if rule.kind == "low" else "<="
            )

        event = DeviceEvent(
            device_id=device_id,
            event_type=self._event_type(rule, action),
            severity=rule.severity if action == "raise" else "info",
            source="telemetry",
            occurred_at=occurred_at,
            source_message_id=source_message_id,
            title=self._event_title(rule, action),
            message=(
                f"{rule.metric}={value:g}; "
                f"умова {comparator} {threshold:g}"
            ),
            data={
                "rule_key": rule.rule_key,
                "alarm_type": rule.alarm_type,
                "capability_code": capability_code,
                "metric": rule.metric,
                "source": rule.source,
                "kind": rule.kind,
                "value": value,
                "threshold": rule.threshold,
                "clear_threshold": rule.clear_threshold,
                "debounce_samples": rule.debounce_samples,
                "action": action,
            },
        )
        return self._events.add(event)

    def evaluate(
        self,
        *,
        device_id: uuid.UUID,
        values: dict[str, Any],
        state: dict[str, Any],
        source_message_id: uuid.UUID,
        occurred_at: datetime,
        commit: bool = True,
    ) -> RuleEngineResult:
        rules = self._load_rules(device_id)
        if not rules:
            return RuleEngineResult(
                configured_rules=0,
                evaluated_rules=0,
                actions=(),
            )

        occurred_at = (
            occurred_at.replace(tzinfo=timezone.utc)
            if occurred_at.tzinfo is None
            else occurred_at.astimezone(timezone.utc)
        )

        # Один Device lock серіалізує debounce-state та lifecycle рішення.
        if self._alarms.lock_device(device_id) is None:
            return RuleEngineResult(
                configured_rules=len(rules),
                evaluated_rules=0,
                actions=(),
            )

        actions: list[RuleActionResult] = []
        evaluated = 0

        try:
            for capability_code, rule in rules:
                payload_bucket = values if rule.source == "values" else state
                if rule.metric not in payload_bucket:
                    continue

                evaluated += 1
                raw_value = payload_bucket[rule.metric]
                value = self._numeric_value(raw_value)

                rule_state = self._rule_states.get_or_create_for_update(
                    device_id=device_id,
                    rule_key=rule.rule_key,
                )

                if value is None:
                    self._rule_states.reset_pending(rule_state)
                    actions.append(
                        RuleActionResult(
                            rule_key=rule.rule_key,
                            action="invalid_value",
                            value=None,
                            pending_count=0,
                            debounce_samples=rule.debounce_samples,
                        )
                    )
                    continue

                self._rule_states.observe(
                    rule_state,
                    value=value,
                    observed_at=occurred_at,
                    source_message_id=source_message_id,
                )

                active_alarm = self._alarms.get_active_for_update(
                    device_id,
                    rule.rule_key,
                )
                candidate = self._candidate_action(
                    rule=rule,
                    value=value,
                    alarm_is_active=active_alarm is not None,
                )

                if candidate is None:
                    self._rule_states.reset_pending(rule_state)
                    actions.append(
                        RuleActionResult(
                            rule_key=rule.rule_key,
                            action=(
                                "hold_active"
                                if active_alarm is not None
                                else "normal"
                            ),
                            value=value,
                            pending_count=0,
                            debounce_samples=rule.debounce_samples,
                            alarm_id=(
                                active_alarm.id
                                if active_alarm is not None
                                else None
                            ),
                        )
                    )
                    continue

                pending_count = self._rule_states.set_pending(
                    rule_state,
                    candidate,
                )

                if pending_count < rule.debounce_samples:
                    actions.append(
                        RuleActionResult(
                            rule_key=rule.rule_key,
                            action=f"pending_{candidate}",
                            value=value,
                            pending_count=pending_count,
                            debounce_samples=rule.debounce_samples,
                            alarm_id=(
                                active_alarm.id
                                if active_alarm is not None
                                else None
                            ),
                        )
                    )
                    continue

                event = self._create_event(
                    device_id=device_id,
                    rule=rule,
                    capability_code=capability_code,
                    action=candidate,
                    value=value,
                    occurred_at=occurred_at,
                    source_message_id=source_message_id,
                )

                context = {
                    "rule_key": rule.rule_key,
                    "metric": rule.metric,
                    "source": rule.source,
                    "kind": rule.kind,
                    "value": value,
                    "threshold": rule.threshold,
                    "clear_threshold": rule.clear_threshold,
                    "capability_code": capability_code,
                    "source_message_id": str(source_message_id),
                }

                if candidate == "raise":
                    lifecycle = self._lifecycle.raise_alarm(
                        device_id=device_id,
                        alarm_key=rule.rule_key,
                        alarm_type=rule.alarm_type,
                        severity=rule.severity,
                        title=rule.title,
                        description=rule.description,
                        occurred_at=occurred_at,
                        event_id=event.id,
                        context=context,
                        commit=False,
                    )
                else:
                    lifecycle = self._lifecycle.resolve_alarm(
                        device_id=device_id,
                        alarm_key=rule.rule_key,
                        occurred_at=occurred_at,
                        event_id=event.id,
                        reason="Telemetry condition cleared",
                        context=context,
                        commit=False,
                    )

                self._rule_states.reset_pending(rule_state)

                actions.append(
                    RuleActionResult(
                        rule_key=rule.rule_key,
                        action=lifecycle.action,
                        value=value,
                        pending_count=0,
                        debounce_samples=rule.debounce_samples,
                        alarm_id=lifecycle.alarm_id,
                        event_id=event.id,
                    )
                )

            if commit:
                self._session.commit()
        except Exception:
            if commit:
                self._session.rollback()
            raise

        return RuleEngineResult(
            configured_rules=len(rules),
            evaluated_rules=evaluated,
            actions=tuple(actions),
        )

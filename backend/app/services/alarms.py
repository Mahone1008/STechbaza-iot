import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.event_alarm import AlarmTransition, DeviceAlarm, DeviceEvent
from app.repositories.alarms import AlarmRepository
from app.repositories.events import EventRepository


class AlarmDeviceNotFoundError(Exception):
    """Device для lifecycle-операції не існує."""


class AlarmEventNotFoundError(Exception):
    """Event, на який посилається lifecycle-операція, не існує."""


class AlarmEventDeviceMismatchError(Exception):
    """Event належить іншому Device."""


class AlarmInvalidSeverityError(Exception):
    """Alarm severity не входить до warning/critical."""


@dataclass(frozen=True, slots=True)
class AlarmLifecycleResult:
    """Результат однієї atomic lifecycle-операції."""

    alarm_id: uuid.UUID | None
    action: str
    state: str | None
    occurrence_count: int
    transition_id: uuid.UUID | None
    duplicate_event: bool
    severity_changed: bool = False


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class AlarmLifecycleService:
    """Atomic lifecycle engine без rule-логіки та notification side effects.

    Операція 3 відповідає лише за правильний стан Alarm:
    raise/repeat/resolve, transition history, ordering та idempotency по Event.
    Яка саме умова має створити Alarm, визначатиме Rule Engine Операції 4.
    """

    _ALLOWED_SEVERITIES = {"warning", "critical"}

    def __init__(self, session: Session) -> None:
        self._session = session
        self._alarms = AlarmRepository(session)
        self._events = EventRepository(session)

    def _lock_device(self, device_id: uuid.UUID) -> None:
        if self._alarms.lock_device(device_id) is None:
            raise AlarmDeviceNotFoundError

    def _get_event(
        self,
        *,
        event_id: uuid.UUID | None,
        device_id: uuid.UUID,
    ) -> DeviceEvent | None:
        if event_id is None:
            return None

        event = self._events.get(event_id)
        if event is None:
            raise AlarmEventNotFoundError

        if event.device_id != device_id:
            raise AlarmEventDeviceMismatchError

        return event

    def _duplicate_result(
        self,
        *,
        event_id: uuid.UUID | None,
        alarm_key: str,
    ) -> AlarmLifecycleResult | None:
        if event_id is None:
            return None

        transition = self._alarms.find_transition_for_event_and_key(
            event_id,
            alarm_key,
        )
        if transition is None:
            return None

        alarm = self._alarms.get(transition.alarm_id)
        if alarm is None:
            return None

        return AlarmLifecycleResult(
            alarm_id=alarm.id,
            action="duplicate_event",
            state=alarm.state,
            occurrence_count=alarm.occurrence_count,
            transition_id=transition.id,
            duplicate_event=True,
        )

    def raise_alarm(
        self,
        *,
        device_id: uuid.UUID,
        alarm_key: str,
        alarm_type: str,
        severity: str,
        title: str,
        occurred_at: datetime,
        event_id: uuid.UUID | None = None,
        description: str | None = None,
        context: dict[str, Any] | None = None,
    ) -> AlarmLifecycleResult:
        """Створити новий incident або зафіксувати repeat active Alarm."""

        if severity not in self._ALLOWED_SEVERITIES:
            raise AlarmInvalidSeverityError(severity)

        occurred_at = _utc(occurred_at)
        incoming_context = dict(context or {})

        try:
            # Device row lock серіалізує конкурентні raise/resolve для Device.
            self._lock_device(device_id)
            self._get_event(event_id=event_id, device_id=device_id)

            duplicate = self._duplicate_result(
                event_id=event_id,
                alarm_key=alarm_key,
            )
            if duplicate is not None:
                self._session.commit()
                return duplicate

            active = self._alarms.get_active_for_update(
                device_id,
                alarm_key,
            )

            if active is None:
                alarm = DeviceAlarm(
                    device_id=device_id,
                    alarm_key=alarm_key,
                    alarm_type=alarm_type,
                    severity=severity,
                    state="active",
                    title=title,
                    description=description,
                    first_raised_at=occurred_at,
                    last_raised_at=occurred_at,
                    resolved_at=None,
                    last_event_id=event_id,
                    occurrence_count=1,
                    context=incoming_context,
                )
                self._alarms.add_alarm(alarm)

                transition = AlarmTransition(
                    alarm_id=alarm.id,
                    event_id=event_id,
                    transition_type="raised",
                    from_state=None,
                    to_state="active",
                    occurred_at=occurred_at,
                    data={"severity": severity},
                )
                self._alarms.add_transition(transition)
                self._session.commit()

                return AlarmLifecycleResult(
                    alarm_id=alarm.id,
                    action="raised",
                    state=alarm.state,
                    occurrence_count=alarm.occurrence_count,
                    transition_id=transition.id,
                    duplicate_event=False,
                )

            previous_severity = active.severity
            stale_occurrence = occurred_at < active.last_raised_at

            active.occurrence_count += 1

            if not stale_occurrence:
                active.last_raised_at = occurred_at
                active.last_event_id = event_id
                active.alarm_type = alarm_type
                active.title = title
                if description is not None:
                    active.description = description
                active.context = {
                    **dict(active.context or {}),
                    **incoming_context,
                }
                active.severity = severity

            repeated = AlarmTransition(
                alarm_id=active.id,
                event_id=event_id,
                transition_type="repeated",
                from_state="active",
                to_state="active",
                occurred_at=occurred_at,
                data={
                    "stale_occurrence": stale_occurrence,
                    "occurrence_count": active.occurrence_count,
                },
            )
            self._alarms.add_transition(repeated)

            severity_changed = (
                not stale_occurrence
                and previous_severity != severity
            )
            if severity_changed:
                self._alarms.add_transition(
                    AlarmTransition(
                        alarm_id=active.id,
                        event_id=event_id,
                        transition_type="severity_changed",
                        from_state="active",
                        to_state="active",
                        occurred_at=occurred_at,
                        data={
                            "from_severity": previous_severity,
                            "to_severity": severity,
                        },
                    )
                )

            self._session.commit()

            return AlarmLifecycleResult(
                alarm_id=active.id,
                action="repeated",
                state=active.state,
                occurrence_count=active.occurrence_count,
                transition_id=repeated.id,
                duplicate_event=False,
                severity_changed=severity_changed,
            )
        except Exception:
            self._session.rollback()
            raise

    def resolve_alarm(
        self,
        *,
        device_id: uuid.UUID,
        alarm_key: str,
        occurred_at: datetime,
        event_id: uuid.UUID | None = None,
        reason: str | None = None,
        context: dict[str, Any] | None = None,
    ) -> AlarmLifecycleResult:
        """Закрити active incident, не дозволяючи stale recovery його знищити."""

        occurred_at = _utc(occurred_at)
        incoming_context = dict(context or {})

        try:
            self._lock_device(device_id)
            self._get_event(event_id=event_id, device_id=device_id)

            duplicate = self._duplicate_result(
                event_id=event_id,
                alarm_key=alarm_key,
            )
            if duplicate is not None:
                self._session.commit()
                return duplicate

            active = self._alarms.get_active_for_update(
                device_id,
                alarm_key,
            )
            if active is None:
                latest = self._alarms.get_latest_for_key(
                    device_id,
                    alarm_key,
                )
                self._session.commit()
                return AlarmLifecycleResult(
                    alarm_id=latest.id if latest is not None else None,
                    action="already_resolved",
                    state=latest.state if latest is not None else None,
                    occurrence_count=(
                        latest.occurrence_count
                        if latest is not None
                        else 0
                    ),
                    transition_id=None,
                    duplicate_event=False,
                )

            if occurred_at < active.last_raised_at:
                self._session.commit()
                return AlarmLifecycleResult(
                    alarm_id=active.id,
                    action="ignored_stale_resolution",
                    state=active.state,
                    occurrence_count=active.occurrence_count,
                    transition_id=None,
                    duplicate_event=False,
                )

            active.state = "resolved"
            active.resolved_at = occurred_at
            active.last_event_id = event_id
            active.context = {
                **dict(active.context or {}),
                **incoming_context,
            }

            transition = AlarmTransition(
                alarm_id=active.id,
                event_id=event_id,
                transition_type="resolved",
                from_state="active",
                to_state="resolved",
                occurred_at=occurred_at,
                reason=reason,
                data={},
            )
            self._alarms.add_transition(transition)
            self._session.commit()

            return AlarmLifecycleResult(
                alarm_id=active.id,
                action="resolved",
                state=active.state,
                occurrence_count=active.occurrence_count,
                transition_id=transition.id,
                duplicate_event=False,
            )
        except Exception:
            self._session.rollback()
            raise

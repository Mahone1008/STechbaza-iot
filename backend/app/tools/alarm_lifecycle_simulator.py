import argparse
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from app.db import SessionLocal
from app.models.event_alarm import DeviceEvent
from app.repositories.events import EventRepository
from app.services.alarms import AlarmLifecycleService


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_context(raw: str) -> dict[str, Any]:
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("--context-json повинен бути JSON object")
    return value


def _add_event(
    *,
    session,
    device_id: uuid.UUID,
    event_type: str,
    severity: str,
    title: str,
    message: str,
    context: dict[str, Any],
    event_id: uuid.UUID,
    occurred_at: datetime,
) -> DeviceEvent:
    event = DeviceEvent(
        id=event_id,
        device_id=device_id,
        event_type=event_type,
        severity=severity,
        source="system",
        occurred_at=occurred_at,
        title=title,
        message=message,
        data=context,
    )
    return EventRepository(session).add(event)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Локальний simulator для перевірки Alarm Lifecycle Service. "
            "Не є public API та не використовується Device firmware."
        )
    )
    subparsers = parser.add_subparsers(dest="action", required=True)

    raise_parser = subparsers.add_parser("raise")
    raise_parser.add_argument("--device-id", required=True)
    raise_parser.add_argument("--alarm-key", required=True)
    raise_parser.add_argument("--alarm-type", required=True)
    raise_parser.add_argument(
        "--severity",
        choices=("warning", "critical"),
        required=True,
    )
    raise_parser.add_argument("--title", required=True)
    raise_parser.add_argument("--description")
    raise_parser.add_argument("--context-json", default="{}")

    resolve_parser = subparsers.add_parser("resolve")
    resolve_parser.add_argument("--device-id", required=True)
    resolve_parser.add_argument("--alarm-key", required=True)
    resolve_parser.add_argument("--reason")
    resolve_parser.add_argument("--context-json", default="{}")

    args = parser.parse_args()
    device_id = uuid.UUID(args.device_id)
    context = _parse_context(args.context_json)
    occurred_at = _utc_now()
    event_id = uuid.uuid4()

    with SessionLocal() as session:
        try:
            if args.action == "raise":
                _add_event(
                    session=session,
                    device_id=device_id,
                    event_type=f"{args.alarm_type}.detected",
                    severity=args.severity,
                    title=args.title,
                    message=args.description or "Alarm condition detected",
                    context=context,
                    event_id=event_id,
                    occurred_at=occurred_at,
                )
                result = AlarmLifecycleService(session).raise_alarm(
                    device_id=device_id,
                    alarm_key=args.alarm_key,
                    alarm_type=args.alarm_type,
                    severity=args.severity,
                    title=args.title,
                    description=args.description,
                    occurred_at=occurred_at,
                    event_id=event_id,
                    context=context,
                )
            else:
                _add_event(
                    session=session,
                    device_id=device_id,
                    event_type="alarm.condition.cleared",
                    severity="info",
                    title="Alarm condition cleared",
                    message=args.reason or "Alarm condition cleared",
                    context=context,
                    event_id=event_id,
                    occurred_at=occurred_at,
                )
                result = AlarmLifecycleService(session).resolve_alarm(
                    device_id=device_id,
                    alarm_key=args.alarm_key,
                    occurred_at=occurred_at,
                    event_id=event_id,
                    reason=args.reason,
                    context=context,
                )

            print(
                (
                    f"[EVENT] id={event_id} "
                    f"device_id={device_id} action={args.action}"
                ),
                flush=True,
            )
            print(
                (
                    f"[ALARM] alarm_id={result.alarm_id} "
                    f"action={result.action} state={result.state} "
                    f"occurrence_count={result.occurrence_count} "
                    f"transition_id={result.transition_id} "
                    f"duplicate_event={result.duplicate_event} "
                    f"severity_changed={result.severity_changed}"
                ),
                flush=True,
            )
        except Exception:
            session.rollback()
            raise


if __name__ == "__main__":
    main()

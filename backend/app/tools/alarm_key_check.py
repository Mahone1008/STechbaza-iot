"""Read-only preflight H-03 для існуючої БД перед оновленням backend.

Не перейменовує config/Alarm та не переписує історію. Exit 1 означає, що
потрібно окремо виправити знайдену конфігурацію або розібрати активний incident.
"""

import json

from sqlalchemy import select, text

from app.alarm_keys import is_system_alarm_key
from app.db import SessionLocal
from app.models.capability import DeviceCapability
from app.models.event_alarm import DeviceAlarm
from app.schemas.alarm_rule import parse_alarm_rules


def find_conflicts(session):
    """Повертає generator ідентифікаторів проблем, без payload чи credentials."""
    configs = select(DeviceCapability).order_by(DeviceCapability.id).execution_options(yield_per=200)
    for assignment in session.scalars(configs):
        try:
            rules = parse_alarm_rules(assignment.config, allow_reserved_keys=True)
        except ValueError:
            yield {"kind": "invalid_rule_config", "device_id": str(assignment.device_id),
                   "assignment_id": str(assignment.id)}
            continue
        for rule in rules:
            if is_system_alarm_key(rule.rule_key):
                yield {"kind": "reserved_rule_key", "device_id": str(assignment.device_id),
                       "assignment_id": str(assignment.id), "rule_key": rule.rule_key}

    alarms = (select(DeviceAlarm).where(DeviceAlarm.state == "active")
              .order_by(DeviceAlarm.id).execution_options(yield_per=200))
    for alarm in session.scalars(alarms):
        # Rule Engine завжди додавав rule_key до context; змішаний incident
        # зберігає це поле навіть після системного repeat. Не вгадуємо його стан.
        if is_system_alarm_key(alarm.alarm_key) and "rule_key" in (alarm.context or {}):
            yield {"kind": "active_legacy_rule_alarm", "device_id": str(alarm.device_id),
                   "alarm_id": str(alarm.id), "alarm_key": alarm.alarm_key}


def main():
    count = 0
    with SessionLocal() as session:
        session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
        for issue in find_conflicts(session):
            count += 1
            print(json.dumps(issue, ensure_ascii=False), flush=True)
    if count:
        print(f"FAIL: alarm key preflight; {count} conflicts. Existing data was not changed.", flush=True)
        raise SystemExit(1)
    print("PASS: alarm key preflight; no reserved rules or active legacy collisions", flush=True)


if __name__ == "__main__":
    main()

# Alarm Lifecycle v1

## Мета

Alarm Lifecycle Service керує durable incident-state поверх append-only Events.

Він не вирішує, коли саме pressure/current/fault має вважатися аварією. Це завдання Rule Engine наступної операції.

## Lifecycle

```text
немає active alarm
        + raise
        ↓
ACTIVE incident
occurrence_count = 1
transition = raised

ACTIVE incident
        + raise
        ↓
той самий ACTIVE incident
occurrence_count += 1
transition = repeated

ACTIVE incident
        + resolve
        ↓
RESOLVED incident
transition = resolved

RESOLVED incident
        + новий raise
        ↓
НОВИЙ ACTIVE incident
```

v1 навмисно створює новий incident після повного resolve. Це не змішує дві окремі аварії, які могли статися з різницею у дні або місяці.

## Concurrency

Перед зміною lifecycle service бере PostgreSQL `FOR UPDATE` lock на Device row.

```text
Device lock
  ↓
read current active alarm
  ↓
mutate alarm + append transition
  ↓
commit
```

Це серіалізує одночасні raise/resolve для одного Device та працює разом із partial UNIQUE index:

```text
(device_id, alarm_key) WHERE state = 'active'
```

## Event idempotency

Якщо lifecycle operation прив'язана до `event_id`, повторна обробка того самого Event для того самого `alarm_key` не збільшує `occurrence_count` вдруге.

Результат:

```text
action = duplicate_event
duplicate_event = true
```

## Out-of-order protection

Late raise зберігається як occurrence та transition, але не переписує current Alarm snapshot старішими даними.

Stale resolve, timestamp якого старіший за `last_raised_at`, не може закрити новішу активну проблему:

```text
action = ignored_stale_resolution
```

## Severity

Підтримуються:

```text
warning
critical
```

Якщо severity змінюється на новому не-stale occurrence, lifecycle додає окремий transition:

```text
severity_changed
```

## Read API

```text
GET /api/v1/devices/{device_id}/alarms
GET /api/v1/alarms/{alarm_id}
GET /api/v1/alarms/{alarm_id}/transitions
```

List endpoint підтримує:

```text
state
severity
alarm_type
limit
offset
```

Усі endpoints tenant-scoped через `alarm.read` та `AccessControl.require_alarm`.

## Mutation surface

Public API для довільного `raise` або `resolve` навмисно відсутній.

Production mutations повинні надходити від trusted backend services / Rule Engine. Для локальної перевірки існує лише developer simulator:

```text
python -m app.tools.alarm_lifecycle_simulator
```
# Events & Alarms Data Model v1

## 1. DeviceEvent

Таблиця:

```text
device_events
```

Event — append-only факт. Він не має lifecycle і не «редагується в resolved».

Основні поля:

```text
id
device_id
event_type
severity
source
occurred_at
received_at
source_message_id
title
message
data JSONB
```

`occurred_at` — коли подія фактично сталася.  
`received_at` — коли backend її отримав/створив.

Sources v1:

```text
telemetry
presence
command
device
system
```

Severity:

```text
info
warning
critical
```

## 2. DeviceAlarm

Таблиця:

```text
device_alarms
```

Alarm — не просто запис у журналі, а lifecycle operational problem.

Основні поля:

```text
id
device_id
alarm_key
alarm_type
severity
state
title
description
first_raised_at
last_raised_at
resolved_at
acknowledged_at
acknowledged_by_*
last_event_id
occurrence_count
context JSONB
created_at
updated_at
```

State v1:

```text
active
resolved
```

Acknowledgement навмисно не є state.

```text
active + not acknowledged
active + acknowledged
resolved + not acknowledged
resolved + acknowledged
```

Це дозволяє не плутати людську дію «я побачив» з фізичним фактом «проблема зникла».

## 3. alarm_key

`alarm_type` описує клас проблеми:

```text
pressure.low
```

`alarm_key` описує конкретну alarm instance identity:

```text
pressure.low:main_line
pressure.low:fertilizer_line
```

Це важливо для модульного конструктора TechBaza, де в одного Device може бути кілька однотипних sensor channels.

## 4. One-active-alarm invariant

У PostgreSQL є partial unique index:

```text
(device_id, alarm_key)
WHERE state = 'active'
```

Отже одночасно не може існувати дві active alarm з тим самим key для одного Device.

Після resolve нова alarm з тим самим key у майбутньому дозволена.

## 5. AlarmTransition

Таблиця:

```text
alarm_transitions
```

Це append-only журнал lifecycle alarm.

Transition types v1:

```text
raised
repeated
acknowledged
resolved
reopened
severity_changed
```

Поля actor_* зарезервовані для user-driven дій, перш за все acknowledge.

## 6. Чому Event і Alarm розділені

Приклад:

```text
10:00 pressure = 0.4 bar
→ Event pressure.low
→ Alarm pressure.low:main_line ACTIVE

10:01 pressure = 0.3 bar
→ ще один Event
→ та сама Alarm, occurrence_count += 1

10:02 operator acknowledge
→ Alarm усе ще ACTIVE
→ AlarmTransition acknowledged

10:05 pressure = 2.1 bar
→ recovery Event
→ Alarm RESOLVED
→ AlarmTransition resolved
```

Якщо зберігати лише один alarm row без event history, ми втрачаємо хронологію. Якщо зберігати лише events, UI не знає, яка проблема зараз активна.

## 7. Audit durability

Actor metadata у transition зберігається snapshot-ом, як і Command Actor Audit.

Це дозволить пізніше відповісти:

```text
хто acknowledge alarm?
з якої session?
у якій Organization?
з якою tenant role?
```

## 8. Межа v1

Data Model v1 ще не генерує alarms автоматично.

Rule Engine, debounce, hysteresis, offline detector та acknowledge API реалізуються наступними операціями.
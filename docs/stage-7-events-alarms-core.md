# Етап 7 — Events & Alarms Core

**Статус:** у роботі  
**Backend:** 0.24.0+

## Мета

Побудувати окремий operational layer для подій та аварій поверх уже готових Telemetry, Device Presence, Commands і Security.

Після Етапу 7 backend повинен не лише зберігати сирі вимірювання, а й пояснювати оператору, що сталося, що потребує уваги, чи проблема ще активна, хто її підтвердив та коли вона була вирішена.

```text
Telemetry / Presence / Command / Device signal
        ↓
      Event
        ↓
   Alarm Rule Engine
        ↓
     Active Alarm
        ↓
 acknowledge / resolve
        ↓
 Alarm Transition History
        ↓
 Notifications / UI
```

## Базовий принцип

`Event` і `Alarm` — не одне й те саме.

```text
Event
→ незмінний факт у часі
→ наприклад: device reboot, VFD fault code, command failed

Alarm
→ operational проблема, яка має lifecycle
→ active / resolved
→ acknowledgement окремо від фізичного resolution
```

Тобто acknowledgement означає «оператор побачив проблему», а resolved означає «умова проблеми більше не активна».

## Severity v1

```text
event: info | warning | critical
alarm: warning | critical
```

## Planned operations

```text
Операція 1 — Events & Alarms Data Model Foundation        ✅ завершено
Операція 2 — Events API + tenant-scoped read model
Операція 3 — Alarm Lifecycle Service
Операція 4 — Rule Engine + debounce / hysteresis / anti-spam
Операція 5 — System alarms: offline / reboot / command failure
Операція 6 — Acknowledge + actor audit
Операція 7 — Notifications foundation + final E2E
```

## Перші alarm types

Архітектура одразу розрахована на:

```text
vfd.fault
pressure.low
pressure.high
current.high
sensor.failure
device.offline
device.reboot
rs485.lost
command.failed
```

Не всі ці rules вмикаються в Операції 1. Операція 1 створює правильну durable data model.

## Security

Етап 7 використовує готовий security foundation Етапу 6:

```text
CurrentUserContext
+ Organization scope
+ RBAC
+ actor audit
```

Жоден alarm API не повинен обходити tenant isolation.

## Операція 1 — Definition of Done

```text
device_events model                         ✅ code
device_alarms model                         ✅ code
alarm_transitions model                     ✅ code
severity/state DB constraints               ✅ code
one active alarm per device+alarm_key       ✅ code
actor fields for future acknowledge audit   ✅ code
migration 20260925_0011                     ✅ code
backend version 0.24.0                      ✅ code
local migration verification                ✅
DB tables verification                      ✅
DB constraints verification                 ✅
one-active-alarm invariant                  ✅
```

Після локальної перевірки Операція 1 буде закрита.

### Локальна verification Операції 1

Підтверджено локально:

```text
GET /health → backend 0.24.0                     ✅
alembic_version = 20260925_0011                 ✅
device_events table exists                     ✅
device_alarms table exists                     ✅
alarm_transitions table exists                 ✅
```

Залишилось перевірити DB constraints та one-active-alarm invariant.


### Verification result — Операція 1

Локально підтверджено:

```text
device_events structure                         ✅
device_alarms structure                         ✅
alarm_transitions structure                     ✅

ck_device_events_severity                       ✅
invalid severity = banana → rejected            ✅

uq_device_alarms_active_key                     ✅
first active alarm insert                       ✅
second active alarm with same key → rejected    ✅
```

Ключовий DB invariant підтверджено:

```text
(device_id, alarm_key)
WHERE state = 'active'
→ максимум одна active Alarm для конкретного alarm_key
```

Операція 1 — завершено.

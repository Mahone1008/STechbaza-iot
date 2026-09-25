# Етап 7 — Events & Alarms Core

**Статус:** у роботі (операції 1–4 локально перевірено)  
**Backend:** 0.27.0

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
Операція 2 — Events API + tenant-scoped read model        ✅ завершено
Операція 3 — Alarm Lifecycle Service                       ✅ завершено
Операція 4 — Rule Engine + debounce / hysteresis / anti-spam ✅ перевірено локально
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


## Операція 2 — Events API + tenant-scoped read model

Додано backend 0.25.0.

### API

```text
GET /api/v1/devices/{device_id}/events
GET /api/v1/events/{event_id}
```

List endpoint підтримує:

```text
limit
offset
event_type
severity
source
occurred_from
occurred_to
```

Events API навмисно read-only. Event creation поки не відкривається як public endpoint:
system events повинні створюватися backend services / rule engine, а не довільним клієнтом.

### RBAC

Додано permission:

```text
event.read
```

Його мають tenant roles:

```text
owner
admin
operator
viewer
service
```

Кожний Event наслідує tenant через:

```text
Event
  ↓ device_id
Device
  ↓ site_id
Site
  ↓ organization_id
OrganizationMembership
  ↓
event.read
```

Для `GET /events/{event_id}` використовується та сама anti-enumeration policy,
що й для інших tenant resources: чужий Event та відсутній Event не повинні
розкриватися різними відповідями.

### Definition of Done

```text
EventRepository                                  ✅ code
DeviceEventRead                                  ✅ code
GET /devices/{device_id}/events                  ✅ code
GET /events/{event_id}                           ✅ code
filters + pagination                             ✅ code
event.read permission                            ✅ code
tenant-scoped AccessControl.require_event        ✅ code
backend 0.25.0                                   ✅ code
local endpoint verification                      ✅
foreign tenant anti-enumeration verification     ✅
filter verification                              ✅
```


### Verification result — Операція 2

Локально підтверджено:

```text
GET /health → backend 0.25.0                                  ✅
insert own tenant test Event                                  ✅
insert foreign tenant test Event                              ✅
GET /devices/{device_id}/events                               ✅
severity/source/event_type filters                            ✅
GET /events/{event_id} для свого tenant                       ✅
GET /events/{foreign_event_id} → 404 "Ресурс не знайдено"     ✅
GET /events/{missing_event_id} → 404 "Ресурс не знайдено"     ✅
```

Anti-enumeration invariant підтверджено:

```text
foreign Event      → 404
missing Event      → 404
```

Отже Events API не розкриває існування ресурсів іншого tenant.

Операція 2 — завершено.


## Операція 3 — Alarm Lifecycle Service

Додано backend 0.26.0.

### Lifecycle semantics

```text
first raise       → new ACTIVE incident + raised transition
repeat raise      → same ACTIVE incident + occurrence_count + repeated
resolve           → RESOLVED + resolved transition
raise after close → new ACTIVE incident
```

Acknowledge навмисно не входить до Операції 3 і буде окремою user-driven дією в Операції 6.

### Reliability

```text
Device row FOR UPDATE lock                       ✅ code
same-event idempotency                           ✅ code
stale raise snapshot protection                  ✅ code
stale resolve protection                         ✅ code
severity_changed transition                      ✅ code
one-active-alarm DB invariant                    ✅ existing
```

### Read API

```text
GET /api/v1/devices/{device_id}/alarms
GET /api/v1/alarms/{alarm_id}
GET /api/v1/alarms/{alarm_id}/transitions
```

Додано permission:

```text
alarm.read
```

### Local verification

```text
backend 0.26.0                                   ⏳
first raise → active / count=1                   ⏳
repeat raise → same alarm / count=2              ⏳
resolve → resolved                               ⏳
transition history raised/repeated/resolved       ⏳
raise after resolve → new alarm id               ⏳
tenant-scoped Alarm API                          ⏳
```


### Часткова verification — raise/repeat

Локально підтверджено:

```text
backend 0.26.0                                      ✅
first raise → action=raised, state=active, count=1   ✅
repeat raise → same alarm_id, count=2               ✅
duplicate active Alarm не створюється                ✅
```


### Часткова verification — resolve/transitions

Локально підтверджено:

```text
Alarm read API повертає state=resolved                 ✅
occurrence_count зберігся = 2                          ✅
resolved_at встановлено                               ✅
transition history містить raised/repeated/resolved    ✅
resolved transition з reason=Pressure restored         ✅
```


### Часткова verification — new incident after resolve

Локально підтверджено:

```text
resolved incident id = 6e625e36-3b95-4d26-83bc-e615bdf72e7b ✅
new incident id      = 722a99e1-8a1b-412f-a486-2c811aa9c7b0 ✅
new incident state   = active                              ✅
new occurrence_count = 1                                   ✅
old incident remains resolved                               ✅
device alarm list contains both incidents                    ✅
```


### Часткова verification — foreign Alarm anti-enumeration

Локально підтверджено:

```text
foreign tenant Alarm id = ea80920e-fc8b-4a99-9d52-3bd7b185cd90 ✅
GET foreign Alarm під tenant A user → 404 "Ресурс не знайдено" ✅
missing Alarm comparison                                      ✅
```


### Verification result — Операція 3

Alarm Lifecycle Service локально підтверджено повністю:

```text
backend 0.26.0                                         ✅
first raise → ACTIVE / occurrence_count=1              ✅
repeat raise → same alarm_id / occurrence_count=2      ✅
resolve → RESOLVED                                     ✅
transition history raised/repeated/resolved             ✅
raise after resolve → new alarm_id / count=1            ✅
old incident remains resolved                           ✅
foreign Alarm → 404                                     ✅
missing Alarm → 404                                     ✅
tenant anti-enumeration preserved                       ✅
```

Операція 3 — завершено.



## Операція 4 — Rule Engine + telemetry integration

Реалізовано конфігурацію числових правил у `DeviceCapability.config.alarm_rules` з перевіркою порогів, debounce і hysteresis. Стан правила зберігається у `device_alarm_rule_states` (міграція `20260925_0012`). Правила працюють лише для enabled capabilities конкретного пристрою.

`TelemetryService` оцінює правила лише для нового актуального snapshot. Один PostgreSQL Device lock впорядковує пакети пристрою; telemetry message, DeviceState, rule state, Event, Alarm і transition записуються однією транзакцією. При помилці зміни відкочуються разом.

### Локальна перевірка Операції 4

```text
Alembic head = 20260925_0012                              ✅
50 → normal; 85 → pending raise; 90 → ACTIVE              ✅
92, 75 → same ACTIVE alarm, no repeated Event             ✅
68 → pending resolve; 65 → RESOLVED                       ✅
85, 90 → second ACTIVE alarm with new id                   ✅
duplicate message_id → no extra transition                ✅
stale sequence / old session → no rule evaluation         ✅
new session → state updated, old session stays ignored    ✅
disabled vfd.frequency.read → capability_violation        ✅
forced failure after Event+Alarm write → full rollback    ✅
temporary rule removed; capability enabled; active=0      ✅
```

Тестові завершені інциденти залишено в історії локальної БД. Формат правил, приклад і відтворювана перевірка транзакції наведені в [Alarm Rule Engine v1](alarm-rule-engine-v1.md).

Перед production-використанням окремо перевірити доставку MQTT після помилки БД: тест транзакції підтвердив відкат PostgreSQL, але не повторну доставку пакета брокером. System alarms, acknowledge та notifications входять до наступних операцій.

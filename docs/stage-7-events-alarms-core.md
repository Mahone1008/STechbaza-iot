# Етап 7 — Events & Alarms Core

**Статус:** у роботі (операції 1–6 перевірено; операція 7 очікує локальної перевірки)
**Backend:** 0.31.0

Окремий блок [виправлень надійності та доступу](hardening-2026-09-25.md)
та HTTP-перевірку операції 6 користувач підтвердив локально 25.09.2026.
Операцію 6 закрито; реалізація операції 7 описана в
[Notifications foundation v1](notifications-foundation-v1.md).

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
Операція 5 — System alarms: offline / reboot / command failure ✅ перевірено локально
Операція 6 — Acknowledge + actor audit ✅ перевірено локально
Операція 7 — Notifications foundation + final E2E ⏳ код, очікує перевірки
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

## Операція 5 — System alarms

Створено Event та Alarm для `device.offline`, `device.reboot` і
`command.failed`. Offline закривається від актуального heartbeat/telemetry,
reboot — після другого окремого повідомлення нової boot session,
command failure — після успішної новішої команди того самого типу.
Старі session і повторні повідомлення не створюють повторних тривог.

Міграція `20260925_0013` зберігає відомі boot sessions. У backend
`0.28.0` фоновий цикл перевіряє offline; command і system alarm
фіксуються атомарно. Деталі та відтворюваний локальний тест:
[System Alarms v1](system-alarms-v1.md).

Локально підтверджено: міграція `20260925_0013 (head)`, backend `0.28.0`,
працює фоновий цикл без помилок; `system_alarm_check` пройшов сценарії
відключення/відновлення, reboot, команд та підтвердив відкат тестових даних.

Операція 5 — завершено.

## Операція 6 — Acknowledge + actor audit

Backend `0.29.0`. `POST /api/v1/alarms/{alarm_id}/acknowledge`
позначає активну тривогу як переглянуту оператором. Лише перше підтвердження
заповнює `acknowledged_at` і знімок автора в Alarm та додає один
`acknowledged` transition з user/session/organization/role/email/name.
Повторний запит повертає вже підтверджений incident без зміни автора або
дублювання transition. Для вирішеної без підтвердження тривоги — 409;
для чужого й відсутнього ресурсу — однаковий 404.

Permission `alarm.acknowledge`: owner/admin/operator/service. Viewer має
`alarm.read`, але підтвердження отримує 403. Device lock серіалізує
користувацьке підтвердження з фоновим resolve/repeat. Нова міграція не потрібна:
поля та тип transition вже існують з операції 1.

Перевірка на Docker: `python -m app.tools.alarm_ack_check`. Вона перевіряє
RBAC, tenant, повтор, immutable actor audit, resolved 409 і відкочує всю
тестову транзакцію. Додатковий сценарій
`python -m app.tools.alarm_ack_http_check` проходить через справжні ASGI
маршрути та перевірку Bearer JWT: 401, 403, 404, 409, перший/повторний
acknowledge, історію переходів і відкликання сесії. Він також відкочує
тимчасові Device, Alarm, User та AuthSession.

### Локальний результат — 25.09.2026

Користувач підтвердив успішне виконання `alarm_ack_http_check` на backend
`0.30.0` після migration `20260925_0014`: три `PASS` для JWT/HTTP доступу,
першого та повторного підтвердження з actor audit і відкату тестових даних.
Результат прийнято за повідомленням користувача; повний тестовий лог у чаті
не надано. Скриншотами окремо підтверджено migration 0014 та `/health` 0.30.0.

Операція 6 — завершено. Наступна — Операція 7: Notifications foundation + final E2E.

## Операція 7 — Notifications foundation + final E2E

Backend `0.31.0`, migration `20260925_0015`. Додано атомарну in-app стрічку
організації для raised/severity_changed/resolved та персональні read receipts.
Повтори вимірювань і acknowledge не створюють спам у стрічці; одне повідомлення
відповідає одному значущому transition. Read, acknowledge та resolve мають
окрему семантику. Tenant guards використовуються на list/detail/count/read.

Вісім нових PostgreSQL/JWT/MQTT сценаріїв перевіряють повний ланцюжок,
відкати, конкурентні операції, snapshot історії та ізоляцію організацій.
CI також перевіряє downgrade/upgrade 0015 у тимчасовій базі.
Команди локальної перевірки одним PowerShell-блоком і межі реалізації:
[Notifications foundation v1](notifications-foundation-v1.md).

Telegram/email/push та UI є наступними окремими блоками. Операція 7 і весь
Етап 7 залишаються відкритими до локального підтвердження користувачем.



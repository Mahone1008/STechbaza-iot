# Досьє V3.5 — Етап 4
## IoT Telemetry & Reliability: MQTT ingestion, current state, heartbeat, ordering та reboot/session protection

**Статус:** завершено  
**Версія:** V3.5  
**Етап:** 4  
**Межі етапу:** усі роботи після завершення Етапу 3 Data Model v1 і до початку command channel  
**Мета етапу:** перетворити доменну модель TechBaza на надійний двосторонньо підготовлений IoT-фундамент, який уже вміє приймати реальні дані від контролера, перевіряти їх, зберігати історію, підтримувати current state, визначати online/offline та захищатися від проблем нестабільної мережі й reboot контролера.

---

# 1. Що було на старті Етапу 4

Після Етапу 3 система вже знала:

```text
Organization
    ↓
Site
    ↓
Device
    ↓
DeviceCapability
    ↓
Capability
```

Для тестового об'єкта вже існували:

```text
Organization:
TechBaza Test Farm

Site:
Поле 1

Device:
TB-ESP32-001

Capability:
vfd.control
```

Але система ще не мала повноцінного telemetry pipeline.

Тобто PostgreSQL знав, **який пристрій існує і що він уміє**, але ще не знав:

- що реально зараз відбувається з VFD;
- яка частота;
- працює насос чи ні;
- коли пристрій востаннє був online;
- як зберігати history;
- як відрізнити duplicate;
- як пережити затримки 4G;
- як пережити reboot ESP32.

Саме це і стало предметом Етапу 4.

---

# 2. Карта операцій Етапу 4

Етап 4 фактично складався з шести послідовних операцій:

```text
Операція 1
Telemetry schema + history/current state storage
        ↓
Операція 2
MQTT → Backend → PostgreSQL ingestion
        ↓
Операція 3
Capability-aware telemetry
        ↓
Операція 4
Heartbeat + ONLINE/OFFLINE
        ↓
Операція 5
Stale / Out-of-order protection
        ↓
Операція 6
Reboot / Session Protection
```

Разом вони сформували один завершений telemetry/reliability етап.

---

# 3. Операція 1 — Telemetry schema + history/current state storage

## 3.1. Завдання

Потрібно було розділити два різні поняття:

```text
ІСТОРІЯ
що реально приходило від контролера

CURRENT STATE
що система вважає актуальним станом зараз
```

Для цього були створені дві окремі таблиці.

## 3.2. telemetry_messages

```text
telemetry_messages
```

Це append-only історія валідних telemetry messages.

Один рядок = один прийнятий telemetry packet.

Базові поля:

```text
id
message_id
device_id
schema_version
sequence
sent_at
received_at
values
state
```

## 3.3. device_states

```text
device_states
```

Це current snapshot пристрою.

Його задача — не зберігати всю історію, а швидко відповідати на питання:

```text
Який стан цього Device система вважає актуальним зараз?
```

Базові поля на першій версії:

```text
device_id
last_telemetry_id
last_reported_at
last_received_at
values
state
created_at
updated_at
```

## 3.4. Міграція

Було застосовано Alembic migration:

```text
20260924_0002
```

Після неї в PostgreSQL реально з'явились:

```text
telemetry_messages
device_states
```

## 3.5. Архітектурна схема

```text
             incoming telemetry
                    │
                    ▼
           telemetry_messages
              append-only
                    │
                    └──────────┐
                               ▼
                          device_states
                          current snapshot
```

---

# 4. Операція 2 — MQTT → Backend → PostgreSQL ingestion

## 4.1. MQTT topic

Backend був підписаний на:

```text
techbaza/devices/+/telemetry
```

Для тестового Device:

```text
techbaza/devices/TB-ESP32-001/telemetry
```

Wildcard `+` дозволяє одному backend обслуговувати багато контролерів:

```text
TB-ESP32-001
TB-ESP32-002
TB-ESP32-003
...
```

без окремої підписки для кожного.

## 4.2. Telemetry Contract v1

Початковий payload:

```json
{
  "schema_version": 1,
  "message_id": "UUID",
  "sent_at": "2026-09-24T08:30:00Z",
  "sequence": 1,
  "values": {
    "vfd.frequency_hz": 42.5
  },
  "state": {
    "pump_running": true
  }
}
```

## 4.3. Що робить backend

```text
MQTT message
    ↓
topic parsing
    ↓
device_uid
    ↓
JSON decode
    ↓
Pydantic validation
    ↓
Device lookup
    ↓
business validation
    ↓
PostgreSQL transaction
    ├── telemetry_messages
    └── device_states
```

## 4.4. Перший негативний тест: broken JSON

Під час локального тесту PowerShell + `docker exec ... mosquitto_pub -m` пошкодив JSON-лапки.

Backend отримав щось на кшталт:

```text
{schema_version:1,message_id:...,values:{vfd.frequency_hz:42.5}}
```

замість валідного JSON.

Backend правильно відповів:

```text
status = rejected
reason = invalid_payload
```

Важливо: пошкоджений packet **не потрапив у PostgreSQL**.

## 4.5. Надійний спосіб publish у Windows PowerShell

Було зафіксовано правильний спосіб через stdin:

```powershell
$payload | docker exec -i techbaza-mosquitto mosquitto_pub -h localhost -q 1 -t techbaza/devices/TB-ESP32-001/telemetry -l
```

Це усунуло проблему shell-екранування лапок.

## 4.6. Перший успішний end-to-end telemetry test

Було реально отримано:

```text
vfd.frequency_hz = 42.5
pump_running = true
```

Результат ingestion:

```text
status = stored
duplicate = false
```

Після цього дані були доступні через REST API.

---

# 5. API читання telemetry

## 5.1. Current state

```text
GET /api/v1/devices/{device_id}/state
```

Реально підтверджено:

```text
vfd.frequency_hz = 42.5
pump_running = true
```

## 5.2. History

```text
GET /api/v1/devices/{device_id}/telemetry
```

History повертає окремі messages із:

```text
message_id
device_id
sequence
sent_at
received_at
values
state
```

---

# 6. Idempotency — duplicate message protection

MQTT QoS 1 може повторно доставити один і той самий packet.

Тому один callback не можна автоматично вважати новою фізичною подією.

Захист:

```text
message_id UNIQUE
```

Повторне надсилання того самого payload дало:

```text
status = duplicate
duplicate = true
```

Другий history row не створився.

Схема:

```text
same message_id
      ↓
already stored
      ↓
do not insert again
```

---

# 7. Операція 3 — Capability-aware telemetry

## 7.1. Проблема

До цього зареєстрований Device технічно міг би намагатися надсилати будь-які telemetry keys.

Для модульної TechBaza це неправильно.

Система повинна знати:

```text
Який telemetry key прийшов?
        ↓
Яка capability для нього потрібна?
        ↓
Чи активна ця capability на конкретному Device?
```

## 7.2. Policy map

Було введено mapping:

```text
values:

vfd.frequency_hz      → vfd.frequency.read
vfd.current_a         → vfd.current.read
pressure.bar          → pressure.read
water_level.percent   → water_level.read


state:

pump_running          → vfd.state.read
vfd_fault_code        → vfd.state.read
local_mode            → vfd.state.read
emergency_stop        → vfd.state.read
```

## 7.3. Чому vfd.control недостатньо

```text
vfd.control
```

означає можливість керувати VFD.

А читання — це інші capabilities:

```text
vfd.frequency.read
vfd.current.read
vfd.state.read
```

Тому control і read були свідомо розділені.

## 7.4. Capabilities тестового Device

Для `TB-ESP32-001` були створені та призначені:

```text
vfd.control
vfd.frequency.read
vfd.state.read
```

## 7.5. Позитивний тест

Payload:

```text
vfd.frequency_hz = 47.5
pump_running = true
```

Policy:

```text
vfd.frequency_hz → vfd.frequency.read ✅
pump_running     → vfd.state.read ✅
```

Результат:

```text
status = stored
duplicate = false
```

## 7.6. Негативний тест

Було спеціально надіслано:

```text
pressure.bar = 4.3
```

але `TB-ESP32-001` не мав:

```text
pressure.read
```

Backend відповів:

```text
status = rejected
reason = capability_violation
missing_capabilities = ["pressure.read"]
unsupported_keys = []
```

## 7.7. Перевірка БД

Після rejection history містила:

```text
42.5 Hz
47.5 Hz
```

але не містила:

```text
pressure.bar = 4.3
```

Отже capability policy реально працює **до запису в БД**.

---

# 8. Операція 4 — Heartbeat + ONLINE/OFFLINE

## 8.1. Проблема

Телеметрія може не змінюватися довгий час.

Наприклад:

```text
frequency = 47.5 Hz
pump_running = true
```

Немає сенсу щосекунди створювати однакові history rows лише для того, щоб довести, що ESP32 живий.

Тому було введено окремий lightweight heartbeat.

## 8.2. Heartbeat topic

```text
techbaza/devices/+/heartbeat
```

Для тестового контролера:

```text
techbaza/devices/TB-ESP32-001/heartbeat
```

## 8.3. Heartbeat payload

```json
{
  "schema_version": 1,
  "message_id": "UUID",
  "sent_at": "2026-09-24T09:20:57Z",
  "sequence": 10
}
```

## 8.4. Що оновлює heartbeat

Після валідного heartbeat backend оновлює:

```text
devices.last_seen_at
```

## 8.5. Чому online не зберігається як boolean

Погано:

```text
online = true
```

у БД назавжди.

Якщо контролер зникне, це значення може залишитися неправдивим.

Тому online обчислюється:

```text
now - last_seen_at <= timeout
        ↓
      ONLINE
```

і:

```text
now - last_seen_at > timeout
        ↓
      OFFLINE
```

## 8.6. Timeout

Було встановлено:

```text
DEVICE_ONLINE_TIMEOUT_SECONDS = 90
```

## 8.7. Availability API

```text
GET /api/v1/devices/{device_id}/availability
```

Відповідь містить:

```text
device_id
uid
online
last_seen_at
timeout_seconds
seconds_since_seen
```

## 8.8. Реальний ONLINE test

Після heartbeat:

```text
online = true
timeout_seconds = 90
seconds_since_seen ≈ 19.8
```

## 8.9. Реальний OFFLINE test

Після очікування більше 90 секунд:

```text
online = false
timeout_seconds = 90
seconds_since_seen ≈ 192.45
```

OFFLINE стався автоматично, без ручного прапорця.

---

# 9. Важливе розділення станів

Після heartbeat-операції система чітко розділяє:

```text
ONLINE / OFFLINE
→ чи є зв'язок з контролером

pump_running
→ чи працює насос

vfd_fault_code
→ чи є fault VFD

lifecycle_status
→ provisioning / active / maintenance / ...
```

Можливі комбінації:

```text
Controller online + Pump running
Controller online + Pump stopped
Controller online + VFD fault
Controller offline
```

Ці стани не змішуються.

---

# 10. Операція 5 — Stale / Out-of-order protection

## 10.1. Проблема нестабільного 4G

Пакети можуть прийти не в тому порядку, в якому були створені.

Наприклад:

```text
ESP32 створив:

sequence 100 → 50 Hz
sequence 101 → 47 Hz

мережа доставила:

101
100
```

Якщо кожен packet безумовно переписує current state, старий пакет може відкотити систему назад.

## 10.2. Міграція

Було застосовано:

```text
20260924_0003
```

Вона додала:

```text
device_states.last_sequence
```

## 10.3. Ordering metadata

Для snapshot стали використовуватися:

```text
last_sequence
last_reported_at
last_received_at
```

## 10.4. Нове правило

```text
новий message_id
      │
      ├── history → зберегти
      │
      └── ordering policy
              │
       ┌──────┴──────┐
       ↓             ↓
     newer          stale
       ↓             ↓
 update state     history only
```

## 10.5. Позитивний ordering test

Новий packet:

```text
sequence = 100
vfd.frequency_hz = 50.0
pump_running = true
```

Backend:

```text
status = stored
state_updated = true
ordering_reason = newer_sent_at
```

Current state:

```text
last_sequence = 100
frequency = 50
pump_running = true
```

## 10.6. Stale packet test

Після цього було навмисно надіслано інший валідний packet:

```text
message_id = new UUID
sequence = 99
sent_at = приблизно на 5 хвилин старіше
vfd.frequency_hz = 12.5
pump_running = false
```

Backend:

```text
status = stored
duplicate = false
state_updated = false
ordering_reason = older_sent_at
```

## 10.7. Головний результат

History містила обидва пакети:

```text
sequence 100 → 50.0 Hz → true
sequence 99  → 12.5 Hz → false
```

А current state залишився:

```text
sequence 100
50 Hz
pump_running = true
```

Тобто дані не втрачаються, але stale packet не має права зіпсувати snapshot.

---

# 11. sent_at vs received_at

```text
sent_at
→ коли packet сформував контролер

received_at
→ коли packet реально отримав backend
```

Через затримки 4G:

```text
старіший sent_at
```

може мати:

```text
новіший received_at
```

Це нормально.

Для діагностики мережі важливий `received_at`.

Для фізичного процесу часто важливіший `sent_at`.

TechBaza зберігає обидва.

---

# 12. Duplicate vs stale

## Duplicate

```text
same message_id
```

Результат:

```text
history row не створюється
current state не змінюється
```

## Stale

```text
new message_id
але packet старіший
```

Результат:

```text
history row створюється
current state не змінюється
```

Це принципово різні сценарії.

---

# 13. Операція 6 — Reboot / Session Protection

## 13.1. Проблема

Навіть ordering по sequence не вирішує reboot.

Приклад:

```text
до reboot:
sequence = 500

після reboot:
sequence = 0
```

Без додаткового identity сервер не знає, чи `0` — це старий packet, чи новий запуск контролера.

## 13.2. Рішення: session_id

Додано:

```text
session_id
```

Це UUID одного boot ESP32.

Семантика:

```text
message_id
→ конкретний packet

session_id
→ конкретний boot

sequence
→ порядок packets усередині boot
```

## 13.3. Міграція

Було застосовано:

```text
20260924_0004
```

Вона додала:

```text
telemetry_messages.session_id
device_states.last_session_id
```

і індекс:

```text
(device_id, session_id)
```

## 13.4. Legacy → Session A

Перший session-aware packet:

```text
Session A
sequence = 500
vfd.frequency_hz = 55
pump_running = true
```

Backend:

```text
status = stored
state_updated = true
ordering_reason = session_tracking_initialized
```

Current state:

```text
last_session_id = Session A
last_sequence = 500
frequency = 55
pump_running = true
```

## 13.5. Імітація reboot

Після цього було створено нову Session B:

```text
Session B
sequence = 0
vfd.frequency_hz = 25
pump_running = false
```

Backend:

```text
status = stored
state_updated = true
ordering_reason = new_session
```

Тобто:

```text
500 → 0
```

не сприйнято як rollback, тому що `session_id` змінився.

## 13.6. Найважливіший тест: old session reappeared

Після переходу на Session B було спеціально надіслано packet зі старої Session A:

```text
Session A
sequence = 501
vfd.frequency_hz = 60
pump_running = true
sent_at = свіжий
message_id = новий
```

Він спеціально був зроблений "сильнішим":

- новий message_id;
- свіжий sent_at;
- sequence 501 > 500.

Але session була стара.

Backend правильно повернув:

```text
status = stored
duplicate = false
state_updated = false
ordering_reason = old_session_reappeared
```

## 13.7. Фінальна перевірка current state

Snapshot залишився на Session B:

```text
last_session_id = Session B
last_sequence = 0
vfd.frequency_hz = 25
pump_running = false
```

Навіть `last_received_at` current snapshot не був переписаний старою boot-session.

---

# 14. Повний захисний контур після Етапу 4

На кінець Етапу 4 TechBaza вже вміє відрізняти:

```text
invalid JSON
→ rejected

same message_id
→ duplicate

known key but missing capability
→ rejected

valid newer telemetry
→ history + current state

stale packet
→ history only

new boot session
→ accepted as current

old boot session reappears
→ history only

heartbeat timeout
→ offline
```

---

# 15. Підсумкова IoT architecture після Етапу 4

```text
                     ESP32
                       │
        ┌──────────────┴──────────────┐
        │                             │
     telemetry                     heartbeat
        │                             │
        ▼                             ▼
                    MQTT / Mosquitto
                           │
                           ▼
                        Backend
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
   validation         capabilities        presence
        │                  │                  │
        └──────────────┬───┘                  │
                       ▼                      ▼
                  ordering              last_seen_at
                       │                      │
          ┌────────────┴────────────┐         ▼
          ▼                         ▼     online/offline
  telemetry_messages           device_states
      history                    current
```

---

# 16. PostgreSQL migrations Етапу 4

Етап 4 пройшов через три ключові міграції:

```text
20260924_0002
→ telemetry_messages + device_states

20260924_0003
→ last_sequence / ordering metadata

20260924_0004
→ session_id / last_session_id
```

Логічна межа Етапу 4 — саме `20260924_0004`.

Наступна command migration уже належить до Етапу 5.

---

# 17. Основні MQTT topics

Telemetry:

```text
techbaza/devices/{device_uid}/telemetry
```

Heartbeat:

```text
techbaza/devices/{device_uid}/heartbeat
```

Підписки backend:

```text
techbaza/devices/+/telemetry
techbaza/devices/+/heartbeat
```

---

# 18. Основні API endpoints Етапу 4

Health:

```text
GET /health
GET /health/db
GET /health/mqtt
```

MQTT diagnostics:

```text
GET /mqtt/last
GET /mqtt/ingestion/last
GET /mqtt/heartbeat/last
```

Device telemetry:

```text
GET /api/v1/devices/{device_id}/state
GET /api/v1/devices/{device_id}/telemetry
GET /api/v1/devices/{device_id}/availability
```

Capabilities:

```text
GET  /api/v1/capabilities
POST /api/v1/capabilities

GET  /api/v1/devices/{device_id}/capabilities
POST /api/v1/devices/{device_id}/capabilities/{capability_id}
```

---

# 19. Основні файли реалізації

Telemetry:

```text
backend/app/models/telemetry.py
backend/app/schemas/telemetry.py
backend/app/repositories/telemetry.py
backend/app/services/telemetry.py
backend/app/api/v1/telemetry.py
```

Capability-aware policy:

```text
backend/app/services/telemetry_policy.py
backend/app/repositories/capabilities.py
```

Presence:

```text
backend/app/schemas/heartbeat.py
backend/app/schemas/availability.py
backend/app/services/device_presence.py
backend/app/api/v1/devices.py
```

Ordering:

```text
backend/app/services/telemetry_ordering.py
```

MQTT integration:

```text
backend/app/mqtt_client.py
```

Migrations:

```text
backend/alembic/versions/20260924_0002_telemetry_core.py
backend/alembic/versions/20260924_0003_telemetry_ordering.py
backend/alembic/versions/20260924_0004_telemetry_sessions.py
```

---

# 20. Технічна документація, створена під час Етапу 4

```text
docs/telemetry-contract-v1.md
docs/telemetry-ingestion-local-test.md
docs/telemetry-capability-policy-v1.md
docs/device-presence-v1.md
docs/telemetry-ordering-v1.md
docs/telemetry-session-protection-v1.md
```

Ці файли є деталізованими технічними специфікаціями окремих частин цього досьє.

---

# 21. Матриця перевірених сценаріїв

```text
MQTT broker connected                         ✅
backend subscribed to telemetry              ✅
backend subscribed to heartbeat              ✅

valid JSON → stored                          ✅
invalid JSON → rejected                      ✅

valid Device UID                             ✅
capability allowed → stored                  ✅
capability missing → rejected                ✅
rejected payload absent in DB                ✅

same message_id → duplicate                  ✅
duplicate row not created                    ✅

heartbeat accepted                           ✅
last_seen_at updated                         ✅
online after heartbeat                       ✅
offline after timeout                        ✅

new telemetry updates state                  ✅
stale telemetry stored in history            ✅
stale telemetry does not rollback state      ✅

legacy → session-aware transition            ✅
new session after reboot accepted            ✅
old session reappeared → history only        ✅
current state protected from old session     ✅
```

---

# 22. Що принципово НЕ входить у Етап 4

Етап 4 завершив **incoming IoT data path** і reliability layer.

Навмисно не входять:

- command queue;
- Backend → MQTT command publishing;
- ESP32 command ACK;
- command result;
- command expiry/retry;
- Modbus command execution;
- реальний pump START/STOP через backend;
- users / RBAC;
- production auth;
- production MQTT TLS/ACL.

Це вже наступний етап.

---

# 23. Межа між Етапом 4 і Етапом 5

Етап 4 закінчується на схемі:

```text
ESP32
  ↓
MQTT
  ↓
Backend
  ↓
PostgreSQL / API
```

Тобто контролер уже **надійно повідомляє** серверу свій стан.

Етап 5 починається зі зворотного каналу:

```text
API / UI
   ↓
Backend
   ↓
durable command
   ↓
MQTT
   ↓
ESP32
   ↓
VFD
```

Першою операцією Етапу 5 є:

**Операція 1 — Durable Command Queue**

Її задача:

```text
POST command
   ↓
validate Device
   ↓
validate capability
   ↓
create command_id
   ↓
store in PostgreSQL
   ↓
status = queued
```

MQTT publish та ACK ідуть уже наступними операціями Етапу 5.

---

# 24. Підсумок Етапу 4

Етап 4 завершив повний telemetry/reliability фундамент TechBaza.

Система вже вміє:

- приймати MQTT telemetry;
- валідовувати контракт;
- перевіряти Device UID;
- перевіряти DeviceCapability;
- відкидати неправильні дані;
- захищатися від duplicate;
- зберігати history;
- підтримувати current state;
- визначати ONLINE/OFFLINE;
- переживати затримки 4G;
- не відкотити snapshot stale packet-ом;
- переживати reboot ESP32;
- відрізняти новий boot від старої session;
- зберігати запізнілі дані без псування актуального стану.

Це завершений **incoming IoT data + reliability layer**.

**V3.5 — Етап 4 завершено.**

Наступний етап:

**V3.5 — Етап 5. Remote Command Channel**

Початок:

**Операція 1 — Durable Command Queue.**

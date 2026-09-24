# Досьє V3.5 — Етап 5
## Remote Command Core: durable commands, MQTT delivery, ACK/Result та reliability

**Статус:** завершено  
**Версія:** V3.5  
**Етап:** 5  
**Завершено:** Операції 1–6  
**Межі етапу:** від першої durable-команди після завершення telemetry/reliability фундаменту Етапу 4 до повного end-to-end command lifecycle  
**Мета етапу:** побудувати надійний зворотний канал керування від API до Device, у якому команда не губиться, має чіткий lifecycle, TTL, idempotency, MQTT delivery, ACK, фінальний Result та контрольований retry.

---

# 1. Що було на старті Етапу 5

Після Етапу 4 система вже вміла:

```text
ESP32
  ↓
MQTT telemetry / heartbeat
  ↓
Backend
  ↓
PostgreSQL
```

і мала:

- Device registry;
- capabilities;
- telemetry history;
- current state;
- heartbeat;
- online/offline;
- stale/out-of-order protection;
- reboot/session protection.

Але керування працювало лише в одному напрямку:

```text
Device → Backend
```

Для реального продукту цього недостатньо.

Потрібен зворотний канал:

```text
UI / API
   ↓
Backend
   ↓
MQTT
   ↓
ESP32
   ↓
RS485 / Modbus
   ↓
VFD
```

Головна задача Етапу 5 — зробити цей канал не просто функціональним, а **durable, idempotent і безпечним для нестабільної мобільної мережі**.

---

# 2. Карта операцій Етапу 5

Етап 5 розбитий на шість операцій:

```text
Операція 1
Durable Command Queue
        ↓
Операція 2
MQTT Command Publisher
        ↓
Операція 3
Command ACK
        ↓
Операція 4
Command Result
        ↓
Операція 5
Command Reliability
        ↓
Операція 6
End-to-End Command Test
```

Поточний стан:

```text
Операція 1  ✅
Операція 2  ✅
Операція 3  ✅
Операція 4  ✅
Операція 5  ✅
Операція 6  ✅
```

---

# 3. Загальна архітектура command channel

Після Операцій 1–5 командний контур виглядає так:

```text
Client / UI
    │
    │ HTTP POST
    ▼
FastAPI
    │
    │ validation + capability check
    ▼
PostgreSQL
device_commands
    │
    │ durable record
    ▼
Command Dispatch
    │
    ├── Device offline → queued
    │
    ├── TTL expired   → expired
    │
    └── Device online
            │
            ▼
        MQTT broker
            │
            ▼
           ESP32
            │
            ├── ACK
            │    ↓
            │ acknowledged
            │
            └── Result
                 ↓
          succeeded / failed
```

Ключовий принцип:

```text
PostgreSQL = source of truth
MQTT       = transport
```

Команда спочатку існує як durable record у БД і лише потім намагається піти в MQTT.

---

# 4. Операція 1 — Durable Command Queue

## 4.1. Завдання

До цієї операції command існувала б лише як короткоживучий network request.

Це небезпечно:

```text
HTTP request
   ↓
backend
   ↓
MQTT unavailable
   ↓
command lost
```

Тому було введено durable command storage.

## 4.2. Таблиця device_commands

Команди зберігаються в:

```text
device_commands
```

Основні поля:

```text
id
request_id
device_id
command_type
payload
status

ttl_seconds
expires_at

published_at
acknowledged_at
completed_at

result
error_code
error_message

created_at
updated_at
```

Пізніше Reliability додав:

```text
publish_attempts
last_publish_attempt_at
last_publish_error
```

## 4.3. Початкові command types

На V3.5 введені:

```text
vfd.start
vfd.stop
vfd.frequency.set
```

Для них потрібна capability:

```text
vfd.control
```

## 4.4. API

Створення command:

```text
POST /api/v1/devices/{device_id}/commands
```

Перелік commands конкретного Device:

```text
GET /api/v1/devices/{device_id}/commands
```

Одна command:

```text
GET /api/v1/commands/{command_id}
```

## 4.5. HTTP idempotency

Клієнт передає:

```text
request_id
```

Його сенс:

```text
користувач натиснув кнопку
        ↓
клієнт створив request_id
        ↓
POST timeout
        ↓
клієнт повторив POST
        ↓
нова фізична command НЕ створюється
```

Перевірено:

```text
new request_id + 45 Hz
→ 201 Created ✅

same request_id + same payload
→ 200 OK
→ той самий command_id ✅

same request_id + інший payload
→ 409 Conflict ✅
```

## 4.6. Payload validation

Для:

```text
vfd.frequency.set
```

payload має містити лише:

```json
{
  "frequency_hz": 45
}
```

Поточний protocol guardrail:

```text
0..100 Hz
```

Перевірено:

```text
150 Hz
→ 422 Unprocessable Content
→ command у БД не створена ✅
```

Реальні min/max конкретного VFD мають надалі задаватися конфігурацією Device, а не глобальним числом.

---

# 5. TTL як частина command contract

Remote command не повинна жити нескінченно.

Було введено:

```text
ttl_seconds
expires_at
```

Допустимий TTL:

```text
5..300 s
```

Default:

```text
30 s
```

Навіщо:

```text
користувач дав START
        ↓
4G зник
        ↓
минуло багато часу
        ↓
зв'язок повернувся
        ↓
стара START НЕ повинна раптово виконатися
```

На V3.5 TTL означає deadline, до якого Device має **прийняти command**.

---

# 6. Операція 2 — MQTT Command Publisher

## 6.1. Topic

Backend публікує command у:

```text
techbaza/devices/{device_uid}/commands
```

Для тестового Device:

```text
techbaza/devices/TB-ESP32-001/commands
```

## 6.2. CommandEnvelope v1

Приклад:

```json
{
  "schema_version": 1,
  "command_id": "UUID",
  "request_id": "UUID",
  "issued_at": "2026-09-24T11:00:00Z",
  "expires_at": "2026-09-24T11:05:00Z",
  "ttl_seconds": 300,
  "command_type": "vfd.frequency.set",
  "payload": {
    "frequency_hz": 40
  }
}
```

## 6.3. QoS та retain

Зафіксовано:

```text
QoS = 1
retain = false
```

### Чому QoS 1

QoS 1 означає:

```text
at least once
```

Тобто message може бути доставлена повторно.

Це нормально, якщо Device дедуплікує command за:

```text
command_id
```

### Чому retain=false

Remote command не повинна залишатися на broker як retained message.

Небезпечний сценарій:

```text
старий START
  ↓
retain=true
  ↓
ESP32 був offline
  ↓
підключився через годину
  ↓
отримав старий START
```

Тому:

```text
retain=false
```

є safety-рішенням.

## 6.4. Реальні перевірки

Перевірено:

```text
POST command → published                         ✅
published_at set                                 ✅
mosquitto_sub реально отримав CommandEnvelope    ✅
QoS 1                                            ✅
retain=false                                     ✅
HTTP retry не створив повторний MQTT publish     ✅
новий subscriber не отримав стару command        ✅
```

---

# 7. Операція 3 — Command ACK

## 7.1. Навіщо окремий ACK

Після MQTT publish backend знає лише:

```text
broker прийняв message
```

Але ще не знає:

```text
ESP32 реально отримав command
```

Тому Device відповідає ACK.

## 7.2. ACK topic

```text
techbaza/devices/{device_uid}/commands/ack
```

Backend слухає:

```text
techbaza/devices/+/commands/ack
```

## 7.3. ACK payload

```json
{
  "schema_version": 1,
  "message_id": "UUID",
  "command_id": "UUID",
  "session_id": "UUID",
  "sent_at": "2026-09-24T12:00:00Z"
}
```

## 7.4. Lifecycle

```text
published
   ↓ ACK
acknowledged
```

Після ACK:

```text
acknowledged_at = server UTC time
```

## 7.5. ACK не означає виконання

Це принципово:

```text
ACK
→ Device отримав command

НЕ:
→ VFD уже виконав command
```

Між ними може бути:

- Modbus write;
- local interlock;
- VFD fault;
- аварійний стоп;
- safety rejection.

## 7.6. Перевірені ACK-сценарії

```text
published → ACK → acknowledged               ✅
acknowledged_at записано                     ✅
completed_at лишився null                    ✅

duplicate ACK
→ duplicate=true                             ✅
→ command_updated=false                      ✅
→ acknowledged_at не переписано              ✅

unknown command_id
→ rejected                                   ✅
→ reason=unknown_command                     ✅
```

---

# 8. Операція 4 — Command Result

## 8.1. Призначення

Command Result означає:

```text
Device завершив локальне виконання command
```

Він окремий від ACK.

## 8.2. Result topic

```text
techbaza/devices/{device_uid}/commands/result
```

Backend слухає:

```text
techbaza/devices/+/commands/result
```

## 8.3. Success Result

```json
{
  "schema_version": 1,
  "message_id": "UUID",
  "command_id": "UUID",
  "session_id": "UUID",
  "sent_at": "2026-09-24T12:10:00Z",
  "status": "succeeded",
  "result": {
    "frequency_hz": 30
  },
  "error_code": null,
  "error_message": null
}
```

## 8.4. Failed Result

```json
{
  "schema_version": 1,
  "message_id": "UUID",
  "command_id": "UUID",
  "session_id": "UUID",
  "sent_at": "2026-09-24T12:10:00Z",
  "status": "failed",
  "result": {},
  "error_code": "modbus_write_failed",
  "error_message": "VFD did not confirm register write"
}
```

## 8.5. Lifecycle

Успіх:

```text
published
  ↓
acknowledged
  ↓
succeeded
```

Помилка:

```text
published
  ↓
acknowledged
  ↓
failed
```

## 8.6. Terminal state

Після:

```text
succeeded
failed
```

command є terminal.

Тобто:

```text
completed_at != null
```

## 8.7. Перевірені Result-сценарії

```text
acknowledged → succeeded                                  ✅
result.frequency_hz збережено                             ✅
completed_at записано                                     ✅

duplicate Result
→ duplicate=true                                          ✅
→ command_updated=false                                   ✅
→ completed_at не переписано                              ✅

succeeded → conflicting failed
→ rejected                                                ✅
→ terminal_result_conflict                                ✅

acknowledged → failed                                     ✅
error_code=modbus_write_failed                            ✅
error_message збережено                                   ✅

failed без error_code
→ rejected                                                ✅
→ invalid_payload                                         ✅
```

## 8.8. Примітка про PowerShell UTF-8

Під час локального тесту Windows PowerShell pipe через:

```text
docker exec
```

може пошкоджувати non-ASCII текст.

Через це український `error_message` у тесті відобразився як знаки питання.

Це зафіксовано як особливість console test path, а не як зміна MQTT/JSON contract.

---

# 9. Операція 5 — Command Reliability

Операція 5 перетворила command channel із простої доставки на стійкий transport layer.

## 9.1. Головна модель

```text
at-least-once delivery
+
command_id deduplication
+
durable PostgreSQL lifecycle
```

Система не намагається імітувати магічний network-level:

```text
exactly once
```

Натомість гарантія будується правильно:

```text
можливий retry
   +
той самий command_id
   +
Device-side deduplication
```

---

# 10. Delivery metadata

До `device_commands` додані:

```text
publish_attempts
last_publish_attempt_at
last_publish_error
```

Міграція:

```text
20260924_0007
```

Приклад:

```text
publish_attempts = 16
```

означає, що backend зробив 16 delivery attempts однієї й тієї самої durable command.

Це не 16 фізичних команд.

---

# 11. Reliability worker

Backend 0.17.0 отримав lightweight worker.

Default settings:

```text
poll interval  = 2 s
retry interval = 10 s
batch size     = 100
```

Worker переглядає:

```text
queued
published
```

і може:

- expire command;
- опублікувати queued command;
- повторити published command без ACK;
- пропустити Device offline;
- припинити роботу з acknowledged/succeeded/failed.

Diagnostics:

```text
GET /command/reliability/status
```

Перевірено:

```text
running = true
poll_seconds = 2
batch_size = 100
```

---

# 12. Offline Device gating

Перед MQTT publish backend перевіряє availability Device.

Якщо:

```text
online = false
```

то:

```text
command = queued
MQTT publish = НЕ виконується
```

Перевірено реально:

```text
Device online=false                         ✅
POST while offline                          ✅
status=queued                               ✅
published_at=null                           ✅
publish_attempts=0                          ✅
worker reason=device_offline                ✅
```

---

# 13. Offline command → TTL expired

Було залишено queued command при offline Device.

Після завершення TTL worker перевів її в:

```text
status = expired
completed_at = server time
error_code = command_expired
```

Перевірено:

```text
queued
  ↓
TTL elapsed
  ↓
expired ✅
```

Стара command не була опублікована після deadline.

---

# 14. Offline → Online → Automatic Publish

Було створено command:

```text
status = queued
publish_attempts = 0
```

Потім Device отримав heartbeat:

```text
online = true
```

Без нового POST worker сам зробив:

```text
queued
  ↓
published
```

MQTT subscriber реально отримав:

```text
той самий command_id
той самий payload
```

Це доводить, що pending command не залежить від повторної дії користувача.

---

# 15. Lost ACK retry

Якщо command вже:

```text
published
```

але ACK не прийшов, worker через retry interval повторює:

```text
той самий CommandEnvelope
з тим самим command_id
```

У реальному тесті:

```text
publish_attempts
1 → 2 → ... → 9
```

а MQTT subscriber бачив повторні доставки одного command_id.

Це очікувана поведінка QoS 1 / at-least-once системи.

---

# 16. ACK stops retry

Після ACK:

```text
status = acknowledged
```

worker перестає розглядати command як retry candidate.

Перевірено:

```text
publish_attempts = 9
ACK
wait
publish_attempts = 9 ✅
```

Окремо після broker recovery:

```text
publish_attempts = 16
ACK
wait
publish_attempts = 16 ✅
```

---

# 17. Late ACK protection

Було спеціально відправлено ACK для command, яка вже:

```text
status = expired
```

Backend відповів:

```text
status = rejected
reason = command_expired
```

Тобто late ACK не може оживити стару command.

---

# 18. Result без ACK

Можливий network scenario:

```text
command delivered
   ↓
ACK lost
   ↓
Device executed
   ↓
Result delivered
```

Backend допускає:

```text
published
   ↓ Result
succeeded / failed
```

якщо Result прийшов до deadline.

Перевірено:

```text
status до Result = published
acknowledged_at = null

Result succeeded
        ↓

status = succeeded ✅
acknowledged_at = auto-filled ✅
completed_at = filled ✅
```

Фінальний Result є сильнішим доказом того, що Device command отримав.

---

# 19. Late Result protection

Було відправлено `succeeded` для вже expired command.

Backend правильно повернув:

```text
status = rejected
reason = command_expired
```

Отже final Result також не може оживити прострочену command.

---

# 20. MQTT broker outage

Перевірено окремий сценарій:

```text
Device online
MQTT broker offline
```

Після POST backend зробив delivery attempt, але не втратив command:

```text
status = queued
publish_attempts = 1
published_at = null
last_publish_attempt_at = filled
last_publish_error = mqtt_not_connected
```

Це принципово відрізняється від:

```text
Device offline
```

де MQTT publish взагалі не виконується і:

```text
publish_attempts = 0
```

---

# 21. Broker recovery

Після:

```text
docker compose start mosquitto
```

та нового heartbeat:

```text
broker connected
Device online
```

worker сам повторив queued command.

MQTT subscriber реально отримав її.

У БД:

```text
status = published
published_at = filled
publish_attempts > 1
last_publish_error = null
```

Тобто command пережила broker outage і була доставлена без нового HTTP POST.

---

# 22. Race-condition protection

Command lifecycle може одночасно змінюватися кількома подіями:

```text
reliability worker retry
ACK
Result
expiry
```

Щоб вони не переписали одну command у суперечливому порядку, transitions використовують PostgreSQL row-level locking:

```text
SELECT ... FOR UPDATE
```

Це серіалізує конкурентні зміни одного `device_commands` row.

---

# 23. Command lifecycle після Операції 5

Фактичний lifecycle:

```text
                     ┌──────────────┐
                     │    queued    │
                     └──────┬───────┘
                            │
                  Device online + MQTT
                            │
                            ▼
                     ┌──────────────┐
                     │  published   │
                     └──────┬───────┘
                            │
                 ┌──────────┴──────────┐
                 │                     │
                ACK                  Result
                 │                     │
                 ▼                     │
          ┌──────────────┐             │
          │ acknowledged │─────────────┤
          └──────┬───────┘             │
                 │                     │
                 ▼                     ▼
        ┌──────────────┐       ┌──────────────┐
        │  succeeded   │       │    failed    │
        └──────────────┘       └──────────────┘

queued/published + TTL elapsed
              ↓
        ┌──────────────┐
        │   expired    │
        └──────────────┘
```

Terminal states:

```text
succeeded
failed
expired
```

---

# 24. Стани і їх значення

## queued

Command збережена у PostgreSQL, але ще не підтверджено успішний MQTT publish.

Причини:

- Device offline;
- MQTT unavailable;
- command щойно створена.

## published

Broker прийняв CommandEnvelope.

Це ще не доказ, що Device її отримав.

## acknowledged

Device підтвердив отримання command.

Це ще не обов'язково означає фізичне виконання.

## succeeded

Device повідомив успішне завершення.

## failed

Device завершив command помилкою.

## expired

Deadline завершився до допустимого прийняття command.

---

# 25. Повний захисний контур Remote Command Core

Після Операцій 1–5 система вже захищена від:

```text
duplicate HTTP POST                         ✅
same request_id with conflicting payload    ✅
invalid frequency payload                   ✅
unsupported capability                      ✅
MQTT duplicate delivery                     ✅
retained remote command                     ✅
duplicate ACK                               ✅
unknown ACK command_id                      ✅
duplicate Result                            ✅
conflicting terminal Result                 ✅
failed Result without error_code             ✅
offline Device                              ✅
lost ACK                                    ✅
TTL expiry                                  ✅
late ACK                                    ✅
Result without ACK                          ✅
late Result                                 ✅
MQTT broker outage                          ✅
broker recovery                             ✅
concurrent lifecycle race                   ✅
```

---

# 26. Що важливо для фізичного ESP32

Backend уже реалізує server-side contract.

Production ESP32 повинен дотримуватися тих самих правил.

## 26.1. command_id deduplication

Перед фізичною дією:

```text
command_id already processed?
        │
     yes│      no
        │       │
        ▼       ▼
   do not run   execute
   again        once
```

MQTT retry не повинен означати повторний запуск насоса або повторний Modbus write як нову дію.

## 26.2. expires_at check

Перед фізичною дією ESP32 також має перевіряти:

```text
now < expires_at
```

Backend TTL недостатньо вважати єдиним safety barrier.

## 26.3. ACK before Result

Нормальний flow:

```text
receive command
   ↓
ACK
   ↓
local execution
   ↓
Result
```

Але backend стійкий і до втрати ACK.

## 26.4. Local safety remains authoritative

Remote command не має права обходити:

- emergency stop;
- dry-run protection;
- VFD fault;
- local/manual mode;
- pressure/water safety logic;
- hardware interlocks.

Backend просить виконати дію.

Edge вирішує, чи її безпечно виконати.

---

# 27. Backend version timeline Етапу 5

Під час етапу backend послідовно розширювався:

```text
0.13.0
Durable Command Core

0.14.0
MQTT Command Publisher

0.15.0
Command ACK

0.16.0
Command Result

0.17.0
Command Reliability
```

---

# 28. Міграції Етапу 5

На початку етапу були застосовані command migrations:

```text
20260924_0005
→ базова черга command

20260924_0006
→ idempotency / TTL metadata

20260924_0007
→ delivery reliability metadata
```

Остання migration додала:

```text
publish_attempts
last_publish_attempt_at
last_publish_error
```

---

# 29. MQTT topics Етапу 5

Повний command namespace:

```text
Backend → Device

techbaza/devices/{device_uid}/commands


Device → Backend

techbaza/devices/{device_uid}/commands/ack

techbaza/devices/{device_uid}/commands/result
```

Разом із Етапом 4:

```text
telemetry
heartbeat
commands
commands/ack
commands/result
```

формують базовий двосторонній IoT protocol TechBaza.

---

# 30. API та diagnostics

Основний command API:

```text
POST /api/v1/devices/{device_id}/commands

GET /api/v1/devices/{device_id}/commands

GET /api/v1/commands/{command_id}
```

MQTT diagnostics:

```text
GET /mqtt/command/last

GET /mqtt/command/ack/last

GET /mqtt/command/result/last
```

Reliability diagnostics:

```text
GET /command/reliability/status
```

Device presence:

```text
GET /api/v1/devices/{device_id}/availability
```

---

# 31. Що реально перевірено вручну

Усі нижче наведені сценарії були перевірені локально через:

- Swagger;
- PowerShell;
- Mosquitto CLI;
- PostgreSQL;
- REST API;
- Docker Compose.

Підтверджено:

```text
1.  New command created                                   ✅
2.  HTTP idempotency                                     ✅
3.  request_id conflict                                  ✅
4.  payload range validation                             ✅
5.  PostgreSQL durable row                               ✅
6.  MQTT publish                                         ✅
7.  QoS 1                                                ✅
8.  retain=false                                         ✅
9.  ACK accepted                                         ✅
10. duplicate ACK                                        ✅
11. unknown ACK                                          ✅
12. success Result                                       ✅
13. duplicate Result                                     ✅
14. terminal Result conflict                             ✅
15. failed Result                                        ✅
16. invalid failed Result                                ✅
17. Device offline → queued                              ✅
18. queued → expired                                     ✅
19. heartbeat → online                                   ✅
20. queued → automatic publish                           ✅
21. lost ACK → repeated same command_id                  ✅
22. ACK stops retry                                      ✅
23. late ACK rejected                                    ✅
24. Result without ACK accepted                          ✅
25. late Result rejected                                 ✅
26. MQTT broker unavailable                              ✅
27. publish error = mqtt_not_connected                   ✅
28. broker recovery                                      ✅
29. old queued command automatically delivered           ✅
30. last_publish_error cleared after recovery             ✅
31. ACK after broker recovery stops further retry         ✅
32. Повний End-to-End lifecycle                            ✅
```

---

# 32. Важливі знайдені нюанси під час тестів

## 32.1. Device online timeout

Поточний timeout:

```text
90 seconds
```

Тому одиночний manual heartbeat переводить Device online лише тимчасово.

У production ESP32 heartbeat повинен іти регулярно.

## 32.2. Високий publish_attempts у ручних тестах

Під час ручного тестування людина може витратити хвилини між кроками.

Worker у цей час продовжує retry.

Тому значення:

```text
publish_attempts = 9
publish_attempts = 16
```

не означають 9 або 16 різних команд.

Це retry одного `command_id`.

## 32.3. Exactly-once не гарантується мережею

Можливий failure window:

```text
MQTT publish success
        ↓
backend crash before DB commit
```

Тому правильна production model:

```text
at-least-once transport
+
idempotency
+
edge deduplication
```

---

# 33. Відомі production limitations

Поточний Reliability worker працює:

```text
inside backend process
```

Для V3.5/local deployment це прийнятно.

Для horizontal scaling:

```text
backend instance A
backend instance B
backend instance C
```

потрібен окремий механізм:

- dedicated worker;
- outbox architecture;
- distributed coordination;
- або інша production queue strategy.

Це відоме й задокументоване обмеження.

---

# 34. Операція 6 — End-to-End Command Test

Операція 6 завершила Етап 5 одним повним контрольованим проходом command lifecycle.

Фактичний тест:

```text
POST /api/v1/devices/{device_id}/commands
   ↓
device_commands
   ↓
queued
   ↓
Device simulator heartbeat
   ↓
Device online
   ↓
Reliability worker
   ↓
MQTT command
   ↓
Device simulator
   ↓
ACK
   ↓
Command Result
   ↓
succeeded
   ↓
GET /api/v1/commands/{command_id}
```

Контрольні дані:

```text
Device UID: TB-ESP32-001
command_id: ad55d377-0468-41b6-a4e3-5e1e3a0ab1b0
command_type: vfd.frequency.set
frequency_hz: 37
ttl_seconds: 300
```

Device simulator підтвердив:

```text
[START]                                      ✅
[READY] subscribed to commands              ✅
[HEARTBEAT] Device online                   ✅
[RECEIVED] frequency_hz=37                  ✅
[ACK]                                       ✅
[RESULT] status=succeeded                   ✅
```

Фінальний Command API повернув:

```text
status = succeeded                          ✅
published_at != null                        ✅
publish_attempts = 1                        ✅
last_publish_error = null                   ✅
acknowledged_at != null                     ✅
completed_at != null                        ✅
result.frequency_hz = 37                    ✅
error_code = null                           ✅
error_message = null                        ✅
```

Під час підготовки simulator додатково виявлено та усунено два тестові дефекти:

1. блокуюче очікування MQTT PUBACK усередині callback thread могло створювати timeout/deadlock;
2. один heartbeat на старті simulator міг застаріти під час ручного Swagger-тесту при online timeout 90 секунд.

Фінальна версія simulator:

- не блокує MQTT callback thread;
- публікує ACK/Result з main thread;
- підтримує періодичний heartbeat;
- перевіряє expires_at;
- дедуплікує фізичне виконання за command_id.

Документ: docs/end-to-end-command-test-v1.md

---

# 35. Definition of Done — виконано

Вже виконано:

```text
Durable queue                    ✅
HTTP idempotency                 ✅
MQTT publish                     ✅
ACK                              ✅
Result                           ✅
succeeded / failed               ✅
TTL / expired                    ✅
offline gating                   ✅
lost ACK retry                   ✅
broker outage recovery           ✅
race protection                  ✅
audit/delivery metadata          ✅
```

Фінальний E2E command test також виконано:

```text
one repeatable E2E command test  ✅
```

Отже:

```text
Етап 5 — Remote Command Core
→ завершено ✅
```

---

# 36. Фінальний результат Етапу 5

До Етапу 5 TechBaza в основному вміла **спостерігати** за Device.

Після Операцій 1–6 платформа вміє **надійно керувати** Device на server-side рівні:

```text
користувач створює command
        ↓
command гарантовано зберігається
        ↓
backend вирішує, коли її можна доставити
        ↓
MQTT переносить її на Device
        ↓
Device підтверджує прийняття
        ↓
Device повідомляє результат
        ↓
backend має повний audit lifecycle
```

Це вже не «кнопка, яка просто відправляє MQTT».

Це command-processing subsystem з:

- durable storage;
- lifecycle;
- idempotency;
- TTL;
- retries;
- delivery diagnostics;
- acknowledgement;
- final result;
- offline gating;
- broker recovery;
- concurrency protection.

Саме на цьому фундаменті можна далі будувати реальне керування ESP32 → RS485 → Modbus → VFD.

---

# 37. Фінальний E2E test

```text
command_id = ad55d377-0468-41b6-a4e3-5e1e3a0ab1b0
frequency_hz = 37
status = succeeded
publish_attempts = 1
last_publish_error = null
acknowledged_at != null
completed_at != null
result.frequency_hz = 37
error_code = null
error_message = null
```

# 38. Пов'язані документи

- [Етап 5 — робочий журнал](stage-5-remote-command-core.md)
- [Command Core v1](command-core-v1.md)
- [MQTT Command Protocol v1](mqtt-command-protocol-v1.md)
- [MQTT Command ACK Protocol v1](mqtt-command-ack-v1.md)
- [MQTT Command Result Protocol v1](mqtt-command-result-v1.md)
- [Command Reliability v1](command-reliability-v1.md)
- [End-to-End Command Test v1](end-to-end-command-test-v1.md)
- [Досьє Етапу 4](dossier-v3.5-stage-4-iot-telemetry-reliability.md)

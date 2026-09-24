# Досьє V3.5 — Етап 4
## Telemetry Core: MQTT ingestion, історія, current state та capability-aware processing

**Статус:** завершено  
**Версія:** V3.5  
**Етап:** 4  
**Мета етапу:** перетворити TechBaza з системи, яка лише знає структуру Organization → Site → Device → Capability, на систему, яка реально приймає телеметрію від контролера, перевіряє її, зберігає історію та формує поточний стан пристрою.

---

# 1. Підсумок етапу

На Етапі 4 було реалізовано перший повний telemetry pipeline:

```text
ESP32 / тестовий publisher
        ↓ MQTT
Mosquitto
        ↓
FastAPI backend
        ↓
JSON / Pydantic validation
        ↓
Device UID validation
        ↓
Capability-aware policy
        ↓
PostgreSQL
   ├── telemetry_messages
   └── device_states
        ↓
REST API
```

Фактично TechBaza вперше почала працювати не лише з конфігурацією пристрою, а й з його реальними даними.

---

# 2. Що було додано в PostgreSQL

Міграція:

```text
20260924_0002
```

додала дві ключові таблиці:

```text
telemetry_messages
device_states
```

Після міграції база містила:

```text
alembic_version
capabilities
device_capabilities
device_states
devices
organizations
sites
telemetry_messages
```

## telemetry_messages

Це append-only історія валідної телеметрії.

Один рядок = один MQTT telemetry message.

Основні поля:

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

## device_states

Це current snapshot — останній відомий актуальний стан Device.

Основні поля:

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

---

# 3. Чому історія і current state розділені

Для IoT це принципово різні задачі.

```text
telemetry_messages
→ що реально надходило від контролера у часі

device_states
→ що система вважає актуальним станом зараз
```

Це дозволяє одночасно:

- будувати графіки;
- аналізувати аварії;
- бачити останній стан;
- не сканувати всю історію для кожного відкриття UI.

---

# 4. MQTT topic для телеметрії

Backend підписаний на:

```text
techbaza/devices/+/telemetry
```

Для тестового контролера:

```text
techbaza/devices/TB-ESP32-001/telemetry
```

Символ `+` означає один wildcard-рівень MQTT.

Тому один backend може приймати:

```text
techbaza/devices/TB-ESP32-001/telemetry
techbaza/devices/TB-ESP32-002/telemetry
techbaza/devices/TB-ESP32-003/telemetry
...
```

без створення окремої підписки для кожного пристрою.

---

# 5. Telemetry Contract v1

Тестовий payload:

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

## schema_version

Версія контракту.

Потрібна для майбутньої еволюції firmware/backend без хаотичного ламання формату.

## message_id

Унікальний UUID конкретного повідомлення.

Використовується для idempotency.

## sent_at

Час, коли контролер сформував пакет.

## sequence

Локальний номер повідомлення.

На цьому етапі використовувався як діагностична ознака; повний ordering був реалізований на наступному етапі.

## values

Числові/вимірювані параметри.

Приклад:

```json
{
  "vfd.frequency_hz": 42.5
}
```

## state

Дискретні стани.

Приклад:

```json
{
  "pump_running": true
}
```

---

# 6. Backend ingestion

Ланцюг обробки повідомлення:

```text
MQTT message
    ↓
topic parsing
    ↓
device_uid
    ↓
JSON decode
    ↓
Pydantic TelemetryEnvelope
    ↓
Device lookup
    ↓
message_id duplicate check
    ↓
Capability policy
    ↓
transaction
    ├── insert telemetry_messages
    ├── upsert device_states
    └── update Device.last_seen_at
```

Усі критичні записи виконуються в рамках контрольованої SQLAlchemy transaction.

---

# 7. Валідація payload

Backend не довіряє вхідному MQTT payload.

Перевіряються:

- JSON syntax;
- schema version;
- UUID message_id;
- timestamp timezone;
- sequence >= 0;
- структура values/state;
- допустимість невідомих полів контракту.

Невалідний payload не потрапляє у PostgreSQL.

---

# 8. Реально перевірений broken JSON

Під час локального тесту Windows PowerShell + `docker exec ... mosquitto_pub -m` прибрав подвійні лапки з JSON.

Backend реально отримав:

```text
{schema_version:1,message_id:...,values:{vfd.frequency_hz:42.5}}
```

замість валідного:

```json
{"schema_version":1,"message_id":"..."}
```

Результат:

```text
status = rejected
reason = invalid_payload
```

Це важлива перевірка: backend не записав пошкоджені дані.

---

# 9. Надійний локальний publisher для Windows

Для PowerShell було зафіксовано безпечний спосіб передачі через stdin:

```powershell
$payload | docker exec -i techbaza-mosquitto mosquitto_pub \
  -h localhost \
  -q 1 \
  -t techbaza/devices/TB-ESP32-001/telemetry \
  -l
```

Тобто JSON не передається як складний аргумент `-m`, а надходить у stdin.

Це усунуло проблему з лапками Windows/Docker CLI.

---

# 10. Успішний end-to-end тест

Після виправлення publisher backend отримав:

```text
device_uid = TB-ESP32-001
vfd.frequency_hz = 42.5
pump_running = true
```

Результат ingestion:

```text
status = stored
duplicate = false
```

Після цього дані стали доступні через API.

---

# 11. API current state

Endpoint:

```text
GET /api/v1/devices/{device_id}/state
```

Реально підтверджено:

```json
{
  "values": {
    "vfd.frequency_hz": 42.5
  },
  "state": {
    "pump_running": true
  }
}
```

Це current snapshot конкретного Device.

---

# 12. API telemetry history

Endpoint:

```text
GET /api/v1/devices/{device_id}/telemetry
```

Реально підтверджено, що історія повертає окремі telemetry messages із:

- message_id;
- device_id;
- sequence;
- sent_at;
- received_at;
- values;
- state.

---

# 13. Idempotency

MQTT QoS 1 допускає повторну доставку повідомлення.

Тому TechBaza не може вважати кожен callback новою фізичною подією.

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
already exists
     ↓
NO duplicate DB insert
```

---

# 14. Capability-aware telemetry

Модульна архітектура TechBaza вимагає, щоб пристрій міг передавати лише ті типи даних, які відповідають його реальній комплектації.

Було додано policy mapping:

```text
vfd.frequency_hz    → vfd.frequency.read
vfd.current_a       → vfd.current.read
pressure.bar        → pressure.read
water_level.percent → water_level.read

pump_running        → vfd.state.read
vfd_fault_code      → vfd.state.read
local_mode          → vfd.state.read
emergency_stop      → vfd.state.read
```

---

# 15. Чому vfd.control недостатньо

```text
vfd.control
```

означає право/можливість керувати VFD.

А читання телеметрії — інші можливості:

```text
vfd.frequency.read
vfd.current.read
vfd.state.read
```

Це важливе розділення.

Пристрій може:

- вміти керувати VFD;
- але не мати конкретного датчика;
- або мати read-only функцію без control.

---

# 16. Додані capabilities тестового Device

Для `TB-ESP32-001` було створено й призначено:

```text
vfd.control
vfd.frequency.read
vfd.state.read
```

Всі вони зберігаються як окремі DeviceCapability.

---

# 17. Позитивний capability test

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

---

# 18. Негативний capability test

Було спеціально надіслано:

```text
pressure.bar = 4.3
```

але Device не мав:

```text
pressure.read
```

Результат:

```text
status = rejected
reason = capability_violation
missing_capabilities = ["pressure.read"]
unsupported_keys = []
```

Важливо:

```text
pressure.bar
```

є відомим TechBaza key, тому він не `unsupported`.

Він просто не дозволений конкретному Device.

---

# 19. Перевірка, що rejected payload не потрапив у БД

Після capability violation endpoint history містив валідні пакети:

```text
42.5 Hz
47.5 Hz
```

але не містив:

```text
pressure.bar = 4.3
```

Це підтвердило, що policy працює до запису у PostgreSQL.

---

# 20. Діагностичні endpoints

На цьому етапі використовувалися:

```text
GET /health
GET /health/db
GET /health/mqtt

GET /mqtt/last
GET /mqtt/ingestion/last

GET /api/v1/devices/{device_id}/state
GET /api/v1/devices/{device_id}/telemetry
```

`/mqtt/last` показує сирий останній MQTT payload.

`/mqtt/ingestion/last` показує результат бізнес-обробки.

Це суттєво спростило локальну діагностику.

---

# 21. Фактично перевірені сценарії

```text
MQTT broker connected                         ✅
backend subscribed to telemetry topic        ✅
valid JSON → stored                          ✅
invalid JSON → rejected                      ✅
unknown/broken payload not stored            ✅
Device UID lookup                            ✅
telemetry history insert                     ✅
current state update                         ✅
same message_id → duplicate                  ✅
duplicate not stored twice                   ✅
allowed capability → stored                  ✅
missing capability → rejected                ✅
rejected capability payload absent in DB     ✅
```

---

# 22. Основні файли реалізації

```text
backend/app/models/telemetry.py
backend/app/schemas/telemetry.py
backend/app/repositories/telemetry.py
backend/app/services/telemetry.py
backend/app/services/telemetry_policy.py
backend/app/mqtt_client.py
backend/app/api/v1/telemetry.py
```

Документація:

```text
docs/telemetry-contract-v1.md
docs/telemetry-ingestion-local-test.md
docs/telemetry-capability-policy-v1.md
```

---

# 23. Архітектурний результат

Після Етапу 4 TechBaza вже мала повний базовий data path:

```text
Physical controller / simulator
            ↓
           MQTT
            ↓
        Mosquitto
            ↓
         Backend
            ↓
 ┌──────────┼───────────┐
 │          │           │
validate   policy    idempotency
 │          │           │
 └──────────┼───────────┘
            ↓
        PostgreSQL
       ┌────┴────┐
       ↓         ↓
    history   current
```

---

# 24. Що навмисно не входило в Етап 4

На момент завершення core ще окремо не були вирішені:

- heartbeat;
- online/offline timeout;
- out-of-order delivery;
- stale telemetry protection;
- reboot/session protection;
- command queue;
- command acknowledgement;
- users / RBAC;
- production MQTT security;
- реальний ESP32 firmware publisher.

Ці задачі були винесені в наступні етапи надійності.

---

# 25. Підсумок

Етап 4 створив telemetry core TechBaza.

Система вже вміє:

- прийняти MQTT telemetry;
- знайти Device;
- перевірити контракт;
- перевірити capabilities;
- відсікти неправильний пакет;
- захиститися від duplicate message_id;
- зберегти історію;
- сформувати current state;
- віддати дані через REST API.

Це перший повний backend-контур реальних IoT-даних TechBaza.

**V3.5 — Етап 4 завершено.**

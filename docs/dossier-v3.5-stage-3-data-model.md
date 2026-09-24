# Досьє V3.5 — Етап 3
## Data Model v1: організації, об'єкти, пристрої та capabilities

**Статус:** завершено  
**Версія:** V3.5  
**Етап:** 3  
**Мета етапу:** створити першу production-oriented доменну модель TechBaza в PostgreSQL та підтвердити повний цикл запису/читання через versioned API.

---

# 1. Підсумок етапу

На цьому етапі TechBaza перейшла від технічного backend-фундаменту до першої реальної предметної моделі.

Було створено та перевірено ієрархію:

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

Фактично на локальному стенді створено:

```text
TechBaza Test Farm
│
└── Поле 1
    │
    └── TB-ESP32-001
        │
        └── vfd.control
            ├── is_enabled = true
            └── modbus_slave_id = 1
```

Це перша повна модель конкретного клієнтського об'єкта в TechBaza.

---

# 2. Чому цей етап важливий

До цього система вже мала:

- Docker;
- PostgreSQL;
- MQTT broker;
- FastAPI backend;
- HTTP API;
- Backend → PostgreSQL;
- Backend → MQTT.

Але база ще не описувала реальний світ TechBaza.

Етап 3 додав бізнес-сутності:

```text
Хто клієнт?
    ↓
Де знаходиться об'єкт?
    ↓
Який контролер встановлений?
    ↓
Що саме він уміє?
```

---

# 3. Перша доменна модель PostgreSQL

Створено таблиці:

```text
organizations
sites
devices
capabilities
device_capabilities
alembic_version
```

Перевірка через PostgreSQL:

```text
\dt
```

підтвердила існування всіх таблиць.

---

# 4. Alembic

Для керування схемою бази даних додано Alembic.

Початкова міграція:

```text
20260924_0001_core_domain
```

Міграцію було реально застосовано:

```text
Running upgrade -> 20260924_0001
```

Архітектурний принцип:

```text
SQLAlchemy models
        ↓
Alembic migration
        ↓
PostgreSQL schema
```

Production-схема не повинна змінюватися вручну.

---

# 5. Organization

Organization — верхній рівень клієнтської структури.

Приклади:

- фермерське господарство;
- агропідприємство;
- сервісна компанія.

Перший реальний запис:

```text
name: TechBaza Test Farm
slug: techbaza-test-farm
```

API:

```text
GET  /api/v1/organizations
GET  /api/v1/organizations/{organization_id}
POST /api/v1/organizations
```

Перевірено:

```text
POST → 201 Created ✅
GET  → 200 OK      ✅
```

---

# 6. Site

Site — конкретний фізичний об'єкт організації.

Приклади:

- поле;
- свердловина;
- насосна станція;
- вузол поливу.

Перший створений Site:

```text
name: Поле 1
code: field-1
timezone: Europe/Kyiv
```

API:

```text
GET  /api/v1/organizations/{organization_id}/sites
POST /api/v1/organizations/{organization_id}/sites
GET  /api/v1/sites/{site_id}
```

Перевірено:

```text
POST → 201 Created ✅
GET  → 200 OK      ✅
```

---

# 7. Device

Device — фізичний контролер або інший керований пристрій.

Перший створений Device:

```text
uid: TB-ESP32-001
name: Контролер свердловини 1
device_type: controller
lifecycle_status: provisioning
```

API:

```text
GET  /api/v1/sites/{site_id}/devices
POST /api/v1/sites/{site_id}/devices
GET  /api/v1/devices/{device_id}
```

Перевірено:

```text
POST → 201 Created ✅
GET  → 200 OK      ✅
```

---

# 8. Lifecycle status

Новий Device створюється зі статусом:

```text
provisioning
```

Це означає:

- пристрій уже зареєстрований у системі;
- він уже має стабільний UID;
- але ще не вважається повністю введеним в експлуатацію.

Надалі можуть з'явитися стани:

```text
provisioning
active
maintenance
disabled
retired
```

Перехід між статусами повинен контролюватися backend-логікою.

---

# 9. Capability

Capability — глобальний тип функціональної можливості.

Перший capability:

```text
code: vfd.control
name: Керування частотним перетворювачем
```

Приклади майбутніх capabilities:

```text
vfd.control
vfd.frequency.read
vfd.current.read
pressure.read
water_level.read
fertilizer.control
camera.view
```

API каталогу:

```text
GET  /api/v1/capabilities
POST /api/v1/capabilities
```

Створення перевірено:

```text
POST → 201 Created ✅
```

---

# 10. DeviceCapability

DeviceCapability — це не просто capability, а факт того, що конкретна можливість реально встановлена на конкретному пристрої.

Схема:

```text
Device
   ↓
DeviceCapability
   ↓
Capability
```

Для TB-ESP32-001 було призначено:

```text
vfd.control
```

з конфігурацією:

```json
{
  "modbus_slave_id": 1
}
```

і:

```text
is_enabled = true
```

API:

```text
GET  /api/v1/devices/{device_id}/capabilities
POST /api/v1/devices/{device_id}/capabilities/{capability_id}
```

Перевірено:

```text
POST → 201 Created ✅
GET  → 200 OK      ✅
```

---

# 11. Чому config зберігається у JSONB

Різні capabilities можуть мати різні параметри.

Наприклад:

```json
{
  "modbus_slave_id": 1
}
```

або:

```json
{
  "register": 12,
  "unit": "bar",
  "min": 0,
  "max": 10
}
```

або:

```json
{
  "relay_channel": 2,
  "normally_open": true
}
```

Тому локальні параметри capability зберігаються в PostgreSQL як JSONB.

Це дозволяє не створювати окрему колонку для кожного можливого типу датчика або модуля.

---

# 12. Модульний принцип TechBaza

Це ключовий результат Етапу 3.

TechBaza не має жорстко зашитого набору обладнання.

Приклад:

```text
Device A
├── vfd.control
├── pressure.read
└── current.read

Device B
├── vfd.control
├── water_level.read
└── fertilizer.control

Device C
└── vfd.control
```

Backend і frontend надалі повинні будувати доступні функції з фактичних DeviceCapability.

---

# 13. Чому це важливо для frontend

Frontend не повинен показувати однакові віджети всім клієнтам.

Правильна схема:

```text
Frontend
   ↓
GET Device capabilities
   ↓
Backend
   ↓
PostgreSQL
   ↓
реальний список capabilities
   ↓
Frontend будує UI
```

Наприклад, якщо пристрій має:

```text
vfd.control
pressure.read
```

сайт показує:

- керування VFD;
- тиск.

Якщо немає:

```text
water_level.read
```

віджет рівня води не показується.

---

# 14. Архітектура backend

На цьому етапі збережено поділ на шари:

```text
HTTP request
    ↓
FastAPI Router
    ↓
Service
    ↓
Repository
    ↓
SQLAlchemy Session
    ↓
PostgreSQL
```

Router:

- HTTP;
- path/query/body;
- response codes.

Service:

- бізнес-правила;
- перевірки;
- конфлікти;
- логіка створення.

Repository:

- SQLAlchemy-запити;
- читання/запис у БД.

---

# 15. Versioned API

Весь прикладний API працює через:

```text
/api/v1
```

Це дозволяє в майбутньому мати:

```text
/api/v1
/api/v2
```

без миттєвого ламання старих клієнтів.

---

# 16. Валідація

Pydantic перевіряє request body до того, як дані потраплять у бізнес-логіку.

Наприклад:

- довжина name;
- формат slug;
- формат code;
- UUID;
- device_type;
- capability code.

Невалідний запит повертає:

```text
422 Unprocessable Content
```

Це було окремо підтверджено під час тестування Swagger.

---

# 17. Унікальність даних

На рівні бізнес-логіки та PostgreSQL контролюються:

```text
Organization.slug                  unique
Device.uid                         unique
Capability.code                    unique
Site code                          unique within Organization
DeviceCapability                   unique per Device + Capability
```

Це зменшує ризик дублювання сутностей.

---

# 18. Фактичний тестовий об'єкт

На завершення Етапу 3 в PostgreSQL реально існує:

```text
Organization
TechBaza Test Farm
ID: 2b60bce4-0d34-43f7-a5ec-2e674e64684f
│
└── Site
    Поле 1
    ID: a2e6c00c-f6f9-4f12-8098-5992a6bca13a
    │
    └── Device
        TB-ESP32-001
        ID: 41a7a0ee-72df-4655-8572-b823ec320195
        │
        └── DeviceCapability
            vfd.control
            │
            ├── enabled: true
            └── config:
                modbus_slave_id: 1
```

---

# 19. Що підтверджено реально

```text
Alembic migration                         ✅
organizations table                       ✅
sites table                               ✅
devices table                             ✅
capabilities table                        ✅
device_capabilities table                 ✅

Organization POST                         ✅
Organization GET                          ✅

Site POST                                 ✅
Site GET                                  ✅

Device POST                               ✅
Device GET                                ✅

Capability POST                           ✅
DeviceCapability POST                     ✅
DeviceCapability GET                      ✅
```

---

# 20. Поточний стан системи після Етапу 3

```text
                  TechBaza Backend
                         │
                         ▼
                     PostgreSQL
                         │
        ┌────────────────┼────────────────┐
        │                │                │
 Organization          Site            Device
                                         │
                                         ▼
                               DeviceCapability
                                         │
                                         ▼
                                     Capability
```

Паралельно вже працює MQTT:

```text
ESP32 future
    ↓
Mosquitto
    ↓
Backend
```

---

# 21. Що ще не реалізовано

Після Етапу 3 ще немає:

- ingestion реальної телеметрії;
- таблиць telemetry;
- device state;
- online/offline logic;
- heartbeat;
- командного журналу;
- command acknowledgement;
- alerts/events;
- users;
- roles;
- authentication;
- permissions;
- frontend;
- реального ESP32 → MQTT → Backend → DB потоку.

---

# 22. Наступний логічний етап

Наступний етап повинен зв'язати доменну модель із реальними даними пристрою.

Рекомендована назва:

**V3.5 — Етап 4. Telemetry Core: MQTT ingestion, стан пристрою та історія телеметрії**

Цільова схема:

```text
ESP32
  ↓ MQTT
Mosquitto
  ↓
Backend
  ↓
валідація Device UID
  ↓
Capability-aware processing
  ↓
PostgreSQL
  ├── current device state
  └── telemetry history
```

---

# 23. Підсумок

V3.5 Етап 3 завершив першу повну доменну основу TechBaza.

Система вже знає:

- хто є клієнтом;
- які об'єкти йому належать;
- які контролери встановлені;
- які функції має кожен контролер;
- які локальні параметри має ця функція.

Тобто база вже описує не абстрактний IoT-проєкт, а конкретну конфігурацію TechBaza.

**V3.5 — Етап 3 завершено.**

# API v1 TechBaza

Публічний прикладний API версіонується через префікс:

```text
/api/v1
```

Це дозволяє надалі змінювати контракт API без раптового ламання старих клієнтів.

## Перший доменний ресурс: organizations

Доступні endpoint-и:

```text
GET  /api/v1/organizations
GET  /api/v1/organizations/{organization_id}
POST /api/v1/organizations
```

## Архітектурні шари

```text
HTTP request
    ↓
FastAPI router
    ↓
Service
    ↓
Repository
    ↓
SQLAlchemy Session
    ↓
PostgreSQL
```

Router відповідає лише за HTTP-контракт.

Service містить бізнес-правила.

Repository містить SQL/ORM-запити.

Таке розділення потрібне, щоб логіка не накопичувалась у великих endpoint-функціях і могла тестуватися окремо.

## Створення тестової організації

Через Swagger:

```text
POST /api/v1/organizations
```

Приклад body:

```json
{
  "name": "TechBaza Test Farm",
  "slug": "techbaza-test-farm"
}
```

Очікуваний HTTP status:

```text
201 Created
```

Після цього:

```text
GET /api/v1/organizations
```

повинен повернути створений запис.

Повторне створення того самого `slug` має повернути:

```text
409 Conflict
```

Це перевіряє не лише API, а повний ланцюг запису даних у PostgreSQL.


## Другий доменний ресурс: sites

Site — це конкретний фізичний об'єкт організації.

Доступні endpoint-и:

```text
GET  /api/v1/organizations/{organization_id}/sites
POST /api/v1/organizations/{organization_id}/sites
GET  /api/v1/sites/{site_id}
```

Приклад створення Site:

```json
{
  "name": "Поле 1",
  "code": "field-1",
  "timezone": "Europe/Kyiv"
}
```

Архітектурний зв'язок:

```text
Organization
    ↓ 1:N
Site
```

Поле `code` унікальне не глобально, а в межах конкретної організації.

Це означає, що дві різні організації можуть мати, наприклад, власний `field-1`, але одна організація не може створити два Site з однаковим code.


## Третій доменний ресурс: devices

Device — фізичний контролер або інший керований пристрій на конкретному Site.

Доступні endpoint-и:

```text
GET  /api/v1/sites/{site_id}/devices
POST /api/v1/sites/{site_id}/devices
GET  /api/v1/devices/{device_id}
```

Приклад створення контролера:

```json
{
  "uid": "TB-ESP32-001",
  "name": "Контролер свердловини 1",
  "device_type": "controller"
}
```

Архітектурний зв'язок:

```text
Organization
    ↓
Site
    ↓
Device
```

Поле `uid` є глобально унікальним. Один фізичний контролер не може бути одночасно зареєстрований на двох Site.

Новий Device створюється зі статусом:

```text
provisioning
```

Це означає, що запис у системі вже існує, але пристрій ще не вважається повністю введеним в експлуатацію.


## Четвертий доменний ресурс: capabilities

Capability описує функцію, яку може підтримувати конкретний Device.

Каталог capabilities є глобальним:

```text
GET  /api/v1/capabilities
POST /api/v1/capabilities
```

Прив'язка до конкретного пристрою:

```text
GET  /api/v1/devices/{device_id}/capabilities
POST /api/v1/devices/{device_id}/capabilities/{capability_id}
```

Приклади capability code:

```text
vfd.control
vfd.frequency.read
pressure.read
current.read
water_level.read
fertilizer.control
camera.view
```

Приклад створення capability:

```json
{
  "code": "vfd.control",
  "name": "Керування частотним перетворювачем",
  "description": "Дозволяє запуск, зупинку та передачу команд керування VFD."
}
```

Приклад прив'язки до Device:

```json
{
  "is_enabled": true,
  "config": {
    "modbus_slave_id": 1
  }
}
```

Поле `config` зберігається як JSONB та містить параметри саме цього встановлення.

Архітектура:

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

Таким чином frontend і backend можуть визначати функції конкретного контролера на основі фактичної конфігурації, а не жорстко зашитого набору датчиків.


## Commands

Базовий command API зберігає команду в PostgreSQL перед майбутньою MQTT-публікацією.

```text
POST /api/v1/devices/{device_id}/commands
GET  /api/v1/devices/{device_id}/commands
GET  /api/v1/commands/{command_id}
```

Початкові `command_type`:

```text
vfd.start
vfd.stop
vfd.frequency.set
```

Приклад створення:

```json
{
  "request_id": "11111111-2222-4333-8444-555555555555",
  "command_type": "vfd.frequency.set",
  "payload": {
    "frequency_hz": 45.0
  },
  "ttl_seconds": 30
}
```

На поточній операції нова команда отримує статус `queued`. MQTT publish та ACK реалізуються окремими наступними операціями.


### Ідемпотентність створення command

`request_id` генерується клієнтом до POST.

- перший валідний запит → `201 Created`;
- повтор ідентичного POST з тим самим `request_id` → `200 OK` і той самий command;
- той самий `request_id` з іншим Device/type/payload/TTL → `409 Conflict`.

Це не дозволяє HTTP retry випадково створити дві фізичні команди.

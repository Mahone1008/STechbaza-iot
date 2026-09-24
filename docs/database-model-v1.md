# Модель даних TechBaza v1

Цей документ описує першу доменну модель PostgreSQL для TechBaza.

## Головний принцип

База не повинна виходити з припущення, що всі об'єкти мають однакове обладнання.

Основна схема:

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

## Organization

Організація — клієнт або сервісна структура, якій належать об'єкти.

## Site

Site — конкретний фізичний об'єкт: поле, свердловина, насосна станція або вузол поливу.

Одна організація може мати багато Site.

## Device

Device — фізичний контролер або інший керований пристрій TechBaza.

На першому етапі основний Device — ESP32-S3 контролер.

Кожен Device має глобально унікальний `uid`.

## Capability

Capability — тип функціональної можливості.

Майбутні приклади:

```text
vfd.control
vfd.frequency.read
pressure.read
current.read
water_level.read
fertilizer.control
camera.view
```

## DeviceCapability

DeviceCapability показує, що конкретний Device реально має певну можливість.

Приклад:

```text
Device TB-001
├── vfd.control
├── pressure.read
└── current.read

Device TB-002
├── vfd.control
├── water_level.read
└── fertilizer.control
```

Поле `config` має тип JSONB і дозволяє зберігати локальні параметри конкретної можливості без створення нової колонки для кожного типу обладнання.

## Чому використовуються UUID

UUID краще підходить для розподіленої IoT-системи та не залежить від порядкового номера в одній конкретній базі.

## Чому використовуємо Alembic

Структура production-бази не редагується вручну.

Кожна зміна схеми повинна мати міграцію:

```text
код моделі
   ↓
Alembic migration
   ↓
PostgreSQL schema
```

Початкова міграція:

```text
20260924_0001_core_domain
```

Вона створює:

- organizations;
- sites;
- devices;
- capabilities;
- device_capabilities.


## device_commands

Durable-черга команд керування пристроєм.

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

Зв'язок:

```text
Device 1 ─── * DeviceCommand
```

Команда спочатку фіксується в PostgreSQL зі статусом `queued`, а вже наступний шар відповідає за MQTT delivery та ACK.


`request_id` має унікальний індекс і забезпечує ідемпотентність повторного HTTP-запиту. Для майбутнього expiry worker також використовується індекс `(status, expires_at)`.


### Command delivery reliability metadata

Після міграції `20260924_0007` таблиця `device_commands` також містить:

```text
publish_attempts
last_publish_attempt_at
last_publish_error
```

Ці поля використовуються для контрольованого MQTT retry та діагностики втрати ACK.

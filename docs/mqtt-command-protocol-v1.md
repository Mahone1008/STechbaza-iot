# MQTT Command Protocol v1

## Призначення

Цей контракт описує напрямок:

```text
Backend → MQTT → ESP32
```

для Remote Command Core.

## Topic

```text
techbaza/devices/{device_uid}/commands
```

Приклад:

```text
techbaza/devices/TB-ESP32-001/commands
```

## QoS та retain

```text
QoS = 1
retain = false
```

QoS 1 означає delivery at least once, тому Device у наступних операціях зобов'язаний дедуплікувати команди за `command_id`.

`retain=false` є принциповим safety-рішенням: стара команда START не повинна залишатися retained message і випадково виконатися при майбутньому reconnect контролера.

## CommandEnvelope v1

```json
{
  "schema_version": 1,
  "command_id": "UUID",
  "request_id": "UUID",
  "issued_at": "2026-09-24T11:00:00Z",
  "expires_at": "2026-09-24T11:00:30Z",
  "ttl_seconds": 30,
  "command_type": "vfd.frequency.set",
  "payload": {
    "frequency_hz": 45
  }
}
```

## Поля

### schema_version

Версія MQTT command contract.

### command_id

Server-side UUID durable-команди.

Це головний ідентифікатор для:

- ACK;
- result;
- Device-side deduplication;
- audit trail.

### request_id

Client-side UUID HTTP-запиту.

Використовується backend-ом для idempotency API.

### issued_at

Час створення durable command на backend.

### expires_at

Абсолютний deadline команди.

Backend не публікує команду, якщо TTL уже завершився.

### ttl_seconds

Первинний TTL запиту. Використовується для діагностики та контракту.

### command_type

Початкові типи:

```text
vfd.start
vfd.stop
vfd.frequency.set
```

### payload

Параметри конкретної команди.

## Publish lifecycle

```text
device_commands.status = queued
        ↓
MQTT publisher
        ↓
broker підтвердив publish
        ↓
status = published
published_at = server UTC time
```

Якщо MQTT тимчасово недоступний:

```text
status залишається queued
```

Durable command не видаляється і не губиться.

Контрольований retry буде реалізований у reliability-операції.

## Захист від expired command

Перед publish backend перевіряє:

```text
expires_at <= now
```

Якщо deadline уже пройшов:

```text
status = expired
error_code = command_expired
MQTT publish НЕ виконується
```

## Важливе обмеження delivery

Між MQTT publish і записом `status=published` існує невелике failure window:

```text
MQTT command реально пішла
        ↓
backend аварійно завершився до DB commit
```

Тому на рівні всієї системи command delivery не може покладатися на "exactly once".

Правильна модель:

```text
at-least-once transport
+
command_id deduplication на ESP32
+
ACK/result у PostgreSQL
```

Це буде завершено наступними операціями.

## Safety

Remote command не обходить локальні safety interlocks.

Навіть валідний MQTT command повинен бути відхилений edge-контролером, якщо локальна логіка забороняє виконання.

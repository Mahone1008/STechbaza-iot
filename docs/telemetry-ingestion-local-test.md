# Telemetry ingestion — локальна перевірка

Цей документ описує перевірку першого реального ланцюга:

```text
MQTT
 ↓
Mosquitto
 ↓
FastAPI backend
 ↓
валідація Device UID та payload
 ↓
PostgreSQL
 ├── telemetry_messages
 └── device_states
```

## Topic

Backend підписаний на:

```text
techbaza/devices/+/telemetry
```

Для тестового пристрою:

```text
techbaza/devices/TB-ESP32-001/telemetry
```

## Тестовий пакет

У PowerShell зручно передати JSON як одинарно quoted аргумент:

```powershell
docker exec -it techbaza-mosquitto mosquitto_pub -h localhost -q 1 -t techbaza/devices/TB-ESP32-001/telemetry -m '{"schema_version":1,"message_id":"9c1d9ce2-ec37-4f18-af3c-e66918f88a01","sent_at":"2026-09-24T08:30:00Z","sequence":1,"values":{"vfd.frequency_hz":42.5},"state":{"pump_running":true}}'
```

## Діагностика ingestion

```text
GET /mqtt/ingestion/last
```

Очікувано:

```json
{
  "status": "ok",
  "ingestion": {
    "status": "stored",
    "device_uid": "TB-ESP32-001",
    "duplicate": false
  }
}
```

## Читання останнього стану

```text
GET /api/v1/devices/{device_id}/state
```

Для тестового Device:

```text
41a7a0ee-72df-4655-8572-b823ec320195
```

## Історія телеметрії

```text
GET /api/v1/devices/{device_id}/telemetry
```

## Idempotency test

Повторне надсилання пакета з тим самим `message_id` не повинно створити другий запис.

`/mqtt/ingestion/last` має показати:

```text
status = duplicate
duplicate = true
```

Це важливо, тому що MQTT QoS може призводити до повторної доставки повідомлення.

## Що ще не входить у цю операцію

На цьому кроці backend перевіряє:

- структуру topic;
- існування Device UID;
- JSON;
- Telemetry Contract v1;
- idempotency;
- атомарний запис history + current state.

Перевірка того, чи конкретний ключ телеметрії дозволений через DeviceCapability, буде окремою наступною операцією.

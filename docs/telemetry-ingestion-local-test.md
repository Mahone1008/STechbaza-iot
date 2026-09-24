# Telemetry ingestion — локальна перевірка

Цей документ описує перевірку реального ланцюга:

```text
MQTT
 ↓
Mosquitto
 ↓
FastAPI backend
 ↓
валідація Device UID та payload
 ↓
capability-aware policy
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

## Надійна відправка JSON з Windows PowerShell

Не передаємо JSON напряму через `-m`, оскільки зв'язка PowerShell → docker exec може змінити лапки в аргументі.

Створюємо payload як PowerShell object:

```powershell
$messageId = [guid]::NewGuid().ToString()

$payload = @{
    schema_version = 1
    message_id = $messageId
    sent_at = (Get-Date).ToUniversalTime().ToString("o")
    sequence = 1
    values = @{
        "vfd.frequency_hz" = 42.5
    }
    state = @{
        pump_running = $true
    }
} | ConvertTo-Json -Compress
```

Передаємо JSON через stdin:

```powershell
$payload | docker exec -i techbaza-mosquitto mosquitto_pub -h localhost -q 1 -t techbaza/devices/TB-ESP32-001/telemetry -l
```

## Діагностика ingestion

```text
GET /mqtt/ingestion/last
```

Можливі статуси:

```text
stored      — новий пакет успішно збережено
duplicate   — message_id вже існує, дубль не записано
rejected    — пакет відхилено до запису
error       — внутрішня помилка обробки
```

## Читання останнього стану

```text
GET /api/v1/devices/{device_id}/state
```

## Історія телеметрії

```text
GET /api/v1/devices/{device_id}/telemetry
```

## Idempotency

Повторне надсилання того самого `$payload` не повинно створювати другий запис.

Очікувано:

```text
status = duplicate
duplicate = true
```

## Capability-aware policy

Новий пакет перевіряється проти активних DeviceCapability.

Наприклад:

```text
vfd.frequency_hz  → vfd.frequency.read
pump_running      → vfd.state.read
```

Якщо потрібної capability немає, ingestion повертає:

```text
status = rejected
reason = capability_violation
```

і показує `missing_capabilities`.

Невідомий telemetry key також відхиляється та потрапляє до `unsupported_keys`.

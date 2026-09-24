# Capability-aware Telemetry Policy v1

## Мета

TechBaza є модульною платформою. Тому зареєстрований Device не повинен мати можливість надсилати довільні telemetry keys.

Backend перевіряє:

```text
telemetry key
    ↓
яка capability потрібна?
    ↓
чи активна вона на Device?
    ↓
так → можна записати
ні  → rejected
```

## Поточна мапа v1

### values

```text
vfd.frequency_hz      → vfd.frequency.read
vfd.current_a         → vfd.current.read
pressure.bar          → pressure.read
water_level.percent   → water_level.read
```

### state

```text
pump_running          → vfd.state.read
vfd_fault_code        → vfd.state.read
local_mode            → vfd.state.read
emergency_stop        → vfd.state.read
```

## Чому vfd.control недостатньо

`vfd.control` означає можливість надсилати команди керування VFD.

Читання телеметрії — інша можливість:

```text
vfd.control          — керувати
vfd.frequency.read   — читати частоту
vfd.current.read     — читати струм
vfd.state.read       — читати стан
```

Таке розділення дозволяє точно описувати фактичну комплектацію пристрою та права його функцій.

## Unknown keys

Якщо payload містить ключ, якого немає у policy registry, весь пакет відхиляється.

Причина: мовчазне збереження невідомих полів з часом перетворює telemetry schema на неконтрольований набір даних.

## Disabled capability

До перевірки допускаються лише DeviceCapability з:

```text
is_enabled = true
```

Вимкнена capability поводиться так само, ніби вона недоступна.

## Діагностика

`GET /mqtt/ingestion/last` для відхиленого пакета повертає:

```json
{
  "status": "ok",
  "ingestion": {
    "status": "rejected",
    "reason": "capability_violation",
    "missing_capabilities": [
      "vfd.frequency.read",
      "vfd.state.read"
    ],
    "unsupported_keys": []
  }
}
```

## Подальший розвиток

Коли telemetry contract розширюється, новий key спочатку додається до документованої policy map і лише після цього може прийматися production backend.

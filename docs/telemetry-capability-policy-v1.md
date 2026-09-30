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

Повний registry 13 каналів генерується з `backend/app/device_contract.py`:
[канал → capability, тип та одиниця](generated-code-reference.md#канали-телеметрії).
Окрема неповна копія таблиці тут не підтримується.

`config.telemetry_keys` обмежує advertised overview/series канали установки,
але не є ACL для MQTT ingestion. Пакет перевіряється за відомими keys та
активними capabilities; будь-який невідомий key/відсутня capability
відхиляє весь пакет. [Межі моделі](module-channel-contract-v1.md).

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

`GET /mqtt/ingestion/last` потребує Bearer superadmin. Для відхиленого пакета повертає:

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

Коли telemetry contract розширюється, новий key додається до registry разом з валідацією, firmware/ingestion/series/UI підтримкою та тестами. `python scripts/check-docs.py --write` оновлює довідник; саме редагування документа не додає handler.

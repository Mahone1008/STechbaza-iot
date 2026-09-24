# Device Presence v1

## Мета

Presence відповідає на питання:

```text
Чи бачить сервер пристрій зараз?
```

Для цього TechBaza використовує `devices.last_seen_at` та окремий MQTT heartbeat.

## MQTT topic

```text
techbaza/devices/{device_uid}/heartbeat
```

Приклад:

```text
techbaza/devices/TB-ESP32-001/heartbeat
```

## Heartbeat payload v1

```json
{
  "schema_version": 1,
  "message_id": "7a8805e4-48a8-4b17-b339-cbcf323a8770",
  "sent_at": "2026-09-24T09:30:00Z",
  "sequence": 10
}
```

Heartbeat не несе телеметрію. Його задача — дешево підтвердити, що контролер живий та має зв'язок із broker/backend.

## Online / offline

`online` не зберігається як постійний boolean.

Він обчислюється:

```text
now - last_seen_at <= timeout
          ↓
        online
```

За замовчуванням:

```text
timeout = 90 секунд
```

Налаштовується environment variable:

```text
DEVICE_ONLINE_TIMEOUT_SECONDS
```

## Що оновлює last_seen_at

`last_seen_at` оновлюється після:

- валідної та дозволеної telemetry;
- валідного heartbeat від зареєстрованого Device.

Невалідна telemetry, capability violation або повідомлення від невідомого UID не повинні штучно робити пристрій online.

## API

```text
GET /api/v1/devices/{device_id}/availability
```

## Діагностика heartbeat

```text
GET /mqtt/heartbeat/last
```

Можливі статуси:

```text
accepted — heartbeat прийнято, last_seen_at оновлено
rejected — payload невалідний або Device UID невідомий
error    — внутрішня помилка backend
```

## Важливе розділення станів

Heartbeat означає лише доступність контролера.

Це не те саме, що стан насоса або VFD.

Можливі комбінації:

```text
Controller online + Pump running
Controller online + Pump stopped
Controller online + VFD fault
Controller offline
```

Ці поняття не повинні змішуватися в один boolean.

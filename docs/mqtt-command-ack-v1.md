# MQTT Command ACK Protocol v1

## Призначення

ACK підтверджує лише факт, що Device **отримав command**.

Це ще не означає, що VFD реально виконав дію.

```text
Backend published command
        ↓
ESP32 received command
        ↓
ACK
        ↓
Backend: status = acknowledged
```

Фактичний результат виконання буде окремим message у наступній операції.

## Topic

```text
techbaza/devices/{device_uid}/commands/ack
```

Backend підписаний на:

```text
techbaza/devices/+/commands/ack
```

## ACK payload

```json
{
  "schema_version": 1,
  "message_id": "UUID",
  "command_id": "UUID",
  "session_id": "UUID",
  "sent_at": "2026-09-24T12:00:00Z"
}
```

## Поля

- `message_id` — UUID конкретного ACK message;
- `command_id` — command, яку підтверджує ESP32;
- `session_id` — boot-session контролера;
- `sent_at` — час формування ACK на Device, якщо доступний.

Backend використовує власний server time для `acknowledged_at`.

## Lifecycle

Допустимий основний перехід:

```text
published
   ↓ ACK
acknowledged
```

Повторний ACK після `acknowledged` є idempotent:

```text
acknowledged
   ↓ duplicate ACK
без повторної зміни state
```

ACK для command іншого Device відхиляється.

ACK для невідомого `command_id` відхиляється.

ACK для lifecycle status, з якого підтвердження нелогічне, відхиляється як `invalid_transition`.

## Safety

ACK не дорівнює виконанню.

Наприклад:

```text
START command
   ↓
ESP32 отримав
   ↓
ACK
   ↓
але локальний interlock може заборонити запуск
```

Тому реальний результат обов'язково має бути окремим `Command Result`.

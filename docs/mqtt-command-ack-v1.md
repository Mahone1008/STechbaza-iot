# MQTT Command ACK Protocol v1

> Оновлення 0.39.0: поточні правила порядку команд, TTL, пізніх відповідей та міграції описані в [command-safety-v2.md](command-safety-v2.md).

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

Фактичний результат обробляється окремим [Result v1](mqtt-command-result-v1.md).

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

Після TTL ACK зберігається як пізній доказ, якщо спроба доставки вже була.
Допустимі `published`, `result_unknown`, а також legacy `expired` зі спробою;
для upgrade quarantine враховується невизначеність старої реалізації.
Пізній ACK не відновлює доставку і залишає результат невідомим; повторний ACK
не подовжує deadline. `queued`/`cancelled` без спроби не підтверджуються.
ACK після acknowledged/final idempotent. Інші нелогічні переходи відхиляються.
[Чинний lifecycle](command-safety-v2.md) має пріоритет над старими v1 схемами.

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


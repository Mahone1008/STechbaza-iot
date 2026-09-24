# MQTT Command Result Protocol v1

## Призначення

Command Result повідомляє backend-у **фінальний результат виконання command на Device**.

ACK і Result мають різний сенс:

```text
ACK
→ Device отримав command

Result
→ Device завершив виконання command
```

## Topic

```text
techbaza/devices/{device_uid}/commands/result
```

Backend підписаний на:

```text
techbaza/devices/+/commands/result
```

## Payload

Успіх:

```json
{
  "schema_version": 1,
  "message_id": "UUID",
  "command_id": "UUID",
  "session_id": "UUID",
  "sent_at": "2026-09-24T12:10:00Z",
  "status": "succeeded",
  "result": {
    "frequency_hz": 30
  },
  "error_code": null,
  "error_message": null
}
```

Помилка:

```json
{
  "schema_version": 1,
  "message_id": "UUID",
  "command_id": "UUID",
  "session_id": "UUID",
  "sent_at": "2026-09-24T12:10:00Z",
  "status": "failed",
  "result": {},
  "error_code": "modbus_write_failed",
  "error_message": "VFD не підтвердив запис регістру"
}
```

## Lifecycle

Основні переходи:

```text
acknowledged
   ↓
succeeded

acknowledged
   ↓
failed
```

Також дозволено:

```text
published
   ↓
succeeded / failed
```

Це навмисно: ACK і Result ідуть різними MQTT topics, тому final result теоретично може прийти раніше за ACK.

У такому випадку Result є сильнішим доказом того, що Device отримав command, і backend автоматично заповнює `acknowledged_at`, якщо його ще немає.

## Terminal state

Після `succeeded` або `failed` command вважається завершеною:

```text
completed_at != null
```

Повторний ідентичний final result є idempotent.

Якщо після terminal state приходить суперечливий result, наприклад:

```text
спочатку succeeded
потім failed
```

backend відхиляє його як:

```text
terminal_result_conflict
```

## Validation

- `succeeded` не повинен містити `error_code` / `error_message`;
- `failed` обов'язково повинен містити `error_code`;
- unknown command відхиляється;
- Device mismatch відхиляється;
- invalid lifecycle transition відхиляється.

## Safety

Result повинен відображати фактичний edge-рівень.

Для `vfd.frequency.set` майбутній ESP32 firmware не повинен відправляти `succeeded` лише через те, що MQTT command була отримана. Успіх має означати, що локальна логіка виконання завершилася успішно згідно з Modbus/VFD contract.

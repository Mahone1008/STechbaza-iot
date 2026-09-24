# Telemetry Contract v1

Цей документ фіксує поточний MQTT-контракт телеметрії TechBaza.

## MQTT topic

`techbaza/devices/{device_uid}/telemetry`

## Payload

Payload містить `schema_version`, `message_id`, `session_id`, `sent_at`, `sequence`, `values` і `state`.

### message_id

UUID конкретного MQTT-пакета. Використовується для idempotency.

### session_id

UUID поточного boot ESP32. Один boot — один session_id. Після reboot firmware генерує новий UUID. Поле поки nullable для backward compatibility, але новий firmware повинен його надсилати.

### sequence

Монотонний номер пакета всередині session. Після reboot sequence може знову початися з 0, тому його не можна правильно трактувати без session_id.

### sent_at / received_at

`sent_at` формує контролер. `received_at` фіксує backend власним серверним часом.

## Зберігання

`telemetry_messages` — append-only history.

`device_states` — current snapshot з `last_session_id`, `last_sequence`, `last_reported_at` і `last_received_at`.

## Processing pipeline

MQTT → JSON/Pydantic validation → Device UID → DeviceCapability policy → message_id idempotency → session/order policy → PostgreSQL history → current state лише якщо пакет актуальний.

## Online/offline

Presence не змішується з telemetry state. `last_seen_at + timeout` дає online/offline.

## Документація

- `docs/telemetry-capability-policy-v1.md`;
- `docs/telemetry-ordering-v1.md`;
- `docs/telemetry-session-protection-v1.md`;
- `docs/device-presence-v1.md`.

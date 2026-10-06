# Telemetry Contract v1

Цей документ фіксує поточний MQTT-контракт телеметрії TechBaza.

## MQTT topic

`techbaza/devices/{device_uid}/telemetry`

## Payload

Payload містить `schema_version`, `message_id`, `session_id`, `sent_at`, `sequence`, `values` і `state`.
З backend 0.40.0 підтримується необов'язковий типізований `diagnostics`:
[контракт, транспорт V3/V4/V5 та порядок оновлення](controller-diagnostics-v1.md).
З ним `session_id` обов'язковий; старі пакети без діагностики підтримуються.

### message_id

UUID конкретного MQTT-пакета. Використовується для idempotency.

### session_id

UUID поточного boot ESP32. Один boot — один session_id. Після reboot firmware генерує новий UUID. Поле поки nullable для backward compatibility, але новий firmware повинен його надсилати.

### sequence

Монотонний номер пакета всередині session. Після reboot sequence може знову початися з 0, тому його не можна правильно трактувати без session_id.

### sent_at / received_at

`sent_at` формує контролер. `received_at` фіксує backend власним серверним часом.

### command_sequence_floor

Firmware 0.8.0 може надсилати необов'язковий `command_sequence_floor`: найбільший номер команди, збережений у справному журналі ESP32. Це не `sequence` телеметрії. Строге ціле 0..9007199254740991; потрібні `session_id`, `sequence` і часовий `sent_at`. Поле дозволяє повернути серверну картку пристрою після demo reset без стирання NVS.

Backend під блокуванням того самого рядка Device, що використовується для створення команд, виконує `command_sequence = max(command_sequence, command_sequence_floor)`. Лише для пакета, прийнятого для поточного snapshot, із часом у межах від 10 секунд у минулому до 2 секунд у майбутньому. Дублікат message_id, стара boot session, невпорядкований або затриманий пакет не змінюють лічильник. Пакет не змінює права, обладнання чи записи команд і сам не видає команду. Metadata не додається до клієнтських показників/історії.

Старі firmware без поля підтримуються. Перед firmware 0.8.0 потрібно оновити backend: попередній строгий validator відхилить невідоме поле. [Оновлення і перевірка](v3-remote-operation.md).

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

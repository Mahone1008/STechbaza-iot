# Telemetry Session Protection v1

## Мета

Після reboot ESP32 локальний `sequence` може початися з нуля.

Без окремого session marker backend міг би помилково вважати `sequence 0` після reboot старішим за `sequence 853` до reboot.

Тому кожен boot контролера отримує окремий `session_id` (UUID).

## Контракт

Telemetry та heartbeat можуть містити `session_id`.

Новий firmware повинен генерувати один `session_id` під час старту та використовувати його до наступного reboot.

## Як працює ordering

### Та сама session

У межах одного boot головний порядок задає `sequence`: більший sequence означає новіший пакет.

### Нова session

Раніше невідома `session_id` означає новий boot. Тому `session B / sequence 0` може бути новішою за `session A / sequence 853`.

### Повернення старої session

Якщо backend уже бачив session A, current state перейшов на session B, а потім із мережевого буфера прийшов пакет A, пакет зберігається в history, але current state не змінюється.

## Поля БД

Міграція `20260924_0004` додає:

- `telemetry_messages.session_id`;
- `device_states.last_session_id`;
- індекс `(device_id, session_id)`.

## Backward compatibility

`session_id` поки nullable, щоб старі тестові payload не перестали працювати миттєво.

Після того як current state перейшов на session-aware режим, legacy telemetry без `session_id` не має права переписувати current state.

## Діагностика

`GET /mqtt/ingestion/last` показує `session_id`, `state_updated` та `ordering_reason`.

Типові `ordering_reason`:

- `session_tracking_initialized`;
- `new_session`;
- `higher_sequence_same_session`;
- `non_increasing_sequence_same_session`;
- `old_session_reappeared`;
- `missing_session_id`.

## Production правило

`message_id`, `session_id` і `sequence` мають різні задачі:

- `message_id` — чи це той самий пакет;
- `session_id` — чи це той самий boot;
- `sequence` — який пакет новіший усередині boot.

# Telemetry Ordering v1

## Мета

MQTT і мобільний зв'язок можуть доставляти пакети не в тому порядку, в якому їх сформував контролер.

TechBaza розділяє history та current state: усі валідні нові `message_id` зберігаються в history, а current state змінюється лише від актуального пакета.

## Ordering metadata

Поточна модель використовує `session_id`, `sequence`, `sent_at` і `received_at`.

### session_id

UUID одного boot ESP32. Новий reboot означає новий `session_id`.

### sequence

Монотонний номер пакета всередині однієї session. Коли `session_id` однаковий, `sequence` є головним джерелом порядку.

### sent_at

Час, заявлений контролером. Використовується як fallback, якщо sequence недоступний.

### received_at

Серверний час фактичного отримання. Потрібний для діагностики мережі, але сам по собі не визначає актуальність фізичного стану.

## Правила

У межах однієї session більший `sequence` оновлює current state, а неперевищуючий — лишається тільки в history.

Раніше невідома session означає новий boot і може оновити current state навіть якщо sequence почався з 0.

Якщо пакет приходить зі старої session, яку backend уже бачив до переходу на іншу session, він зберігається в history, але current state не змінює.

Legacy payload без `session_id` використовує стару sent_at/sequence логіку лише доки current state також legacy.

## Duplicate vs stale vs old session

- duplicate: той самий `message_id`, другий history row не створюється;
- stale: новий `message_id`, але старіший порядок у тій самій session — history yes, current state no;
- old session: новий `message_id` зі старої boot-session — history yes, current state no.

## Міграції

- `20260924_0003` — `last_sequence`;
- `20260924_0004` — `session_id` / `last_session_id`.

Деталі reboot-захисту: `docs/telemetry-session-protection-v1.md`.

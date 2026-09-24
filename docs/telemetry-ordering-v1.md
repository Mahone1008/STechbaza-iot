# Telemetry Ordering v1

## Мета

MQTT і мобільний зв'язок не гарантують, що всі пакети дійдуть до backend строго в тому порядку, у якому їх сформував контролер.

Приклад:

```text
ESP32 створив sequence 10 → 45 Hz
ESP32 створив sequence 11 → 48 Hz

через затримку мережі backend отримав:
11 → першим
10 → другим
```

Без окремого ordering policy старий пакет `10` міг би відкотити current state назад до 45 Hz.

## Принцип TechBaza

Історія та current state мають різні правила.

```text
валідний новий message_id
        │
        ├── telemetry_messages
        │      зберігаємо в історію
        │
        └── device_states
               оновлюємо лише якщо пакет новіший
```

Тобто out-of-order пакет не втрачається: він залишається в історії для діагностики, але не має права переписувати актуальний snapshot.

## Ordering metadata

Для рішення використовуються:

```text
sent_at
sequence
```

У `device_states` додано:

```text
last_sequence
last_reported_at
last_received_at
```

## Правила v1

Пріоритет має `sent_at`, коли timestamp є і в current state, і в новому пакеті.

```text
incoming.sent_at > current.last_reported_at
→ update current state

incoming.sent_at < current.last_reported_at
→ history only
```

Якщо `sent_at` однаковий, sequence використовується як tie-breaker:

```text
incoming.sequence > current.last_sequence
→ update current state

incoming.sequence <= current.last_sequence
→ history only
```

Якщо timestamp недостатньо, sequence може використовуватися як fallback.

Якщо ordering metadata недостатньо для безпечного рішення, існуючий snapshot не переписується.

## Чим stale відрізняється від duplicate

### Duplicate

Той самий `message_id`.

```text
message_id already exists
→ другий history row НЕ створюється
→ current state НЕ змінюється
```

### Stale / out-of-order

Інший `message_id`, але пакет старіший за current state.

```text
new message_id
але старіший sent_at / sequence
→ history row створюється
→ current state НЕ змінюється
```

Це принципово різні ситуації.

## Діагностика

`GET /mqtt/ingestion/last` тепер повертає:

```json
{
  "status": "ok",
  "ingestion": {
    "status": "stored",
    "duplicate": false,
    "state_updated": false,
    "ordering_reason": "older_sent_at"
  }
}
```

`status = stored` означає, що пакет потрапив до історії.

`state_updated = false` означає, що current snapshot залишився новішим.

## Міграція

Міграція:

```text
20260924_0003_telemetry_ordering
```

додає `device_states.last_sequence` і заповнює його для існуючих snapshot на основі пов'язаного telemetry message.

## Обмеження v1

`sent_at` формує сам контролер, тому його годинник має бути синхронізований.

У майбутньому для складніших сценаріїв reboot/offline-buffering можна додати окремий boot/session marker. Поточна версія вже захищає основний сценарій out-of-order доставки та не дозволяє старому пакету відкотити current state.

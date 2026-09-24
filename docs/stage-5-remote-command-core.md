# V3.5 — Етап 5
## Remote Command Core

**Статус:** у роботі

Етап 5 починає зворотний канал керування TechBaza:

```text
API / UI
   ↓
Backend
   ↓
PostgreSQL durable command
   ↓
MQTT
   ↓
ESP32
   ↓
RS485 / Modbus
   ↓
VFD
```

## План операцій

```text
Операція 1 — Durable Command Queue          ← у роботі
Операція 2 — MQTT Command Publisher
Операція 3 — Command ACK
Операція 4 — Command Result
Операція 5 — Command Reliability
Операція 6 — End-to-End Command Test
```

## Definition of Done Етапу 5

Етап вважається завершеним, коли одна команда проходить повний контрольований lifecycle:

```text
API request
   ↓
queued
   ↓
published
   ↓
ESP32 received
   ↓
acknowledged
   ↓
executed / rejected
   ↓
succeeded / failed
   ↓
result available through API
```

Також мають бути перевірені:

- TTL / expired;
- HTTP retry idempotency;
- MQTT duplicate delivery;
- duplicate ACK;
- unknown command;
- offline Device;
- втрачений ACK;
- помилка виконання;
- audit trail у PostgreSQL.

Деталі Операції 1: [Command Core v1](command-core-v1.md).

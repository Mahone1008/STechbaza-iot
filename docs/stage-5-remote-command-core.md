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
Операція 1 — Durable Command Queue          ✅ завершено
Операція 2 — MQTT Command Publisher         ← у роботі
Операція 3 — Command ACK
Операція 4 — Command Result
Операція 5 — Command Reliability
Операція 6 — End-to-End Command Test
```

## Операція 1 — перевірено реально

```text
valid command 45 Hz → 201 Created                         ✅
same request_id + same payload → 200 / same command       ✅
same request_id + different payload → 409 Conflict        ✅
PostgreSQL contains exactly one row                       ✅
150 Hz outside protocol range → 422                       ✅
invalid command not inserted                              ✅
```

Durable queue використовує:

- server-side `command_id`;
- client-side `request_id`;
- capability check;
- TTL;
- `expires_at`;
- lifecycle status;
- audit fields.

## Операція 2 — поточна ціль

```text
queued command
      ↓
MQTT CommandEnvelope v1
      ↓
QoS 1 / retain=false
      ↓
techbaza/devices/{device_uid}/commands
      ↓
test subscriber / ESP32
      ↓
status = published
```

Деталі MQTT contract: [MQTT Command Protocol v1](mqtt-command-protocol-v1.md).

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

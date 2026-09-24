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
Операція 2 — MQTT Command Publisher         ✅ завершено
Операція 3 — Command ACK                     ✅ завершено
Операція 4 — Command Result                  ✅ завершено
Операція 5 — Command Reliability             ← у роботі
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

## Операція 2 — перевірено реально

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

Перевірено локально:

```text
Backend 0.14.0                                         ✅
POST command → status published                       ✅
published_at set                                       ✅
Mosquitto subscriber реально отримав CommandEnvelope   ✅
QoS 1                                                  ✅
retain=false                                           ✅
HTTP retry не викликав повторний MQTT publish          ✅
новий subscriber після reconnect не отримав стару command ✅
```

## Операція 3 — Command ACK

Перевірено реально:

```text
published command
      ↓
ESP32 / simulator отримав command
      ↓
techbaza/devices/{device_uid}/commands/ack
      ↓
Backend validation
      ↓
status = acknowledged
acknowledged_at = server UTC time
```

Деталі ACK contract: [MQTT Command ACK Protocol v1](mqtt-command-ack-v1.md).

```text
published command → ACK → acknowledged              ✅
acknowledged_at записано server-side                  ✅
completed_at залишився null                           ✅
duplicate ACK → duplicate / command_updated=false     ✅
duplicate ACK не переписав acknowledged_at            ✅
unknown command_id → rejected / unknown_command       ✅
```

## Операція 4 — Command Result

Перевірено реально:

```text
acknowledged command
      ↓
Device виконав або відхилив дію
      ↓
techbaza/devices/{device_uid}/commands/result
      ↓
Backend validation
      ↓
succeeded / failed
      ↓
completed_at + result/error
```

Деталі Result contract: [MQTT Command Result Protocol v1](mqtt-command-result-v1.md).

```text
acknowledged → succeeded                                  ✅
completed_at + result записані                            ✅
duplicate Result → already_completed                      ✅
duplicate Result не переписав completed_at                ✅
succeeded → conflicting failed → terminal_result_conflict ✅
acknowledged → failed                                     ✅
error_code/error_message збережені                        ✅
failed без error_code → invalid_payload                   ✅
```

Примітка тестового середовища: Windows PowerShell pipe може пошкоджувати non-ASCII текст під час `docker exec`. Це не змінює MQTT/JSON contract; для console test messages краще використовувати ASCII.

## Операція 5 — Command Reliability

Поточна ціль:

```text
offline Device → queued
online before TTL → publish
published without ACK → safe retry with same command_id
TTL elapsed → expired
late ACK → rejected
ACK received → retry stops
```

Деталі: [Command Reliability v1](command-reliability-v1.md).

Перевірено локально:

```text
Device availability → online=false                         ✅
POST command while offline → status=queued                ✅
published_at=null                                          ✅
publish_attempts=0                                         ✅
reliability worker → candidate_count=1                     ✅
reliability worker → reason=device_offline                 ✅
queued offline command → expired після TTL                 ✅
completed_at заповнено                                      ✅
error_code=command_expired                                  ✅
heartbeat повернув Device online                            ✅
queued command автоматично опублікована без нового POST     ✅
без ACK worker повторно доставляв той самий command_id      ✅
publish_attempts=9 до завершення TTL                         ✅
після retry без ACK command автоматично стала expired        ✅
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

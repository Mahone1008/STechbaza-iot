# End-to-End Command Test v1

## Мета

Операція 6 завершує Етап 5 одним контрольованим тестом повного server-side lifecycle Remote Command Core.

Тест перевіряє:

```text
HTTP API
  ↓
PostgreSQL durable command
  ↓
MQTT publish
  ↓
Device simulator
  ↓
ACK
  ↓
Command Result
  ↓
PostgreSQL final state
  ↓
GET Command API
```

## Чому використовується Device simulator

На цьому етапі перевіряється саме Remote Command Core backend-рівня.

Simulator поводиться як мінімальний edge-контролер:

- підписується на command topic;
- відправляє heartbeat і переводить Device в online;
- перевіряє `expires_at`;
- дедуплікує фізичне виконання за `command_id`;
- відправляє ACK;
- відправляє final Result;
- після однієї command завершує роботу.

Фізичний ланцюг:

```text
ESP32 → RS485 → Modbus → VFD
```

має інтегруватися окремо поверх цього contract.

## Запуск simulator

Після оновлення/rebuild backend:

```powershell
docker compose exec backend python -m app.tools.command_e2e_simulator --device-uid TB-ESP32-001 --outcome succeeded
```

Очікування:

```text
[START] ...
[READY] Device simulator subscribed: techbaza/devices/TB-ESP32-001/commands
[HEARTBEAT] Device online: TB-ESP32-001
```

Після створення нової command simulator повинен показати:

```text
[RECEIVED] command_id=...
[ACK] command_id=...
[RESULT] command_id=... status=succeeded
```

## Success scenario

Приклад request:

```json
{
  "request_id": "dddddddd-eeee-4fff-8000-333333333333",
  "command_type": "vfd.frequency.set",
  "payload": {
    "frequency_hz": 37
  },
  "ttl_seconds": 300
}
```

Фінальний стан:

```text
status = succeeded
published_at != null
acknowledged_at != null
completed_at != null
result.frequency_hz = 37
error_code = null
```

## Failed scenario

Simulator також підтримує:

```powershell
docker compose exec backend python -m app.tools.command_e2e_simulator --device-uid TB-ESP32-001 --outcome failed
```

Очікуваний final state:

```text
status = failed
acknowledged_at != null
completed_at != null
error_code = simulated_execution_failed
```

## Device-side safety semantics

Simulator спеціально перевіряє `expires_at` до виконання.

Також він зберігає set уже оброблених `command_id` протягом своєї session і не виконує одну command фізично повторно при MQTT retry.

Production ESP32 firmware повинен реалізувати той самий принцип, але з persistence/boot-session semantics, достатніми для реального контролера.

## Definition of Done

Операція 6 завершується, коли хоча б один success E2E тест проходить повністю:

```text
POST
→ published
→ simulator received
→ ACK
→ acknowledged
→ Result
→ succeeded
→ final state доступний через API
```

Після цього Етап 5 — Remote Command Core може бути закритий.


## Фактичний результат перевірки

**Дата:** 2026-09-24  
**Статус:** пройдено ✅

Контрольна command:

```text
command_id = ad55d377-0468-41b6-a4e3-5e1e3a0ab1b0
command_type = vfd.frequency.set
frequency_hz = 37
ttl_seconds = 300
```

Simulator:

```text
[RECEIVED] ✅
[ACK] ✅
[RESULT] status=succeeded ✅
```

Фінальний API state:

```text
status = succeeded
published_at != null
publish_attempts = 1
last_publish_error = null
acknowledged_at != null
completed_at != null
result.frequency_hz = 37
error_code = null
error_message = null
```

Definition of Done виконано.

```text
Операція 6 — End-to-End Command Test ✅
Етап 5 — Remote Command Core ✅
```

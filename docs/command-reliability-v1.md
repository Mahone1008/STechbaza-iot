# Command Reliability v1

## Мета

Операція 5 робить Remote Command Core стійким до:

- offline Device;
- тимчасово недоступного MQTT broker;
- втрати ACK;
- повторної MQTT доставки;
- завершення TTL;
- race condition між retry, ACK та Result.

## Ключова модель

Transport працює як:

```text
at-least-once delivery
+
command_id deduplication
+
durable PostgreSQL lifecycle
```

Система навмисно не обіцяє "exactly once" на транспортному рівні.

## Offline gating

Перед MQTT publish backend перевіряє актуальний Device availability через `last_seen_at`.

Якщо Device offline:

```text
command = queued
MQTT publish = не виконується
```

Команда залишається durable у PostgreSQL.

Якщо Device повернувся online до `expires_at`, reliability worker може її опублікувати.

## Retry після втрати ACK

Після успішного broker publish:

```text
status = published
```

Якщо ACK не надійшов, reliability worker повторює **той самий CommandEnvelope з тим самим command_id**.

Default interval:

```text
10 секунд
```

Device зобов'язаний дедуплікувати команду за `command_id`.

## Delivery metadata

До `device_commands` додано:

```text
publish_attempts
last_publish_attempt_at
last_publish_error
```

Вони дозволяють бачити фактичну історію delivery attempts.

## TTL semantics

У V3.5 TTL означає deadline, до якого Device має прийняти command.

Для станів:

```text
queued
published
```

після `expires_at`:

```text
status = expired
completed_at = server UTC time
error_code = command_expired
```

Після успішного ACK:

```text
status = acknowledged
```

command уже була прийнята вчасно, тому її локальне виконання може завершитися пізніше.

Edge-контролер також зобов'язаний перевіряти `expires_at` до початку небезпечної фізичної дії.

## Late ACK

ACK після deadline не може оживити command:

```text
published + expired deadline
        ↓
late ACK
        ↓
rejected / command_expired
```

## Result без ACK

Result може бути прийнятий напряму з `published`, якщо він надійшов до deadline. Це дозволяє пережити втрату окремого ACK.

У такому випадку backend заповнює `acknowledged_at` implicit-значенням server receipt time.

Якщо Result уперше підтверджує command вже після deadline, він відхиляється як `command_expired`.

Якщо ACK був прийнятий вчасно, Result може завершитися після `expires_at`.

## Row-level locking

Command lifecycle transitions використовують PostgreSQL row lock.

Це серіалізує конкурентні події:

```text
retry publisher
ACK
Result
expiry
```

і не дозволяє двом потокам одночасно неконсистентно переписати одну command.

## Reliability worker

Backend 0.17.0 запускає lightweight worker.

Default:

```text
poll = 2 s
retry interval = 10 s
batch size = 100
```

Worker обробляє:

```text
queued
published
```

і виконує:

- expire due commands;
- publish queued commands, якщо Device online;
- retry published commands без ACK;
- не чіпає acknowledged/succeeded/failed.

Diagnostics:

```text
GET /command/reliability/status
```

## Production note

Поточний worker працює всередині одного backend process і підходить для V3.5/local deployment.

Для production horizontal scaling цей механізм треба винести у dedicated worker/outbox architecture або додати distributed coordination.

Це свідомо зафіксоване обмеження, а не прихована залежність.

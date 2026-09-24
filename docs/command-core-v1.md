# Command Core v1

## Мета

**V3.5 — Етап 5: Remote Command Core** починає зворотний канал керування:

```text
UI / API
   ↓
Backend
   ↓
device_commands
   ↓
MQTT commands
   ↓
ESP32
   ↓
ACK / result
```

Операція 1 реалізує durable-реєстрацію команди в PostgreSQL. MQTT-публікація та ACK будуть наступними операціями.

## Операція 1 — Durable Command Queue

Команда не повинна існувати лише як короткочасний HTTP/MQTT виклик.

Спочатку backend створює durable record:

```text
POST command
   ↓
валідація Device
   ↓
валідація capability
   ↓
валідація command payload
   ↓
idempotency check
   ↓
PostgreSQL
   ↓
status = queued
```

## Чому PostgreSQL стоїть перед MQTT

Небезпечно будувати:

```text
HTTP → MQTT
```

без durable record.

Якщо backend впаде в невдалий момент, система може втратити audit trail і не знати, чи команда взагалі існувала.

Тому спочатку створюється запис у `device_commands`, а MQTT delivery виконується окремим шаром.

## Таблиця device_commands

Основні поля:

- `id` — server-side command_id;
- `request_id` — client-side UUID для ідемпотентності HTTP retry;
- `device_id` — цільовий Device;
- `command_type` — тип команди;
- `payload` — параметри;
- `status` — lifecycle;
- `ttl_seconds` — дозволений строк життя;
- `expires_at` — абсолютний deadline;
- `published_at` — майбутній час MQTT publish;
- `acknowledged_at` — майбутній час ACK;
- `completed_at` — майбутній час завершення;
- `result` — структурований результат;
- `error_code` / `error_message` — причина відмови.

## Початкові command types

```text
vfd.start
vfd.stop
vfd.frequency.set
```

Усі вони наразі вимагають:

```text
vfd.control
```

## TTL

Допустимий `ttl_seconds`:

```text
5..300 секунд
```

Default:

```text
30 секунд
```

Це захист від небезпечного сценарію:

```text
користувач натиснув START
        ↓
мережа зникла
        ↓
через багато хвилин зв'язок повернувся
        ↓
стара команда НЕ повинна раптово виконатися
```

## HTTP idempotency

Клієнт генерує `request_id` до POST.

Перший запит:

```text
request_id = X
→ 201 Created
→ створено один command_id
```

Повтор того самого запиту з тим самим `request_id`:

```text
request_id = X
same Device/type/payload/TTL
→ 200 OK
→ повертається той самий command
→ другий command НЕ створюється
```

Якщо той самий `request_id` повторно використано для іншої команди:

```text
→ 409 Conflict
```

Унікальний DB index додатково захищає від двох одночасних однакових POST.

## Frequency payload

`vfd.frequency.set`:

```json
{
  "frequency_hz": 45.0
}
```

Поточна перевірка:

```text
0..100 Hz
```

Це лише protocol guardrail. Реальні min/max конкретного VFD пізніше повинні братися з конфігурації установки.

## API

Створити command:

```text
POST /api/v1/devices/{device_id}/commands
```

Перелік commands Device:

```text
GET /api/v1/devices/{device_id}/commands
```

Одна command:

```text
GET /api/v1/commands/{command_id}
```

## Lifecycle

На Операції 1:

```text
queued
```

Наступні операції додадуть:

```text
queued
  ↓
published
  ↓
acknowledged
  ↓
succeeded / failed
```

Окремо буде:

```text
expired
```

коли TTL закінчився.

## Safety principle

Remote command — це **запит на дію**, а не право обходити фізичні захисти.

Backend не повинен скасовувати:

- аварійний стоп;
- локальний safety interlock;
- сухий хід;
- fault VFD;
- інші апаратні/локальні заборони.

Фінальне безпечне рішення про виконання має залишатися на edge-рівні.

# Command Core v1

## Мета

Етап 7 починає зворотний канал керування:

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

Операція 1 реалізує тільки надійне створення та зберігання команди. MQTT-публікація та ACK будуть наступними операціями.

## Чому команда спочатку потрапляє в PostgreSQL

Небезпечно робити HTTP → MQTT напряму без durable record. Якщо backend впаде між запитом і публікацією, ми можемо втратити інформацію про те, що користувач намагався виконати.

Тому кожна команда спочатку отримує server-side UUID і status `queued`.

## Таблиця device_commands

Основні поля:

- `id` — command_id;
- `device_id` — цільовий Device;
- `command_type` — тип команди;
- `payload` — параметри;
- `status` — lifecycle;
- `expires_at` — коли команда стає простроченою;
- `published_at` — коли команда реально пішла в MQTT;
- `acknowledged_at` — коли ESP32 підтвердив отримання;
- `completed_at` — коли команда завершена;
- `result` — структурований результат;
- `error_code` / `error_message` — причина відмови або помилки.

## Початкові типи команд

```text
vfd.start
vfd.stop
vfd.frequency.set
```

Усі вони в поточній версії вимагають capability:

```text
vfd.control
```

## TTL

Команда створюється з `ttl_seconds` від 5 до 300 секунд. За замовчуванням — 30 секунд.

Короткий TTL потрібен, щоб команда, створена під час проблем зі зв'язком, не виконалась через багато хвилин після відновлення мережі.

## Frequency payload

`vfd.frequency.set` приймає:

```json
{
  "frequency_hz": 45.0
}
```

Поточна перевірка 0..100 Hz є лише протокольним guardrail. Реальні min/max конкретної установки пізніше повинні братися з конфігурації Device/VFD.

## API

Створити команду:

```text
POST /api/v1/devices/{device_id}/commands
```

Перелік команд Device:

```text
GET /api/v1/devices/{device_id}/commands
```

Прочитати одну команду:

```text
GET /api/v1/commands/{command_id}
```

## Поточний lifecycle

На Операції 1:

```text
queued
```

У наступних операціях буде:

```text
queued
  ↓
published
  ↓
acknowledged
  ↓
succeeded / failed
```

Також буде `expired`, якщо TTL вийшов до безпечного виконання.

## Safety principle

Backend-команда не повинна обходити локальні захисти VFD, аварійний стоп, сухий хід та інші safety interlocks. Хмарний command channel — це запит на дію, а не право ігнорувати фізичну безпеку.

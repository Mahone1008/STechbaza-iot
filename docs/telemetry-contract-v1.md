# Telemetry Contract v1

Цей документ фіксує перший стабільний контракт телеметрії TechBaza.

## 1. Мета

Контракт визначає, як польовий контролер передає телеметрію до backend через MQTT.

Цільовий шлях:

```text
ESP32
  ↓ MQTT
Mosquitto
  ↓
Backend
  ↓
валідація
  ↓
PostgreSQL
  ├── telemetry_messages — історія
  └── device_states      — останній стан
```

## 2. MQTT topic

Для телеметрії використовуємо:

```text
techbaza/devices/{device_uid}/telemetry
```

Приклад:

```text
techbaza/devices/TB-ESP32-001/telemetry
```

У topic використовується стабільний `Device.uid`, а не внутрішній UUID PostgreSQL.

Причина: фізичний контролер повинен знати власний технічний UID, але не зобов'язаний знати внутрішній ідентифікатор запису в базі.

## 3. Payload v1

Приклад:

```json
{
  "schema_version": 1,
  "message_id": "1c7f37a3-5b3b-4e4f-a743-96b9b94aa001",
  "sent_at": "2026-09-24T08:30:00Z",
  "sequence": 123,
  "values": {
    "vfd.frequency_hz": 42.5,
    "vfd.current_a": 18.3,
    "pressure.bar": 4.2
  },
  "state": {
    "pump_running": true,
    "vfd_fault_code": null
  }
}
```

## 4. Поля envelope

### schema_version

Версія контракту повідомлення.

Потрібна для того, щоб у майбутньому backend міг підтримувати старі та нові версії формату без прихованої несумісності.

### message_id

Глобально унікальний UUID повідомлення.

Backend використовує його для idempotency: повторна доставка того самого MQTT-пакета не повинна створювати дубль в історії.

### sent_at

Час формування пакета на контролері.

Цей час не можна вважати абсолютно достовірним, тому backend окремо фіксує власний `received_at`.

### sequence

Монотонний локальний номер пакета в межах робочої сесії контролера.

`message_id` відповідає за idempotency, а `sequence` разом із `sent_at` допомагає визначити порядок різних пакетів і не дозволити старому пакету відкотити current state.

### values

Числові або інші вимірювані значення.

Приклади:

```text
vfd.frequency_hz
vfd.current_a
pressure.bar
water_level.percent
```

### state

Дискретний або логічний стан пристрою.

Приклади:

```text
pump_running
vfd_fault_code
local_mode
emergency_stop
```

## 5. Два рівні зберігання

Телеметрія зберігається у двох формах.

### telemetry_messages

Append-only історія валідних пакетів.

Вона потрібна для:

- графіків;
- діагностики;
- розслідування аварій;
- історії роботи;
- майбутньої аналітики.

### device_states

Один актуальний snapshot на кожен Device.

Він потрібен для швидкої відповіді frontend:

```text
Який стан пристрою зараз?
```

Без необхідності щоразу шукати останній запис у великій історії.

## 6. Online / offline

Поле `online = true/false` навмисно не зберігається як постійна істина.

Online-стан залежить від часу:

```text
now - last_seen_at <= timeout
        ↓
      online
```

Якщо пристрій перестав надсилати дані, старе значення `online=true` у базі стало б неправильним.

Тому `devices.last_seen_at` надалі оновлюватиметься при валідному heartbeat/telemetry, а online/offline буде обчислюватися за timeout.

## 7. Capability-aware processing

Backend перевіряє telemetry keys проти активних DeviceCapability конкретного пристрою.

```text
Device UID
   ↓
активні DeviceCapability
   ↓
telemetry key → required capability
   ↓
дозволено → продовжуємо ingestion
немає capability → rejected
```

Це зберігає модульний принцип TechBaza.

## 8. Поточна схема БД

Після міграції `20260924_0002` додаються:

```text
telemetry_messages
device_states
```

Схема:

```text
Device
  ├── telemetry_messages  1:N
  └── device_states       1:1
```

## 9. Важливе правило

`received_at` — серверний час прийому і є основною часовою опорою для серверної діагностики.

`sent_at` — час, заявлений пристроєм, і використовується як корисний контекст, але контролер може мати неправильний годинник.


## 10. Out-of-order protection

Валідний пакет із новим `message_id` завжди може бути корисним для історії, але не кожен пакет має право переписати current state.

Backend порівнює `sent_at` та `sequence` з останнім snapshot:

```text
новіший пакет
→ history + current state

старіший пакет
→ history only
```

Детальні правила описані в `docs/telemetry-ordering-v1.md`.

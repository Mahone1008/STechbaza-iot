# Досьє V3.5 — Етап 5
## Telemetry Reliability: heartbeat, online/offline та захист від stale/out-of-order даних

**Статус:** завершено  
**Версія:** V3.5  
**Етап:** 5  
**Мета етапу:** зробити telemetry-контур TechBaza стійкішим до реальних проблем польового 4G-зв'язку: мовчання контролера, затримок мережі та доставки пакетів у неправильному порядку.

---

# 1. Підсумок етапу

Етап 4 довів, що TechBaza може приймати й зберігати телеметрію.

Етап 5 відповів на два production-питання:

```text
1. Як зрозуміти, що контролер зараз доступний?
2. Що робити, якщо старий MQTT-пакет прийшов після нового?
```

Було реалізовано:

```text
Heartbeat
Online / Offline calculation
last_seen_at
90-second availability timeout
stale telemetry protection
out-of-order protection
history/current-state separation
last_sequence
ordering diagnostics
```

---

# 2. Чому одного telemetry stream недостатньо для online/offline

У стабільній системі значення можуть довго не змінюватися.

Наприклад:

```text
VFD frequency = 47.5 Hz
pump_running = true
```

Немає сенсу щосекунди записувати однаковий telemetry message лише для підтвердження, що ESP32 живий.

Тому availability винесено в окремий lightweight heartbeat.

---

# 3. MQTT heartbeat topic

Backend підписаний на:

```text
techbaza/devices/+/heartbeat
```

Для тестового пристрою:

```text
techbaza/devices/TB-ESP32-001/heartbeat
```

Heartbeat не несе повну телеметрію.

Його завдання:

```text
"Контролер живий, має зв'язок і backend бачить його зараз"
```

---

# 4. Heartbeat Contract v1

Тестовий payload:

```json
{
  "schema_version": 1,
  "message_id": "UUID",
  "sent_at": "2026-09-24T09:20:57Z",
  "sequence": 10
}
```

Після прийому backend:

1. перевіряє JSON;
2. перевіряє Device UID;
3. оновлює `devices.last_seen_at`;
4. записує діагностичний результат heartbeat.

---

# 5. Heartbeat diagnostics

Endpoint:

```text
GET /mqtt/heartbeat/last
```

Реально підтверджений результат:

```text
status = accepted
device_uid = TB-ESP32-001
sequence = 10
seen_at = server timestamp
```

Це довело, що heartbeat проходить:

```text
publisher
   ↓
Mosquitto
   ↓
Backend
   ↓
Device lookup
   ↓
last_seen_at
```

---

# 6. Чому online не зберігається як boolean

Поганий варіант:

```text
online = true
```

у базі.

Якщо контролер раптово зникне, це значення може назавжди залишитися `true`.

Тому TechBaza використовує derived state:

```text
now - last_seen_at <= timeout
        ↓
      ONLINE
```

і:

```text
now - last_seen_at > timeout
        ↓
      OFFLINE
```

---

# 7. Availability timeout

На етапі 5 встановлено:

```text
DEVICE_ONLINE_TIMEOUT_SECONDS = 90
```

Це конфігураційне значення environment, а не жорстко зашита бізнес-константа в UI.

---

# 8. Availability API

Endpoint:

```text
GET /api/v1/devices/{device_id}/availability
```

Відповідь містить:

```text
device_id
uid
online
last_seen_at
timeout_seconds
seconds_since_seen
```

---

# 9. Реальний ONLINE test

Одразу після heartbeat API повернув приблизно:

```text
online = true
timeout_seconds = 90
seconds_since_seen ≈ 19.8
```

Тобто:

```text
19.8 sec < 90 sec
      ↓
    ONLINE
```

---

# 10. Реальний OFFLINE test

Після припинення heartbeat було зачекано більше 90 секунд.

API повернув:

```text
online = false
timeout_seconds = 90
seconds_since_seen ≈ 192.45
```

Тобто:

```text
192.45 sec > 90 sec
        ↓
      OFFLINE
```

При цьому `last_seen_at` залишився в базі.

Система пам'ятає, коли пристрій був доступний востаннє.

---

# 11. Важливе розділення станів

TechBaza не змішує:

```text
online/offline
pump_running
VFD fault
lifecycle_status
```

Це різні поняття.

Приклади:

```text
Controller online + Pump running
Controller online + Pump stopped
Controller online + VFD fault
Controller offline
```

Одне не повинно автоматично означати інше.

---

# 12. Проблема out-of-order доставки

Мобільна мережа може змінити фактичний порядок доставки.

Приклад:

```text
ESP32 створив:
sequence 100 → 50 Hz
sequence 101 → 47 Hz

backend може отримати:
101
100
```

Якщо просто оновлювати current state кожним прийнятим пакетом, система може відкотитися назад.

---

# 13. Міграція telemetry ordering

Для ordering було додано міграцію:

```text
20260924_0003
```

Вона додала:

```text
device_states.last_sequence
```

Після застосування:

```text
alembic_version = 20260924_0003
```

було реально підтверджено через PostgreSQL.

---

# 14. Ordering metadata

Для current state тепер зберігаються:

```text
last_sequence
last_reported_at
last_received_at
```

Ці поля мають різний сенс.

## last_sequence

Останній sequence, який сформував current state.

## last_reported_at

Час, який повідомив контролер.

## last_received_at

Час, коли backend реально отримав пакет.

---

# 15. History і current state мають різні правила

Ключовий принцип Етапу 5:

```text
новий валідний message_id
        │
        ├── telemetry_messages
        │      ↓
        │   зберегти
        │
        └── ordering policy
                │
         ┌──────┴──────┐
         ↓             ↓
      newer          stale
         ↓             ↓
 update state      history only
```

Тобто stale пакет не втрачається.

Він просто не має права переписати current snapshot.

---

# 16. Позитивний ordering test

Було створено актуальний пакет:

```text
sequence = 100
vfd.frequency_hz = 50.0
pump_running = true
```

Backend відповів:

```text
status = stored
duplicate = false
state_updated = true
ordering_reason = newer_sent_at
```

Current state став:

```text
last_sequence = 100
frequency = 50
pump_running = true
```

---

# 17. Негативний stale test

Після цього було спеціально надіслано інший валідний пакет:

```text
new message_id
sequence = 99
sent_at = приблизно на 5 хвилин старіше
vfd.frequency_hz = 12.5
pump_running = false
```

Це НЕ duplicate, тому що `message_id` інший.

Backend відповів:

```text
status = stored
duplicate = false
state_updated = false
ordering_reason = older_sent_at
```

---

# 18. Що сталося з stale пакетом

Пакет:

```text
12.5 Hz
sequence 99
pump_running false
```

потрапив у:

```text
telemetry_messages ✅
```

але не змінив:

```text
device_states ✅
```

Current state залишився:

```text
sequence 100
50 Hz
pump_running true
```

---

# 19. Реально підтверджена історія

Endpoint:

```text
GET /api/v1/devices/{device_id}/telemetry
```

показав одночасно:

```text
sequence 99  → 12.5 Hz → false
sequence 100 → 50.0 Hz → true
sequence 2   → 47.5 Hz → true
sequence 1   → 42.5 Hz → true
```

Тобто history не втрачає out-of-order пакет.

---

# 20. Реально підтверджений current state

Endpoint:

```text
GET /api/v1/devices/{device_id}/state
```

після stale пакета все одно повернув:

```text
last_sequence = 100
vfd.frequency_hz = 50
pump_running = true
```

Це ключовий доказ правильності ordering policy.

---

# 21. Чому /telemetry може показувати stale message першим

History endpoint сортується за:

```text
received_at DESC
```

Старий фізичний пакет був відправлений у тесті пізніше, тому backend реально отримав його пізніше.

Через це:

```text
received_at
```

може бути новішим, хоча:

```text
sent_at
```

старіший.

Це не помилка.

---

# 22. sent_at vs received_at

```text
sent_at
→ коли контролер сформував фізичний стан

received_at
→ коли сервер отримав повідомлення
```

Для графіка процесу часто важливий `sent_at`.

Для діагностики 4G і затримок дуже важливий `received_at`.

TechBaza зберігає обидва.

---

# 23. Відмінність duplicate і stale

## Duplicate

```text
той самий message_id
```

Результат:

```text
новий history row не створюється
current state не змінюється
```

## Stale / out-of-order

```text
новий message_id
але пакет старіший
```

Результат:

```text
history row створюється
current state не змінюється
```

Це принципово різні ситуації.

---

# 24. Presence + telemetry разом

Після Етапу 5 модель стала такою:

```text
                     Device
                       │
        ┌──────────────┼───────────────┐
        │              │               │
        ▼              ▼               ▼
   heartbeat       telemetry      capabilities
        │              │               │
        ▼              ▼               ▼
  last_seen_at      history        validation
        │              │
        ▼              ▼
 online/offline    ordering
                       │
                       ▼
                  current state
```

---

# 25. Основні файли реалізації

Presence:

```text
backend/app/schemas/heartbeat.py
backend/app/services/device_presence.py
backend/app/api/v1/devices.py
backend/app/mqtt_client.py
```

Ordering:

```text
backend/app/services/telemetry_ordering.py
backend/app/services/telemetry.py
backend/app/repositories/telemetry.py
backend/app/models/telemetry.py
```

Міграція:

```text
backend/alembic/versions/20260924_0003_telemetry_ordering.py
```

Документація:

```text
docs/device-presence-v1.md
docs/telemetry-ordering-v1.md
docs/telemetry-ingestion-local-test.md
```

---

# 26. Перевірені failure scenarios

На момент завершення Етапу 5 реально перевірено:

```text
heartbeat accepted                         ✅
last_seen_at updated                       ✅
device online after heartbeat              ✅
device offline after timeout               ✅
offline without manual flag                ✅

new telemetry updates state                ✅
older telemetry stored in history          ✅
older telemetry does not rollback state    ✅
last_sequence remains newest               ✅
history preserves out-of-order packet      ✅
```

Разом із попереднім етапом уже перевірено:

```text
invalid JSON → rejected                    ✅
duplicate message_id → duplicate           ✅
missing capability → rejected              ✅
out-of-order → history only                ✅
heartbeat timeout → offline                ✅
```

---

# 27. Що ще не вирішував Етап 5

Є важливий граничний сценарій:

```text
sequence 853
   ↓
ESP32 reboot
   ↓
sequence 0
```

Простого sequence недостатньо, щоб відрізнити:

- старий пакет;
- новий boot контролера.

Тому наступний етап повинен додати boot/session identity.

---

# 28. Наступний логічний етап

Рекомендована назва:

**V3.5 — Етап 6. Reboot / Session Protection**

Ідея:

```text
message_id
→ унікальність конкретного пакета

session_id
→ унікальність конкретного boot

sequence
→ порядок пакетів усередині boot
```

Це дозволить правильно обробити:

```text
Session A / sequence 853
        ↓ reboot
Session B / sequence 0
```

і не переплутати новий запуск зі старою телеметрією.

---

# 29. Підсумок

Етап 5 зробив telemetry pipeline значно ближчим до реальної польової IoT-системи.

TechBaza тепер вміє:

- розуміти, чи доступний контролер;
- автоматично переводити його в offline;
- не залежати від збереженого `online=true`;
- зберігати серверний час останнього контакту;
- переживати out-of-order MQTT delivery;
- зберігати stale пакет для історії;
- не дозволяти stale пакету зіпсувати current state.

Це фундамент для роботи через нестабільний 4G-зв'язок у полі.

**V3.5 — Етап 5 завершено.**

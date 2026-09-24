# Досьє V3.5 — Етап 6
## Reboot / Session Protection

**Статус:** завершено
**Версія:** V3.5
**Етап:** 6
**Мета:** навчити backend відрізняти старий пакет від нового запуску ESP32 після reboot.

# 1. Проблема

До цього ordering використовував `sent_at` і `sequence`. Але після перезавантаження ESP32 sequence може початися з нуля:

```text
Session A: sequence 500
        ↓ reboot
Session B: sequence 0
```

Без boot identity сервер міг би помилково вважати `0` старішим за `500`.

# 2. Рішення

Додано `session_id` — UUID одного запуску контролера.

```text
message_id → конкретний MQTT-пакет
session_id → конкретний boot ESP32
sequence   → порядок пакетів усередині boot
```

Новий firmware повинен створювати один `session_id` під час старту і використовувати його до наступного reboot.

# 3. Зміни БД

Міграція:

```text
20260924_0004
```

додала:

- `telemetry_messages.session_id`;
- `device_states.last_session_id`;
- індекс `(device_id, session_id)`.

# 4. Session-aware ordering

Якщо incoming session дорівнює current session, головним порядком є `sequence`.

Якщо incoming session нова і backend її раніше не бачив — це новий boot.

Якщо current state уже перейшов на нову session, а з мережевого буфера повернулась стара session — пакет зберігається в history, але current state не змінюється.

# 5. Backward compatibility

`session_id` залишено nullable, щоб старі тестові payload не перестали працювати миттєво.

Перший session-aware пакет після legacy snapshot дає:

```text
ordering_reason = session_tracking_initialized
```

Після цього legacy telemetry без `session_id` не має права переписувати session-aware current state.

# 6. Реально перевірений перехід Legacy → Session A

Було надіслано:

```text
Session A
sequence = 500
vfd.frequency_hz = 55
pump_running = true
```

Backend повернув:

```text
status = stored
state_updated = true
ordering_reason = session_tracking_initialized
```

Current state підтвердив:

```text
last_session_id = Session A
last_sequence = 500
vfd.frequency_hz = 55
pump_running = true
```

# 7. Реально перевірений reboot

Після цього було створено нову Session B з sequence, який знову почався з нуля:

```text
Session B
sequence = 0
vfd.frequency_hz = 25
pump_running = false
```

Backend повернув:

```text
status = stored
state_updated = true
ordering_reason = new_session
```

Тобто `500 → 0` не було сприйнято як rollback, бо `session_id` змінився.

# 8. Найважливіший тест: повернення старої Session A

Після переходу на Session B було спеціально надіслано новий пакет зі старої Session A:

```text
Session A
sequence = 501
vfd.frequency_hz = 60
pump_running = true
sent_at = свіжий
message_id = новий
```

Тобто пакет мав свіжий timestamp і більший sequence, але належав старому boot.

Backend правильно відповів:

```text
status = stored
duplicate = false
state_updated = false
ordering_reason = old_session_reappeared
```

# 9. Перевірка current state після атаки старою session

Current state залишився на Session B:

```text
last_session_id = Session B
last_sequence = 0
vfd.frequency_hz = 25
pump_running = false
```

Навіть `last_received_at` current snapshot не було переписано старим boot-пакетом.

# 10. Архітектурний результат

```text
Session A / seq 500
        ↓
      REBOOT
        ↓
Session B / seq 0
        ↓
 current state = B
        ↓
пізніше приходить Session A / seq 501
        │
        ├── telemetry history → зберегти
        └── current state     → НЕ змінювати
```

# 11. Повний захисний контур після Етапу 6

```text
invalid JSON
→ rejected

same message_id
→ duplicate

missing capability
→ rejected

stale packet in same session
→ history only

new boot session
→ accepted as current

old session reappears
→ history only

heartbeat timeout
→ offline
```

# 12. Основні файли

```text
backend/app/models/telemetry.py
backend/app/schemas/telemetry.py
backend/app/schemas/heartbeat.py
backend/app/repositories/telemetry.py
backend/app/services/telemetry.py
backend/app/services/telemetry_ordering.py
backend/alembic/versions/20260924_0004_telemetry_sessions.py
docs/telemetry-session-protection-v1.md
docs/telemetry-ordering-v1.md
```

# 13. Підсумок

Етап 6 закрито. TechBaza тепер коректно переживає reboot контролера, reset sequence та запізніле повернення пакетів зі старої boot-session.

**V3.5 — Етап 6 завершено.**

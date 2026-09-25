# Alarm Rule Engine v1

## Призначення

Правила перетворюють актуальні числові показники пристрою на Event та Alarm.
Конфігурація належить конкретному призначенню `DeviceCapability`, тому кожен
пристрій використовує лише встановлені й увімкнені можливості.

## Конфігурація

Правила зберігаються у `device_capabilities.config.alarm_rules`. Приклад для
увімкненої можливості `vfd.frequency.read`:

```json
{
  "alarm_rules": [{
    "rule_key": "vfd.frequency.high",
    "alarm_type": "vfd.frequency.high",
    "metric": "vfd.frequency_hz",
    "source": "values",
    "kind": "high",
    "threshold": 80,
    "clear_threshold": 70,
    "debounce_samples": 2,
    "severity": "warning",
    "title": "High VFD frequency",
    "enabled": true
  }]
}
```

Підтримуються `high` та `low`, джерела `values` і `state`, рівні
`warning` та `critical`. Для `high` поріг зняття має бути нижчим за поріг
спрацювання; для `low` — вищим. `debounce_samples` може бути від 1 до 100.
Схеми призначення/оновлення capability перевіряють конфігурацію, а engine
повторно перевіряє її під час обробки. `rule_key` має бути унікальним серед
увімкнених правил одного пристрою.

## Обробка показників

Для правила вище послідовність така:

| Частота, Гц | Результат |
| ---: | --- |
| 50 | Нормальний стан |
| 85 | Перше перевищення, очікування другого показника |
| 90 | Event та нова active Alarm |
| 92, потім 75 | Та сама Alarm без повторного Event |
| 68 | Перше підтвердження відновлення |
| 65 | Event та перехід Alarm у resolved |
| 85, потім 90 | Новий active інцидент з новим ID |

Зона між `clear_threshold` та `threshold` не перемикає поточний стан
тривоги. Стан очікування зберігається у `device_alarm_rule_states` і переживає
перезапуск backend.

Engine викликається тільки для пакета, який оновлює `DeviceState`. Дубльований
`message_id`, старіший sequence тієї самої session і повторна поява старої
session не змінюють rule state та Alarm. Пакет нової session обробляється за
правилами захисту порядку телеметрії. Неактивна capability забороняє
відповідний показник ще до запису пакета.

## Транзакція

Обробка одного пристрою серіалізується блокуванням рядка Device. Запис
`TelemetryMessage`, поточного `DeviceState`, `DeviceAlarmRuleState`, Event,
Alarm та transition належить одній транзакції. Якщо оцінка правил завершується
помилкою, `TelemetryService` відкочує всі ці зміни.

Локальна перевірка відкату запускається лише для тестового пристрою, у якого
вже є enabled rule та стан правила і немає active Alarm для цього ключа:

```powershell
docker compose exec -T backend python -m app.tools.telemetry_rule_transaction_check --device-uid TB-ESP32-001 --rule-key test.vfd.frequency.high --metric vfd.frequency_hz --value 90
```

Команда тимчасово додає один pending sample у власній транзакції, створює
Event та Alarm під час ingestion, імітує збій після запису до PostgreSQL і
перевіряє відсутність тестового пакета, Event, Alarm та transition, а також
незмінність snapshot і rule state. Успіх виводить `PASS`.

## Перевірка v1

Локально перевірено на PostgreSQL, Mosquitto й backend:

- міграція `20260925_0012` застосована;
- спрацювання, debounce, hysteresis, відновлення й новий інцидент;
- відсутність повторних подій при значеннях, які не змінюють стан;
- дубльований пакет, старий sequence, нова session і стара session після неї;
- відхилення `vfd.frequency_hz` при вимкненій `vfd.frequency.read`;
- відкат усіх записів при примусовій помилці після створення Event та Alarm.

Тестове правило після перевірки вилучено з конфігурації; можливість знову
ввімкнена. Два завершені тестові інциденти залишаються в історії тестової БД.

## Межі

System alarms для offline/reboot/command failure належать наступній операції.
Acknowledge, notifications і UI реалізуються окремо. Автоматичне повторення
MQTT-пакета після помилки БД цією перевіркою не підтверджено; перед
production-використанням потрібна окрема перевірка доставки та повторної
обробки.

# Етап H — коригування backend перед frontend

Дата початку: 27.09.2026 (Europe/Kyiv). Базовий main: `60d5bec`.

Етап 8 завершений у погодженому обсязі. Етап H закриває нові зауваження
аудиту; frontend залишається наступним функціональним Етапом 9.

## План та стан

| Операція | Мета | Стан |
|---|---|---|
| H-01 | Некоректні MQTT packets не блокують потік; transient failure зберігає retry | Код і CI — PASS; очікує приймання користувачем |
| H-02 | Справедливий відбір і повторна доставка команд | Заплановано |
| H-03 | Розділення системних та користувацьких ключів аварій | Заплановано |
| H-04 | Узгодження module/channel контракту перших екранів | Заплановано |
| H-05 | Повна регресія та фіксація прийнятої версії | Заплановано |

Операція закривається після автоматичних перевірок і підтвердження користувача.
Робота виконується без додаткових гілок, невеликими змінами в `main`.

## H-01: проблема

Телеметрія з дуже великим цілим числом проходила envelope validation,
але перетворення на float у rule engine викликало OverflowError. Обробник
сприймав його як transient failure: без ACK, reconnect і повтор тієї самої
помилки. JSON integer за лімітом Python також міг спричинити ValueError
поза наявним catch. Аналогічний parser використовували heartbeat, ACK і result.

## H-01: зміни, backend 0.37.1

- Спільна нормалізація `app.numeric.finite_number` для правил і read model.
- Спільний bounded JSON parser `app.mqtt_payload` для всіх чотирьох ingress-тем.
- Обмеження розміру перевіряється до UTF-8 decode; невалідна кодировка не
  підміняється символом replacement character.
- Глибина перевіряється до recursive JSON parsing; дужки всередині рядків
  та escaped quotes враховуються коректно.
- Відхиляються NaN/Infinity, числа поза finite float range, duplicate keys,
  некоректний JSON, NUL та непарні Unicode surrogates, несумісні з JSONB.
- Sequence телеметрії та heartbeat обмежено nonnegative PostgreSQL BIGINT.
- Невалідний payload відхиляється до DB. Винятки service/DB не потрапляють
  у parser catch: тимчасовий збій усе ще не підтверджується брокеру.
- Діагностика MQTT містить фіксовані лічильники причин і останнє відхилення.
  Warning не містить packet body чи повного Pydantic ValidationError.
- Raw diagnostics зберігають лише preview до 2048 символів; rejected bytes
  до decode не зберігаються. Diagnostics залишаються доступними лише superadmin.

### Межі контракту

| Параметр | Ліміт |
|---|---:|
| MQTT payload | 65 536 bytes |
| Вкладені JSON objects/arrays, включно з root | 16 |
| JSON nodes, включно з ключами та containers | 2048 |
| Довжина JSON string/key | 4096 Unicode characters |
| Sequence | 0 .. 2^63 - 1 |

Це фіксовані межі поточного протоколу, а не налаштування фізичних датчиків.
Обмеження числа ключів у schemas та capability-перевірки збережені.
Нормальний packet, null і boolean state, Unicode та вкладений command result
підтримуються. Перелік capabilities і бізнес-правила команд не змінювалися.

### ACK та відхилення

1. Валідний packet успішно оброблено/commit завершено → MQTT ACK.
2. Постійна помилка формату → rejection reason у log/diagnostics, MQTT ACK,
   packet не записується у telemetry/state і не повертається після reconnect.
3. Тимчасовий service/DB failure → без ACK, reconnect і broker redelivery.

ACK для невалідного packet означає завершення доставки, а не прийняття
телеметрії чи підтвердження фізичної команди. Durable quarantine не додано:
свідомо зберігаємо причину відхилення, а не необмежені довільні дані.
Лічильники діагностики живуть у процесі і обнуляються при restart.

Ліміт у backend не замінює broker-level quotas та автентифікацію пристроїв:
Paho вже отримав network packet до callback. Production TLS/ACL і захист
мережевих ресурсів залишаються окремою експлуатаційною роботою.

## Перевірки

Нові unit/regression перевірки охоплюють boundaries, UTF-8, JSON depth/nodes,
Unicode, duplicate keys, великі числа, всі ingress handlers, порядок commit/ACK,
відсутність payload у warning та збереження retry після service ValueError.

Новий тест із реальними PostgreSQL/Mosquitto:

1. Створює власний випадковий tenant, два пристрої та pressure rule.
2. Надсилає некоректні packets на чотири теми першого пристрою.
3. Перевіряє, що valid telemetry другого пристрою збережена і підняла аварію.
4. Перевіряє відсутність автоматичного reconnect і записів від bad packets.
5. Перепідключає той самий persistent client ID: відхилені packets не повертаються,
   наступна валідна телеметрія знову збережена.
6. Прибирає лише власні fixtures та MQTT session.

Існуючі реальні тести повторної доставки після transient failure та transaction
rollback залишаються в загальному прогоні. `app.tools.backend_check` вимагає
успішного завершення всіх тестів і нуль пропусків. Chromium та demo/recovery
сценарії також залишаються в CI.

Схема БД не змінена: Alembic `20260926_0017`. Backup manifest нової версії —
0.37.1; перевірка bundle також приймає 0.37.0 з тією самою схемою, що покрито
окремою регресією. Версії залежностей не змінені.

## Приймання користувачем

### Підтвердження CI — 27.09.2026

- Код: `f5a1e127d52ed47770ef91ef572ce084f1923dfe`, backend **0.37.1**.
- [GitHub Actions run 36274424609](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36274424609):
  `completed / success`, обидва jobs `hardening` і `demo` успішні.
- **125 backend tests, zero skips**: PostgreSQL, Mosquitto, нова poison-packet
  регресія та збережена повторна доставка після тимчасового збою.
- Chromium: login, HttpOnly cookie, reload/rotation, CSRF/CORS, logout/revocation — PASS.
- Живі demo HTTP/MQTT, restart simulator/backend, broker outage/reconnect — PASS.
- Clean install із tracked source та exact backup/restore — PASS.
- Той самий `scripts/check-stage-h-op1.ps1` виконано у CI PowerShell 7 — PASS;
  перевірене demo успішно оновлено до 0.37.1. Windows-приймання виконує користувач.
- Локальний допоміжний прогін у середовищі розробки: 64 пройдено, 61 пропущено
  без PostgreSQL/MQTT. Це не підміняє наведений повний CI-прогін без пропусків.

### Команда та очікуваний результат

Існуючий `.env.demo` потрібно зберегти. Не генерувати нові demo passwords.
У корені оновленого репозиторію виконати:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage-h-op1.ps1
```

Скрипт будує backend, створює новий випадковий Docker Compose project,
застосовує міграції і запускає весь backend suite з PostgreSQL/MQTT.
Після тестів видаляє лише volumes свого тестового project.

У разі успіху перевірений image переноситься у звичний demo на порту 8001.
Demo backend і simulator коротко перезапускаються; demo volumes, користувачі,
credentials та стан simulator зберігаються. Повторний seed не виконується.
Основний dev backend на порту 8000 цей скрипт не оновлює.

Очікується `PASS: ... backend tests, zero skips`, health `ok / 0.37.1`
та фінальний `PASS: H-01 acceptance; demo 0.37.1 is running...`.

**Локальне приймання користувачем ще не підтверджене. H-01 не закрито.**

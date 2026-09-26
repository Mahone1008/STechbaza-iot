# Етап H — коригування backend перед frontend

Дата початку: 27.09.2026 (Europe/Kyiv). Базовий main: `60d5bec`.

Етап 8 завершений у погодженому обсязі. Етап H закриває нові зауваження
аудиту; frontend залишається наступним функціональним Етапом 9.

## План та стан

| Операція | Мета | Стан |
|---|---|---|
| H-01 | Некоректні MQTT packets не блокують потік; transient failure зберігає retry | Закрито 27.09.2026 — CI та Windows-приймання PASS |
| H-02 | Справедливий відбір і повторна доставка команд | Реалізовано; очікує CI та приймання користувачем |
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
  перевірене demo успішно оновлено до 0.37.1. Windows-приймання підтверджене нижче.
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

## Підтверджене локальне приймання — 27.09.2026

Користувач надав п'ять скриншотів виконання `check-stage-h-op1.ps1`
у Windows PowerShell. Прийнята ревізія `77a17e4` містить код `f5a1e12`
та запис результатів CI.

| Скриншот | Підтверджений результат |
|---|---|
| image(20260926-220309).png | Fast-forward main до 77a17e4; образ techbaza-acceptance-backend:0.37.1 зібрано |
| image(20260926-220321).png | Створено окреме тестове оточення; міграції порожньої БД застосовано до 20260926_0017; розпочато regression suite |
| image(20260926-220333).png | Попередні регресії проходять; для перевірки повторної доставки навмисно викликано Injected temporary database processing failure |
| image(20260926-220345).png | Тест після transient failure завершився ok; нові H-01 перевірки пройдено; Ran 125 tests in 9.170s, OK |
| image(20260926-220353).png | PASS: 125 backend tests, zero skips; тимчасове оточення прибрано; demo-перевірка ролей/tenant isolation та модульних станів PASS; health ok / 0.37.1; фінальний PASS H-01 acceptance |

Traceback `MQTTProcessingError: MQTT message processing must be retried`
у цьому прогоні є очікуваною частиною тесту transient failure.
Він підтверджує відсутність передчасного ACK; наступний `ok` та підсумковий
`zero skips` підтверджують успішне відновлення.

Demo backend доступний на `127.0.0.1:8001`; PostgreSQL і backend healthy,
broker та simulator запущені. Ці скриншоти не є окремим локальним повтором
Chromium або повного backup/restore: відповідні результати наведені у CI вище.

**H-01 прийнято та закрито. Етап H: завершено 1 із 5 операцій.**
Наступна операція — H-02, справедливий відбір і повторна доставка команд.

## H-02 — черга команд, backend 0.37.2

База операції: `6e7445f` (H-01 прийнято). Схема БД залишається
`20260926_0017`; нова міграція для цього виправлення не потрібна.

### Проблема та рішення

Раніше SQL повертав перші 100 queued/published за deadline, а offline і retry
backoff перевірялися тільки у dispatch. Ті самі непридатні до відправки записи
займали пачку кожного циклу і затримували придатні команди далі у черзі.

Новий SQL застосовує eligibility до `LIMIT`:

| Стан / умова | Відбір |
|---|---|
| queued/published, TTL завершено | Так, незалежно від Device online та backoff |
| queued/published, TTL ще діє | Лише online Device та відсутня попередня спроба або retry interval уже минув |
| acknowledged, result deadline минув | Так, навіть для offline Device; результат стає unknown без publish |
| acknowledged, deadline відсутній | Так, для відновлення deadline legacy-команди |
| acknowledged до deadline; terminal statuses | Ні |

Online boundary (`last_seen_at >= now - timeout`) та retry boundary
(`last_publish_attempt_at <= now - interval`) узгоджені з dispatch.
Час наступної спроби обчислюється зі збережених metadata. Додаткове поле
`next_attempt_at` не дублює вже наявну інформацію. Спочатку обробляються
expiry/result timeout за deadline; потім — доставка за найдавнішим ready_at.
Ready_at першої спроби дорівнює created_at, наступної —
`last_publish_attempt_at + retry interval`. Кожна спроба пересуває ready_at вперед. Це запобігає повторному
вибору тільки старої пачки, коли її retry вже настав, але інші команди ще не
отримали першої спроби. Deadline, created_at та id забезпечують стабільні ties.

Dispatch зберігає row lock і `populate_existing`, повторно перевіряє статус,
TTL, backoff та presence. Список кандидатів не є distributed claim.
Production-цикл передає dispatch `now=None`: час читається заново після lock,
щоб очікування попередніх команд не дозволяло відправити прострочену.
Явний `now` доступний для детермінованих тестів без sleep.

Retry interval винесено до спільного `command_config`. Непозитивні retry,
batch size, poll та нескінченний/NaN poll відхиляються при старті.
HTTP API, MQTT envelope, command_id, правила ACK/Result та TTL не змінені.

### Десять нових PostgreSQL-регресій

1. 150 offline-команд із раннім deadline не приховують наступну online-команду.
2. 150 queued/published у backoff не приховують нову команду.
3. 205 придатних команд проходять пачками 100, 100, 5; четвертий цикл порожній,
   кожна команда має рівно одну спробу до настання retry.
4. Невдалий publish зберігає backoff між DB-сесіями; на точній межі interval
   повторюється той самий envelope, request_id та command_id.
5. Offline expiry, acknowledged timeout і legacy deadline обробляються;
   повторний цикл не дублює аварії і нічого не публікує.
6. Перевірено точну online boundary, NULL last_seen та повернення online.
7. Два цикли одночасно відбирають одну команду; row lock дозволяє одну
   публікацію, другий цикл бачить retry_not_due.
8. Зміна presence, TTL або lifecycle після SQL-відбору блокує publish.
9. Якщо TTL минув між відбором та dispatch, production-цикл завершує команду
   як expired, а не використовує застарілий час початку пачки.
10. Час між циклами просувається на retry interval: усі 205 команд отримують
    першу спробу до повторної відправки старої пачки; загалом три цикли по 100
    публікацій, з яких останні 95 — дозволені retry.

У цих десяти тестах справжні PostgreSQL transactions і locks; MQTT publisher
контрольовано підмінено для перевірки кількості спроб та envelope. Справжні
Mosquitto, redelivery, restart/outage та HTTP сценарії залишаються у спільній
регресії. Загальна кількість тестів після зміни: **135**, CI вимагає zero skips.

### Межі виправлення

Виправлено блокування пачки непридатними командами. Це не гарантія
tenant-fair scheduling або SLA при необмеженому вхідному потоці.
MQTT publish поки відбувається всередині command transaction; зайнятий lock
або повільний broker можуть затримати цикл. Production-перехід до окремого
worker/outbox, коректного claim/lease, quotas та load tests залишається
окремою роботою. Продуктивність на 10 000 контролерів цією операцією не доведена.
At-least-once та обов'язкова edge-дедуплікація за command_id збережені:
збій між MQTT publish і DB commit може спричинити повторну доставку.

### Відтворюване приймання

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage-h-op2.ps1
```

Скрипт використовує поточний `.env.demo` і новий випадковий Compose project,
збирає backend, застосовує міграції до порожньої БД та запускає весь suite.
Після успіху перевірений image оновлює demo на `127.0.0.1:8001` до **0.37.2**.
Demo backend/simulator коротко перезапускаються. Користувачі, паролі, demo
volumes і SQLite-стан simulator зберігаються; seed не повторюється.
Видаляються лише тестові volumes поточного випадкового project.

Backup manifest 0.37.2 також приймає bundles 0.37.0 та 0.37.1 з тією самою
схемою; попередні acceptance-скрипти оновлені на актуальний image.
CI виконує H-02 скрипт замість H-01, включаючи всі тести H-01.

Очікується `PASS: 135 backend tests, zero skips`, health `ok / 0.37.2`
та фінальний `PASS: H-02 acceptance; demo 0.37.2 is running...`.

**H-02 не закрито до підтвердження користувача. Етап H: закрито 1 із 5.**

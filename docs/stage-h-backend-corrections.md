# Етап H — коригування backend перед frontend

Дата початку: 27.09.2026 (Europe/Kyiv). Базовий main: `60d5bec`.

Етап 8 завершений у погодженому обсязі. Етап H закриває нові зауваження
аудиту; frontend залишається наступним функціональним Етапом 9.

## План та стан

| Операція | Мета | Стан |
|---|---|---|
| H-01 | Некоректні MQTT packets не блокують потік; transient failure зберігає retry | Закрито 27.09.2026 — CI та Windows-приймання PASS |
| H-02 | Справедливий відбір і повторна доставка команд | Закрито 27.09.2026 — CI та Windows-приймання PASS |
| H-03 | Розділення системних та користувацьких ключів аварій | Закрито 27.09.2026 — CI та Windows-приймання PASS |
| H-04 | Узгодження module/channel контракту перших екранів | Реалізовано; спільне CI та приймання з H-05 очікуються |
| H-05 | Повна регресія та фіксація прийнятої версії | Підготовлено; CI та приймання користувачем очікуються |

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
    публікацій, з яких останні 95 — дозволені retry. Heartbeat підтримує online
    Device при кожному просуванні часу, також із demo timeout 15 секунд.

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

### Підтвердження CI — 27.09.2026

Код приймання: `544edad6ce2ebbd33edd778e7f04515e7f3ed6a8`, backend **0.37.2**.
[GitHub Actions run 36275911324](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36275911324)
завершився `completed / success`; jobs `hardening` і `demo` — success.

| Перевірка | Підтверджений результат |
|---|---|
| PostgreSQL/Mosquitto suite | 135 tests, zero skips; усі десять H-02 регресій — ok |
| Міграції | Head 20260926_0017; наявні downgrade/upgrade перевірки — PASS |
| Chromium | Login, HttpOnly cookie, rotation, CSRF/CORS, logout/revocation — PASS |
| Живий HTTP/MQTT | Команди, ACK/Result, дедуплікація, telemetry, alarms, notifications — PASS |
| Simulator/backend restart | Стан і queue збережені; expired command не публікується — PASS |
| Broker outage/reconnect | HTTP доступний, queued command збережена; доставка і telemetry відновлені — PASS |
| Clean install | Tracked source, порожня БД, міграції, 135 tests без skips, live demo — PASS |
| Exact backup/restore | Схема і всі 20 PostgreSQL tables збігаються; SQLite device/command rows збігаються |
| Restore safety | Старі sessions відхиляються, відновлені queued/published не оживають автоматично — PASS |
| H-02 PowerShell script | 135 tests, zero skips; demo health ok / 0.37.2; фінальний PASS H-02 acceptance |

Допоміжний локальний прогін без PostgreSQL/MQTT: 64 пройдено, 71 skipped.
Повне підтвердження дає наведений CI-прогін, де пропуски заборонені.
PowerShell-скрипт перевірено у CI на PowerShell 7; користувацьке Windows
приймання підтверджено нижче.

Підготовчі прогони виявили дві помилки нових fixtures: TTL 600 замість
дозволених 5..300 секунд та просування часу без heartbeat при короткому
demo timeout. Fixtures виправлено без послаблення перевірок і без зміни
протокольних лімітів. Після цього весь CI повторно пройдено на наведеному commit.

## Підтверджене локальне приймання H-02 — 27.09.2026

Користувач надав п'ять скриншотів виконання `check-stage-h-op2.ps1`
у Windows PowerShell. Прийнята ревізія `abd8ec8` містить код
`544edad6ce2ebbd33edd778e7f04515e7f3ed6a8` та запис результатів CI.

| Скриншот | Підтверджений результат |
|---|---|
| image(20260926-222932).png | Fast-forward main до abd8ec8; зібрано techbaza-acceptance-backend:0.37.2; створено окремий випадковий Compose project |
| image(20260926-222947).png | PostgreSQL/Mosquitto healthy; порожня тестова БД мігрована до 20260926_0017; усі десять H-02 регресій черги завершилися ok |
| image(20260926-222957).png | Регресії lifecycle, прав доступу, модульності та API проходять; навмисний Injected temporary database processing failure у тесті MQTT redelivery |
| image(20260926-223006).png | Після MQTTProcessingError тест завершується ok; подальші MQTT, notifications, restore та telemetry перевірки проходять |
| image(20260926-223019).png | Ran 135 tests in 11.204s, OK; PASS: 135 backend tests, zero skips; тестове оточення прибрано; demo health ok / 0.37.2; фінальний PASS H-02 acceptance |

Підтверджено відбір після 150 offline/backoff записів, проходження 205 команд,
ротацію вже дозволених retry, збереження backoff між DB-сесіями, межі presence,
expiry/result timeout та захист від одночасної публікації двома циклами.
Тест також підтверджує повторну перевірку lifecycle і часу після відбору.

Traceback `MQTTProcessingError: MQTT message processing must be retried`
є очікуваною частиною перевірки тимчасового збою: навмисна помилка не
підтверджується брокеру, повідомлення доставляється повторно, тест завершується
`ok`. Підсумковий прогін не має невдалих чи пропущених тестів.

Demo backend працює на `127.0.0.1:8001`; backend, PostgreSQL, broker і simulator
запущені. Quick demo перевірка входу чотирьох користувачів, tenant isolation,
viewer 403 та modular/live/stale/offline/new states — PASS. Повний Chromium
та exact backup/restore окремо підтверджені CI вище; ці скриншоти не є
повторним локальним виконанням цих двох сценаріїв.

**H-02 прийнято та закрито. Етап H: завершено 2 із 5 операцій.**
Наступна операція — H-03, розділення системних та користувацьких ключів аварій.

## H-03 — системні та користувацькі ключі аварій, backend 0.37.3

База операції: `a25d0c2` (H-02 прийнято). Схема БД залишається
`20260926_0017`. Історія Alarm, transitions, notifications і rule state
не перейменовується та не видаляється.

### Проблема

Rule Engine використовує rule_key як alarm_key. Системні presence/reboot/command
аварії зберігаються в тій самій таблиці та ідентифікуються за device_id + alarm_key.
Раніше можна було призначити числове правило з ключем `device.offline` або
`command.failed.vfd.start`: воно могло повторити, змінити severity/context або
закрити системний incident за порогом довільного датчика.

### Новий контракт

Спільна політика знаходиться в `app.alarm_keys`:

| Ключ користувацького rule | Результат |
|---|---|
| `device`, `device.*` | Зарезервовано; HTTP POST/PATCH config повертає 422 |
| `command`, `command.*` | Зарезервовано; HTTP POST/PATCH config повертає 422 |
| `pressure.low`, `demo.pressure.low`, `my.device.offline` | Дозволено за звичайними правилами валідації |
| `device_pressure.low`, `devices.offline` | Інші простори; з системними ключами не збігаються |

Резервується весь системний простір із розділювачем крапкою, включно з коренем,
щоб наступні системні типи не створювали нових колізій. Поточні системні ключі
та alarm_type не змінені; discriminator lifecycle — саме alarm_key.

Перевірка нового config застосовується також до вимкнених rules/assignments.
PATCH `is_enabled=true` без config повторно перевіряє збережений config під
наявним Device lock: legacy-конфлікт повертає 422 без зміни assignment.
PATCH `is_enabled=false` без нового config дозволяє вимкнути старий конфлікт.
Його можна виправити валідним config і знову увімкнути. Конфліктна legacy
capability не блокує виправлення інших нормальних правил цього Device.

Існуюча заборона дубльованих активних ключів різних capabilities, HTTP/JWT
перевірки ролей і tenant isolation збережені. Загальний lifecycle service
залишається внутрішнім trusted API для системних orchestration services;
публічного HTTP endpoint довільного створення системної аварії не додано.

### Старі дані та безпечне оновлення

Runtime читає legacy rules зі спеціальним internal режимом parser, але
пропускає зарезервований rule до читання/зміни rule state або Alarm. Пише
`Reserved alarm rule skipped` із device/capability/key, без повного config.
Валідні rules тієї самої capability продовжують працювати. Валідна telemetry
комітиться, MQTT ACK відбувається після commit; старий конфлікт не запускає
нескінченний retry одного packet. Пропущене правило потребує виправлення:
це захист від колізії, а не його автоматична міграція.

`python -m app.tools.alarm_key_check` — read-only preflight існуючої БД:

- Перевіряє всі assignments, включно з вимкненими, і повертає ідентифікатори
  зарезервованих rules або іншого невалідного rule config.
- Виявляє активні legacy Alarm у системному просторі з rule_key у context,
  включно зі змішаними incidents. Автоматично визначати їх правильний фізичний
  стан і переписувати історію не можна.
- Працює в PostgreSQL REPEATABLE READ / READ ONLY, читає порціями по 200.
- За конфліктів завершується з exit 1, не змінюючи жодного запису.

Скрипт H-03 спочатку виконує ізольовану регресію. Потім коротко зупиняє
demo backend/simulator, щоб старий API не змінював config під час preflight.
Новий checker запускається з перевіреного image проти існуючої demo БД через
тимчасовий Compose override. При невдачі перевірки попередній demo запускається
знову, image tag не змінюється, скрипт завершується помилкою. Потрібно передати
звіт про конфлікти для окремого розбору; автоматичного перейменування чи
закриття incident немає. Після PASS перевірений image оновлює demo до 0.37.3.

Ця перевірка перед оновленням обов'язкова також для іншого наявного стенда.
Прямий запис у БД адміністративними засобами залишається trusted операцією;
runtime guard і preflight не є заміною прав доступу до PostgreSQL.

### Перевірки

Додано 3 unit та 7 PostgreSQL-регресій; загальний suite — **145 tests**:

1. POST/PATCH schemas відхиляють roots, поточні й майбутні системні ключі,
   зокрема при enabled=false; сусідні нерезервовані назви працюють.
2. Legacy rule не приховує нормальне правило тієї самої capability.
3. HTTP POST/PATCH повертають 422 і не створюють/не змінюють assignment.
4. HTTP 401/403/404 та дозволений запис owner зберігаються.
5. Часткове повторне включення legacy config заборонено; вимкнення і ремонт
   дозволені навіть за наявності іншої конфліктної legacy capability.
6. Зарезервовані rules не змінюють чотири реальні системні incidents:
   offline, reboot, command.failed і command.result_unknown. Валідний custom
   incident водночас відкривається та закривається; системна історія незмінна.
7. Реальний MQTT callback із PostgreSQL комітить valid telemetry перед ACK,
   не створюючи Alarm/rule state для конфліктного legacy rule. Сам socket у
   цій вузькій регресії замінений Mock; реальний broker покрито іншими suites.
8. Preflight знаходить вимкнене reserved rule і активний legacy incident,
   завершується exit 1 та не змінює їх.
9. Одночасна системна й користувацька аварія створюють два незалежні incidents.

Повний CI також виконує попередні MQTT/PostgreSQL suites, Chromium, demo,
restart/outage, clean install, exact backup/restore та PowerShell H-03.
Backup manifest 0.37.3 приймає 0.37.0, 0.37.1, 0.37.2 з тією самою схемою.

### Підтвердження CI H-03 — 27.09.2026

Код: `5c3185564d84acee97e5965e42fd33fc6bd65a18`, backend **0.37.3**.
[GitHub Actions run 36304929898](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36304929898)
завершено зі статусом `completed / success`; jobs `hardening` і `demo` успішні.

| Перевірка | Результат |
|---|---|
| Backend із PostgreSQL/Mosquitto | 145 tests, zero skips; hardening — 10.830 s |
| Нові H-03 регресії | Усі 10 успішні, включно з HTTP 422/401/403/404, legacy config, незалежністю системних incidents та read-only preflight failure |
| Міграції | Upgrade і контрольні downgrade/upgrade до head 20260926_0017 — PASS |
| Chromium | Login, HttpOnly cookie, reload/rotation, CSRF/CORS rejection, logout/revocation — PASS |
| Live HTTP/MQTT demo | Команди, ACK/Result, дедуплікація, телеметрія, audit, аварії та notifications — PASS |
| Restart / outage | Стан simulator, queue/TTL після restart backend, broker outage/reconnect — PASS |
| Clean install | Окремий стенд із tracked source, міграції, повні тести та live scenarios — PASS |
| Exact backup/restore | Схема та всі 20 PostgreSQL-таблиць збігаються; SQLite device/command rows збігаються |
| Захист відновленого стенда | Старі access/refresh відхилені; відновлена queued STOP не публікується повторно — PASS |
| Скрипт check-stage-h-op3.ps1 у PowerShell 7 | 145 tests, zero skips за 10.942 s; preflight PASS; demo health ok / 0.37.3; фінальний H-03 acceptance PASS |

Локальний допоміжний прогін у середовищі розробки: 67 пройдено, 78 пропущено
через відсутність PostgreSQL/MQTT. Повний CI вище виконав усі 145 без пропусків.
CI перевірив успішний шлях скрипта оновлення; відмова preflight без зміни даних
окремо перевірена PostgreSQL-регресією. Windows-приймання користувача підтверджене нижче.

### Приймання користувачем

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage-h-op3.ps1
```

Очікується `PASS: 145 backend tests, zero skips`,
`PASS: alarm key preflight; no reserved rules or active legacy collisions`,
health `ok / 0.37.3` та фінальний `PASS: H-03 acceptance; demo 0.37.3 is running...`.
Demo працює на `127.0.0.1:8001`; існуючий `.env.demo`, користувачі, паролі,
demo volumes і SQLite-стан simulator зберігаються. Seed не повторюється.

**H-03 прийнято та закрито 27.09.2026. Етап H: закрито 3 із 5 операцій.**


## Підтверджене локальне приймання H-03 — 27.09.2026

Користувач надав п'ять скриншотів виконання `check-stage-h-op3.ps1`
у Windows PowerShell. Прийнята ревізія `b69f682` містить код
`5c3185564d84acee97e5965e42fd33fc6bd65a18` і результати CI.

| Скриншот | Підтверджений результат |
|---|---|
| image(20260927-081402).png | Fast-forward main з abd8ec8 до b69f682; зібрано techbaza-acceptance-backend:0.37.3 |
| image(20260927-081418).png | Створено окремий випадковий Compose project; PostgreSQL/Mosquitto healthy; порожня тестова БД мігрована до 20260926_0017; усі десять H-03 регресій завершилися ok |
| image(20260927-081430).png | Попередні queue, lifecycle, auth, modular/frontend contract та hardening регресії проходять; розпочато тест MQTT redelivery з навмисним тимчасовим збоєм |
| image(20260927-081439).png | Injected temporary database processing failure та MQTTProcessingError завершуються ok; подальші MQTT, notifications, restore і telemetry регресії проходять |
| image(20260927-081450).png | Ran 145 tests in 10.461s, OK; PASS: 145 backend tests, zero skips; тестове оточення прибрано; preflight існуючої demo БД PASS; health ok / 0.37.3; фінальний PASS H-03 acceptance |

Підтверджено заборону системних ключів у нових POST/PATCH config, захист
часткового повторного включення legacy rule, можливість вимкнення та ремонту,
незалежність системних і custom incidents та збереження commit-before-ACK
для валідної телеметрії за наявності legacy-конфлікту. Read-only preflight
failure перевірено окремою регресією без зміни тестових записів.

Preflight саме існуючої demo БД завершився:
`PASS: alarm key preflight; no reserved rules or active legacy collisions`.
Конфліктних rules чи активних legacy incidents перевірка не знайшла;
ручне виправлення даних для цього оновлення не знадобилося.

Traceback `MQTTProcessingError: MQTT message processing must be retried`
є очікуваною частиною тесту тимчасового збою: повідомлення не підтверджується
передчасно, доставляється повторно, тест завершується `ok`.
Фінальний прогін не має невдалих чи пропущених тестів.

Demo backend працює на `127.0.0.1:8001`, версія **0.37.3**.
Backend і PostgreSQL healthy; broker та simulator запущені.
Quick demo перевірка входу чотирьох користувачів, tenant isolation,
viewer 403 та modular/live/stale/offline/new states — PASS.
Видалено лише випадкове тестове оточення; приймальний скрипт не робив
повторний seed і не видаляв volumes існуючого demo.
Повний Chromium, clean install та exact backup/restore підтверджені CI вище;
ці скриншоти не є повторним локальним виконанням цих сценаріїв.

**H-03 закрито. Етап H: завершено 3 із 5 операцій.**
Залишилися H-04 — узгодження module/channel контракту перших екранів,
і H-05 — повна регресія та фіксація прийнятої версії.

## H-04 та H-05 — спільний фінальний блок, backend 0.38.0

27.09.2026 користувач явно попросив виконати H-04 і H-05 разом. База —
`c7e842a` із закритою H-03. Операції залишаються окремими в плані,
але мають один фінальний скрипт локального приймання. Нових гілок немає.

### H-04: проблема та зміна контракту

Попередній overview повертав capabilities, окремі keys і command arrays.
Frontend мав сам відновлювати зв'язок модуля з типом каналу, одиницею,
графіком і командами. Для state не було аналога readings із типом/якістю:
невалідне `"false"` можна було помилково показати як стан насоса.

Додано `overview.modules`: лише enabled assignments цього Device,
assignment_id/capability_id/code, supported, канали та команди з правами.
Канал має source/key, data_type, unit і supports_series. Каталожні name та
description вже є в capabilities; довільний config не копіюється в modules.
Невідомий code має supported=false й порожні channels/commands.

`app/device_contract.py` є єдиним джерелом реалізованих каналів, одиниць
та відповідності команд capabilities. Ingestion, overview і series
використовують його проєкції. Старі Python imports mapping сумісні.
Нових SQL-запитів на кожен канал або таблиць модулів не додано.

Додано `state_readings` зі strict boolean/integer/null. false і 0 не
втрачаються; missing/invalid не стають «насос вимкнений» або «помилок немає».
Застосовано чинний freshness пакета, включно з session change. Integer
обмежено точним діапазоном JavaScript ±(2^53−1) тільки у цьому read DTO.
Raw snapshot, telemetry history та чинні поля overview збережено.

Деталі, таблиця всіх восьми каналів і межі:
[module-channel-contract-v1.md](module-channel-contract-v1.md).
Це логічні capabilities, а не автоматичне виявлення фізичних плат.
Кілька однотипних датчиків на одному Device ще потребуватимуть окремого
instance/channel контракту firmware, ingestion, історії, rules та UI.

### H-04: перевірки

Додано 6 unit та 5 PostgreSQL/HTTP тестів. Наявні frontend-тести додатково
перевіряють порожні modules/state_readings і role-aware module commands.

- Відповідність registry чинним ingress і CommandType, типи OpenAPI.
- Точні integer boundaries, false/zero/missing/invalid та stale readings.
- UUID assignment, відсутність generic config у відповіді, unknown code.
- Усі оголошені numeric channels проходять ingestion і HTTP series з
  правильними units; state series відхиляються як непідтримувані.
- Оголошені дозволені команди проходять POST; viewer їх не отримує.
- HTTP disable прибирає channels/commands і блокує ingestion/series/POST;
  історичний snapshot незмінний, повторне включення повертає модуль.
- Встановлений state-модуль без telemetry має missing, а не false/zero.
- Свіжий heartbeat і нова boot session не роблять старий state свіжим.

Live demo перевіряє module/channel зв'язки, units, chart support і role-aware
commands для різних пристроїв через реальний HTTP API. Функціональні
MQTT/simulator сценарії продовжують виконуватися в повному прогоні.

### H-05: знайдений крайній випадок і фінальний gate

Відтворено `OverflowError` у `DeviceCommandCreate` для frequency_hz=10**400:
попередній прямий float(value) виходив за межі Pydantic ValidationError.
Застосовано спільний finite_number; невалідний чи надмірний numeric input
тепер дає HTTP 422. Діапазон 0..100 і початковий payload валідної команди
не змінюються, зберігається idempotency. Додано 2 unit тести та розширено
реальний HTTP-тест: 422 без створення команди або MQTT publish.

Загальний suite — **158 tests**. Локальний допоміжний запуск:
**75 пройдено, 83 пропущено** без PostgreSQL/MQTT; це не повне приймання.
Повний CI і фінальний скрипт вимагають zero skips.

`scripts/check-stage-h-final.ps1` використовує спільний acceptance сценарій
Етапу 8/операції 6, щоб не дублювати backup/restore логіку. Він виконує:

1. Clean install із git archive поточного HEAD, нових випадкових volumes,
   build без cache, empty DB check, міграцій та всіх 158 тестів.
2. Seed тільки нового тимчасового стенда і live HTTP/MQTT сценарії,
   включно з H-04 contract, командами, аваріями та notifications.
3. Коротку зупинку старого demo backend/simulator і read-only H-03 preflight
   існуючої БД новим image. При відмові попередній image відновлюється,
   promotion не відбувається; автоматичного ремонту історії немає.
4. Promotion перевіреного image до demo 0.38.0 без повторного seed
   наявних користувачів/модулів. Старий `.env.demo` збережено.
5. Приватний backup PostgreSQL/SQLite, перевірку hashes і відновлення в
   іншому випадковому оточенні; source demo volumes не перезаписуються.
6. Exact comparison схеми й усіх 20 таблиць та SQLite-стану, захист
   відновлених sessions/queued commands, live recovery перевірки.
7. Видалення лише тимчасових test/restore volumes; backup/report лишається
   локально в `backups/acceptance-*`, який ігнорується Git.

У restored copy також прибрано повторний seed: її дані отримані з backup.
Restore guard відкликає sessions і блокує стару queued delivery лише
у відновленій копії. Source canary session створюється/відкликається
перевіркою; чинні користувачі та паролі не замінюються.

CI додатково виконує Chromium browser auth, контрольні downgrade/upgrade,
restart simulator/backend та broker outage/reconnect. Той самий фінальний
PowerShell-скрипт виконується CI PowerShell 7 і користувачем у Windows.

Версія підвищена до **0.38.0** через розширення API; схема лишається
**20260926_0017**. Backup verification приймає також 0.37.0–0.37.3
із цією схемою. Контракт перших екранів, release notes та backend README
оновлені; історія приймання попередніх версій збережена.

### Спільне приймання користувачем

Після оновлення main, з працюючим Docker Desktop і чинним `.env.demo`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-stage-h-final.ps1
```

Очікуються 158 tests, zero skips, module/channel contract PASS, H-03
preflight PASS, exact restore усіх 20 таблиць та SQLite, health 0.38.0
на `127.0.0.1:8001`, і фінальний `PASS: H-04/H-05 acceptance...`.
Сценарій довший за H-03: перевіряє чисту установку й backup/restore.

**H-04/H-05 ще не закриті. Етап H: прийнято 3 із 5 операцій.**
Після успішного CI й підтвердження користувача можна зафіксувати основу
першого frontend та перейти до Етапу 9. Це не підтвердження роботи
10 000 контролерів, production TLS/ACL чи фізичних interlocks;
ці межі наведені в [release notes](test-backend-release-v1.md).

# Повторний огляд backend після Етапу H

> **Історичний запис.** Версії, числа тестів, «поточні» кроки й команди нижче належать описаному етапу. Для роботи з нинішнім кодом: [статус](project-status.md), [чинні інструкції та контракти](README.md).

Дата: 27.09.2026. Перевірена ревізія: `b355c8e1a71a18a4d7405d3be78411a943c0c442`.
Backend **0.38.0**, Alembic **20260926_0017**. Етап H завершено 5/5.
Цей огляд не змінює виконуваний код і не відкриває заново прийняті операції H.

## 1. Вердикт

**Поточний backend відповідає завданню першої тестової версії модульної
платформи TechBaza. На ньому можна будувати перший frontend.**
Це структурована, перевірена основа продукту; переписування з нуля не потрібне.

Водночас повний комерційний задум ширший за прийнятий backend: B2B onboarding,
реальні контролери, кілька однотипних датчиків одного Device, production
security та навантаження 10 000 контролерів ще потребують реалізації й доказів.
Огляд не є незалежним penetration test, сертифікацією або підтвердженням
відсутності всіх дефектів. Кількість тестів не є відсотком покриття.

Умовна інженерна оцінка саме основи першої тестової версії — **8/10**.
Це суб'єктивна оцінка за наведеними критеріями, а не виміряний рейтинг BigTech.

## 2. Обсяг і докази перевірки

- Перевірено повне Git-дерево: **259 tracked files**. Усі 224 наявні локально
  файли збігаються з Git blob SHA; відсутні локально 35 файлів — історичні docs.
  Виконуваних файлів, відсутніх у локальному знімку, немає.
- Структурно перевірено всі **177 Python-файлів** через AST; прочитано
  ключові реалізації HTTP/auth/RBAC, MQTT, telemetry, commands, alarms,
  notifications, read models, SQL repositories, simulator і backup/restore.
- Перевірено маршрути API, зв'язки моделей, ланцюжок усіх 17 міграцій,
  конфігурацію Docker/Mosquitto, CI та PowerShell-приймання.
- Перевірено склад усіх 158 тестів і покриті ними сценарії. Локальний повтор:
  **158 discovered, 75 passed, 83 skipped**, 2.248 s. Тут немає PostgreSQL/MQTT;
  такий прогін не підміняє integration acceptance.
- Повний прийнятий [CI 36307064503](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36307064503)
  на коді `04966f5`: 158 tests без пропусків, Chromium, live HTTP/MQTT,
  restart/outage, clean install та exact restore.
- Повторний [CI 36309034806](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36309034806)
  саме на `b355c8e` також завершився success в обох jobs: 158 tests in
  12.732s, zero skips, Chromium і повний demo/restore gate PASS.
- Windows-приймання на `60d59a7`: **158 tests in 11.465s, zero skips**,
  exact restore 20 таблиць/SQLite, фінальний H-04/H-05 PASS, health 0.38.0.
  Дев'ять скриншотів описані в [досьє H](stage-h-backend-corrections.md).
- Окремо відтворено прогалини DTO-валідації назв, timezone та невідомої
  metric у rule config. Дані користувача при цьому не змінювалися.

Це огляд коду й наявних доказів, а не новий локальний навантажувальний прогін.
Динамічний frontend та інтегрована production firmware у репозиторії ще відсутні.

## 3. Відповідність задуму

| Вимога | Поточний стан | Межа |
|---|---|---|
| Різні клієнти та об'єкти | Organizations → Sites → Devices, memberships, RBAC | Немає завершеного B2B lifecycle та self-service onboarding |
| Модульний конструктор | Enabled assignments визначають telemetry keys, modules, channels, allowed_commands | Один assignment одного capability code на Device; новий code не створює handler автоматично |
| Віддалене керування | Start, Stop, frequency.set; durable queue, TTL, ACK/Result, actor audit | Реальний Modbus/firmware execution та фізичні interlocks не доведені цим репозиторієм |
| Телеметрія | Історія, snapshot, ordering, boot sessions, missing/invalid/fresh/stale | Вісім підтримуваних каналів: чотири числові, чотири state; не довільний sensor bus |
| Аварії | Numeric rules, debounce, hysteresis, lifecycle та acknowledge | Немає повноцінного редактора правил і універсального automation engine |
| Повідомлення | In-app stream і персональне прочитання | Email/SMS/Telegram/push — майбутні канали |
| Інтерфейс користувача | OpenAPI, browser auth, overview, chart API і demo готові | Сам UI ще не реалізований |
| Масштабування | PostgreSQL, індекси, bounded reads, модульні шари | Однопроцесний runtime; 10 000 контролерів не перевірені |

## 4. Якість по напрямах

| Напрям | Оцінка | Підстава |
|---|---|---|
| Архітектура | Добра основа | API, schemas, services, repositories та models розділені; немає потреби в мікросервісах для першого UI |
| Читабельність | Добра, з нерівномірним стилем | Назви предметні, нетривіальні гарантії пояснені; старі та нові файли форматовані по-різному |
| Надійність | Сильна в перевірених сценаріях | Commit перед MQTT ACK, deduplication, late result, unknown outcome, rollback, restore guards |
| Безпека API | Добра для ізольованого demo | Argon2id, JWT + server sessions, refresh rotation, RBAC, CSRF/CORS, auth limits |
| Production security | Не завершена | Anonymous MQTT, відсутні device identities/TLS/ACL, production deployment profile та supply-chain gate |
| Підтримуваність | Прийнятна, є технічний борг | MQTT module 874 рядки, повтори DTO/error mapping, розподілені settings, прив'язка worker до API process |
| Тестованість | Добра | Unit, реальні PostgreSQL/MQTT, конкурентні сценарії, Chromium та recovery; немає метрики coverage чи load suite |
| Спостережуваність | Базова | Logs і diagnostics є; немає постійних метрик latency/lag, traces, SLO та операційних alerts |
| Документація | Сильна доказова історія | Етапи, screenshots evidence, контракти, reproduce scripts; історичні версії слід відрізняти від чинного контракту |

Конкретні сильні реалізації: [telemetry transaction](../backend/app/services/telemetry.py),
[command dispatch](../backend/app/services/command_dispatch.py),
[tenant guards](../backend/app/security/authorization.py),
[browser auth](../backend/app/api/v1/auth.py),
[module registry](../backend/app/device_contract.py),
[restore guards](../backend/app/operations/recovery.py).

## 5. Зауваження та пріоритети

Це backlog рекомендацій, а не повідомлення, що всі правки вже зроблені.
Термін виконання прив'язаний до функції або способу розгортання.

| ID | Спостереження та наслідок | Конкретна дія | Коли |
|---|---|---|---|
| R-01 | `main.lifespan` запускає MQTT і обидва workers; `MQTT_CLIENT_ID` фіксований. Кілька API replicas успадкують workers і конфліктуючі MQTT connections | Розділити запуск API та worker/ingestion; визначити ownership/lease або інше розподілення обробки; зберегти deduplication і ordering | До горизонтального масштабування |
| R-02 | DB ingestion виконується в одному MQTT network callback; dispatch тримає row lock під час `wait_for_publish` до timeout | Виміряти MQTT lag, час transaction/locks; винести publish/ingestion у контрольовану worker-модель з bounded concurrency та backpressure | До великого потоку контролерів |
| R-03 | Історія telemetry накопичується без retention/rollups; графік рахується з JSONB, хоча має ліміти | Узгодити частоту пакетів і строки зберігання, агрегати та archive; EXPLAIN ANALYZE на реальних обсягах; partitioning лише за виміряною потребою | До тривалої експлуатації |
| R-04 | Broker дозволяє anonymous, клієнт не налаштовує TLS/credentials; контейнер backend без non-root USER; є dev defaults | Окремий production profile: HTTPS, device credentials, topic ACL/TLS, обов'язкові випадкові secrets, least privilege, non-root, quotas | До зовнішнього доступу та реальних пристроїв |
| R-05 | Частина dependencies задана діапазоном; образи й Actions — mutable tags; tests/demo входять у спільний image | Lock + hashes, digest pinning і контрольовані оновлення; dependency/image scan, SBOM; за потреби окремий runtime/test target | До production release |
| R-06 | `/health` перевіряє лише HTTP/version; worker diagnostics та rejection counters живуть у пам'яті процесу | Окремі liveness/readiness; метрики DB/MQTT/queue/worker lag, структуровані logs і correlation IDs, alerts | До публічного стенда/пілота |
| R-07 | `name='  '` проходить DTO; service потім робить strip. `SiteCreate.timezone='not/a-timezone'` також проходить | Strip перед min_length; IANA timezone validation; narrow regression tests, перед формами створення — перевірити старі дані | При додаванні форм об'єктів/пристроїв; до цього UI має fallback timezone |
| R-08 | `alarm_rules.metric='no_such_metric'` проходить write schemas; engine пропускає правило, якщо ключ відсутній. Немає явної межі числа rules/розміру generic config | Перевіряти source/metric проти реально підтримуваних каналів Device, встановити ліміти config/rules, визначити reset pending state при зміні правила | До редактора alarm rules та self-service config |
| R-09 | Command history сортується лише за created_at; при рівному timestamp немає стабільного tie-breaker | Додати id до order_by та регресію однакових timestamps; cursor pagination розглядати при великих журналах | Під час операції 12.4 |
| R-10 | Немає єдиної перевірки всіх settings: system alarm poll/batch і presence timeout не мають таких guards, як command worker | Типізовані settings і startup validation усіх timeout/batch/TTL; відхиляти zero/negative/NaN де неприйнятно | Планове зміцнення перед пілотом |
| R-11 | Склад modules/readings добре типізований, але HTTP errors не мають спільного machine code; OpenAPI responses нерівномірні | Зараз UI розбирає status + detail; надалі сумісно додати error_code/request_id. Не порівнювати український текст помилки | API adapter у 9.3; backend розширення за потреби |
| R-12 | Права та capability перевіряються під час створення команди; dispatch не скасовує вже прийняту queued command після їх зміни | Явно погодити policy для queued commands при revoke/disable; за потреби додати cancel/recheck з audit, не змінюючи історію | До керування реальним обладнанням |

R-07/R-08 відтворені викликом Pydantic-моделей; новий HTTP/DB acceptance цих
випадків не проводився. R-01/R-02 — висновки з runtime architecture,
а не виміряний поріг продуктивності. R-12 — непогоджена продуктова семантика,
а не твердження, що чинний контракт обіцяє автоматичне скасування.

Інші межі: memberships/device-capability lists без pagination; tenant
isolation реалізована в застосунку, не PostgreSQL RLS; історія команд і
events прив'язана до Device, тому перед перенесенням Device між tenants
потрібна окрема policy історії (notifications уже мають tenant snapshot).
У чинному API перенесення Device не реалізоване.

## 6. Що не потрібно ускладнювати зараз

- Не замінювати PostgreSQL або FastAPI через саму ціль 10 000 контролерів.
- Не додавати Kubernetes, Kafka, Redis, CQRS чи мікросервіси без конкретної
  виміряної проблеми. Поточна durable command queue вже виконує потрібну роль.
- Не робити універсальний low-code редактор усіх можливих модулів перед
  першою панеллю. Registry підтримуваних каналів має залишатися явним.
- Не прибирати доказові тести та simulator заради меншої кількості рядків.
- Не проводити великий косметичний rewrite перед frontend. Локальні
  покращення MQTT organization, DTO helpers та settings робити окремо з регресіями.

## 7. Масштаб та готовність

Наприклад, 10 000 контролерів із одним пакетом telemetry раз на 10 секунд —
**1 000 пакетів/с і 86 400 000 пакетів/добу**, ще без heartbeat, індексів,
команд та інших записів. Це арифметична модель вимог, не benchmark.
Для іншої частоти або подій замість періодичних пакетів обсяг буде іншим.

Потрібні окремі сценарії навантаження: сталий потік, одночасний reconnect,
broker/DB outage, накопичена черга, сотні відкритих панелей, тривала історія,
із вимірюванням p95/p99, втрат/дублікатів, lock waits, RAM/CPU/disk та recovery.

Поточний **узгоджений тестовий backend scope прийнято**. Це не означає
«100% майбутнього backend»: майбутній обсяг ще не зафіксований настільки,
щоб чесно назвати відсоток. Основні майбутні блоки — provisioning/B2B,
production operations, hardware integration, multiple sensor instances,
зовнішні notifications та додаткові продуктові функції.

## 8. Розмір коду

Фізичні текстові рядки, включно з порожніми, коментарями й docstrings.
Тільки tracked `backend/`; Markdown/docs, bytecode та dependencies виключені.

| Частина | Файлів | Рядків |
|---|---:|---:|
| Основний app, без demo/tools | 117 | 11 126 |
| app/demo | 9 | 1 060 |
| app/tools | 11 | 1 659 |
| tests | 22 | 3 790 |
| alembic, включно з template | 19 | 2 009 |
| Dockerfile, requirements, alembic.ini, .dockerignore | 5 | 71 |
| **Разом backend без Markdown** | **183** | **19 715** |

Лише Python: **177 файлів / 19 619 рядків**. Додаткові дев'ять PowerShell
скриптів поза backend — 605 рядків; у підсумок вище не включені.
Кількість рядків не визначає якість або функціональну готовність.

## 9. Рішення щодо наступного кроку

Починати frontend на прийнятій основі. Нового великого етапу переписування
backend перед першим екраном цей огляд не обґрунтовує. Знайдені обмеження
мають конкретні точки виконання та не приховуються за статусом H «закрито».

Наступний документ — [план frontend, Етапи 9–14](frontend-roadmap-v1.md).

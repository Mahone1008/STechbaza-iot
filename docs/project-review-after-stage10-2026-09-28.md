# Огляд KERUMO після Етапу 10

Дата: **28.09.2026**. Базова ревізія: `f7d23d64d4c1000af9840f7b1a9265851d9ed0ab`.
Backend **0.38.0**, OpenAPI **47 paths**, Alembic **20260926_0017**.

## 1. Де зупинилися

| Напрям | Підтверджений стан |
|---|---|
| Backend, Етапи 1–8 та H | Прийнята тестова основа; H завершено 5/5 |
| Frontend, Етап 9 | Foundation завершено 4/4 |
| Frontend, Етап 10 | Login, recovery, permissions/guards та logout завершено 4/4 |
| Frontend roadmap | **8/24 прийнятих операцій**; це не відсоток готовності продукту |
| Наступна операція | **11.1 — організації, об'єкти та tenant context** |
| Реальні domain data у UI | Devices, telemetry, alarms та command timeline ще demo fixtures |
| Firmware | У `firmware/` лише README; інтегрована прошивка ESP32→MQTT→VFD у цьому repo відсутня |

Стан зі старих чатів «наступна 10.1» застарів. Пізніші commits, загальне
досьє Етапу 10 і `KERUMO_Stage_10_Dossier.docx` фіксують фінальне Windows-приймання
10.4 27.09.2026. Помилки PowerShell ParserError та TypeScript `AuthSessionSnapshot`
були проміжними й виправлені до базової ревізії цього огляду.

## 2. Обсяг та докази

- Інвентаризація всіх **348 tracked files** на базовій ревізії.
- AST-перевірка **178 Python-файлів** без syntax errors.
- Читання ключових auth/RBAC, tenant access, API adapter/cache, route guards,
  MQTT payload, telemetry/command, module registry, CI та acceptance scripts.
- Зіставлення чинних README/roadmap/досьє з доступною історією чатів, архівом
  `TechBaza_IoT_chat_history_full.md` і підсумковим Word-досьє Етапу 10.
  Це не послівне перечитування недоступних повних transcript усіх чатів.
- [Frontend CI базової ревізії](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36344123967)
  — success, включно з mocked і live auth jobs.
- [Прийнятий Backend CI](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36309034806)
  — success на `b355c8e`. `git diff` підтверджує відсутність змін у backend,
  infrastructure та трьох compose-файлах між ним і `f7d23d6`.
- Локальний повтор backend: **158 discovered, 75 passed, 83 skipped**.
  PostgreSQL, Mosquitto та Docker тут відсутні; пропуски не рахуються як PASS
  інтеграцій і не замінюють прийнятий CI/Windows gate.
- Локально frontend: OpenAPI export без drift, typecheck, ESLint,
  **23 unit tests** і production build — PASS.
- Локальне встановлення Chromium не вдалося: отриманий архів некоректний.
  Нові browser regressions мають бути підтверджені GitHub CI та Windows gate.

Огляд не є penetration test, load test або гарантією відсутності всіх помилок.

## 3. Виправлення цього огляду

### A-01. Refresh повторювався раніше за Retry-After

`refreshRetryDelayMs(0, 300)` повертав **60 000 ms** замість **300 000 ms**.
Помилку відтворено failing unit assertion до виправлення. Крім таймера,
manual/demand/focus refresh не перевіряв server deadline.

Виправлення:

- server Retry-After більше не обмежується cap для звичайного backoff;
- окремий deadline блокує передчасні повтори незалежно від джерела виклику;
- довгі очікування плануються без переповнення browser timer;
- успішний login/refresh/peer response та завершення session скидають deadline;
- на екрані recovery кнопка показує відлік і недоступна до повтору;
- додано unit assertion на 300 секунд і browser regression для cooldown.

### A-02. Logout не обробляв помилку отримання cross-tab lock

`try/catch` знаходився всередині callback, який виконується лише після отримання
lock. Відмова lock або timeout storage lease відхиляли зовнішній promise;
UI міг лишатися у `logging-out` без retry/cancel.

Тепер catch охоплює всю coordinated operation. UI переходить у
`logout-failed`, приховує tenant content і дозволяє безпечний повтор.
Запит logout не обходить блокування. Browser regression моделює rejected lock,
перевіряє відсутність HTTP logout до успішного lock і подальший retry.

### A-03. Застарілий поточний статус backend README

Прибрано твердження «UI ще не реалізовано» та «можна переходити до Етапу 9».
Історичні досьє не переписуються; чинна функціональна точка залишається 11.1.

## 4. Що лишається у плані

| Пріоритет/момент | Спостереження | Дія |
|---|---|---|
| 11.1 | Access provider бере лише перші 100 organizations і автоматично обирає одну; selector, site list і deep links ще відсутні | Pagination, явний context, перевірка URL/restore через API |
| 11.1–11.4 | Потрібні guarantees під час context change | Cancel старих запитів, очищення cache, перевірка organization/site належності; не показувати дані попереднього tenant |
| До форм створення | Whitespace-only names та невідома timezone проходять backend DTO | Normalize перед validation, IANA timezone validation, регресії; для наявних даних — UI fallback |
| До редактора правил | Невідома metric і надмірний generic config можуть пройти write validation | Перевірка за channel registry, ліміти rules/config |
| 12.4 | Command history має order лише за created_at | Стабільний tie-breaker `id` і перевірка однакових timestamps |
| До real hardware | Policy queued commands після revoke/disable ще не визначена | Узгодити cancel/recheck/audit; фізичні interlocks і manual/remote залишаються задачею контролера |
| До публічного стенда | MQTT anonymous; немає production device identity/TLS/ACL | Окремий production profile; чинний локальний demo не публікувати як production |
| До масштабу | API process запускає MQTT/workers; історія росте без retention | Worker ownership, retention/aggregation, вимірювання latency/lag/навантаження |
| Подальший hardware/module scope | 8 каналів registry та 3 команди; multiple same-type sensor instances, flow/energy, OTA, B2B claim ще не реалізовані | Додавати узгоджені protocol handlers і модель instances поетапно |

Пункти попереднього [backend review](backend-review-after-h-2026-09-27.md)
залишаються backlog, якщо цей документ явно не позначає їх виправленими.
Додавати Kafka/Kubernetes або переписувати PostgreSQL/FastAPI зараз немає підстав.

## 5. Наступна функціональна операція 11.1

Мета: користувач бачить реальні доступні організації та фізичні об'єкти,
обирає їх і може відкрити посилання на конкретний об'єкт після F5.

| Частина | Наявний API | Критерій |
|---|---|---|
| Організації | `GET /organizations?limit=&offset=` | Bounded pagination; не обмежувати доступ першою сотнею |
| Вибрана організація | `GET /organizations/{id}` + `GET /organizations/{id}/access` | URL/збережений id перевіряється сервером |
| Об'єкти | `GET /organizations/{id}/sites?limit=&offset=` | Реальні назви; loading/empty/error; без fallback до demo |
| Deep link | `GET /sites/{id}` | Звірка `organization_id`; чужий/невідомий id не відкриває чужий context |
| Context switch | Чинний auth + scoped QueryClient | Старі запити скасовано; запізнілий response не повертає старий tenant |
| Приймання | Mocked + live E2E, owner/viewer, два tenants | F5, pagination, revoked access, foreign link, network failure |

Усі шляхи API мають prefix `/api/v1`. Нова операція не оголошується завершеною
лише за наявністю коду: потрібні CI та локальне приймання користувачем.
Devices/віджети лишаються наступними 11.2/11.3; повноцінні команди — Етап 12.

Поточне продовження: спочатку перевірити auth-виправлення огляду штатним
`scripts/check-stage10-op4.ps1`, потім реалізовувати 11.1. Статус **8/24**
не збільшується за корекцію дефектів і підготовлений план.

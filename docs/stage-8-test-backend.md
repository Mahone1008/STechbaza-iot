# Етап 8 — Підготовка тестової версії backend

Початок: 26.09.2026. Вхідна точка: завершений Етап 7,
backend 0.31.0, migration 20260925_0015.

**Завершено 26.09.2026: прийнято 6 з 6 операцій.** Тестовий backend
**0.37.0**, migration **20260926_0017**, готовий до початку Етапу 9 — фронтенду.
Прийнята користувачем збірка: **ae0aada**; код повного CI — **38d231a**.
Готовність тестового backend не дорівнює готовності production.

Нижче збережено хронологічний журнал. Проміжні статуси всередині операцій
описують стан на момент їх виконання; актуальний підсумок — ця таблиця
та фінальне локальне приймання операції 6.

| Операція | Робота | Статус |
|---|---|---|
| 1 | API для перших екранів: права, модулі, запити, відповіді й помилки | Закрито 26.09.2026 — CI та локальне приймання пройдено |
| 2 | Авторизація в браузері | Закрито 26.09.2026 — CI та локальне приймання пройдено |
| 3 | Панель і графіки | Закрито 26.09.2026 — CI та локальне приймання пройдено |
| 4 | Демонстраційний стенд | Закрито 26.09.2026 — CI та локальне приймання пройдено |
| 5 | Комплексні перевірки | Закрито 26.09.2026 — CI та локальне приймання пройдено |
| 6 | Приймання тестової збірки | Закрито 26.09.2026 — CI та локальне приймання пройдено |

## Операція 1

Мета — перші екрани отримують дані та дозволені дії через визначений API,
відповідно до конкретного клієнта і його фактичного складу модулів.

Зміни:

- `GET /api/v1/organizations/{organization_id}/access` — актуальні tenant permissions.
- `GET /api/v1/devices/{device_id}/overview` — реквізити, capabilities, ключі,
  команди, availability і nullable snapshot.
- Overview відсікає старі значення вимкнених модулів без видалення історії.
- У базових списках додано ID як другий ключ сортування при однаковому часі.
- В OpenAPI описані нові response models, доступ та validation errors.
- Додано 10 перевірок; загальний набір — 38 tests.
- Backend піднято до 0.32.0; нової міграції не потрібно.

Повний контракт: [Frontend API contract v1](frontend-api-contract-v1.md).

### Перевірки розробки

Локально в середовищі підготовки пройшли 17 тестів, 21 integration test
пропущено через відсутність PostgreSQL/MQTT. Повний набір підтверджено
окремо на GitHub Actions зі справжніми PostgreSQL 16 і Mosquitto 2:

- Код: commit [`030f033`](https://github.com/Mahone1008/STechbaza-iot/commit/030f033f5f5fcf117034138b5ee1bf2df5c50457).
- [Backend checks — run 36262474597](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36262474597).
- Python 3.13; усі міграції порожньої CI-бази до 0015 пройшли.
- Контрольний downgrade 0015 → 0014 → upgrade 0015 у тимчасовій CI-базі пройшов.
- **Ran 38 tests in 4.750s — OK, без пропусків.**
- Усі 10 нових перевірок та 28 попередніх завершилися успішно.

Це підтверджує автоматичні сценарії, але не замінює локальне приймання
користувачем, браузерні перевірки наступної операції чи фізичний пілот.

### Локальні спроби та усунення перешкод — 26.09.2026

1. Перший блок запущено з домашньої папки користувача. Git повернув
   `not a git repository`, Docker Compose —
   `no configuration file provided: not found`. Оновлення, збірка та
   тести не виконалися. Виправлено інструкцію: явний `Set-Location`,
   перевірка папки й один script block `& { ... }` для зупинки при помилці.
2. Наступна спроба успішно оновила main до `457a989`, але Docker повернув
   помилку недоступного `dockerDesktopLinuxEngine`. Блок зупинився
   на `docker compose stop backend`; збірка й тести ще не запускалися.
   Після запуску Docker Desktop користувач виконав блок продовження
   з перевіркою доступності Linux engine.
3. Третя спроба пройшла повністю; її результати наведено нижче.
   Попередні невдалі спроби не зараховувалися як успішні перевірки.

### Локальне приймання — підтверджено 26.09.2026

Перевірено три скриншоти користувача:

| Файл | Що підтверджує |
|---|---|
| image(20260926-183738).png | Docker готовий, backend зібрано, PostgreSQL healthy, міграція 0015 head, нові API-тести проходять |
| image(20260926-183755).png | Перевірки PostgreSQL/MQTT/notifications проходять, навмисний збій MQTT оброблено, виконано 38 тестів |
| image(20260926-183804).png | Підсумковий OK, запуск backend, health 0.32.0, фінальний PASS |

Підтверджені результати:

- **Ran 38 tests in 7.039s — OK, без пропусків.**
- Міграція: **20260925_0015 (head)**.
- `/health`: status `ok`, service `techbaza-backend`, version **0.32.0**.
- Блок завершився зеленим `PASS` після перевірки обох нових маршрутів в OpenAPI.
- Контейнер backend запущено; PostgreSQL healthy, Mosquitto running.
- Перевірено код із main на commit `457a989`;
  backend-зміни операції походять з `030f033`.

Traceback `Injected temporary database processing failure` і
`MQTT message processing must be retried` належать навмисному
сценарію відмови. Тест перевіряє повторну доставку після збою обробки
та завершився `ok`; весь набір також завершився `OK`.

**Операцію 1 закрито. Етап 8 триває: прийнято 1 з 6 операцій,
залишилося 5. Поточний статус операції 2 наведено в таблиці та розділі нижче.**

Це приймання API й автоматичних сценаріїв на локальному стенді.
Перевірки в реальному браузері належать наступній операції.
Production-готовність і фізичний пілот цим результатом не підтверджуються.

### Відтворення перевірки версії 0.32.0

Нижче збережено повний сценарій операції 1. Після переходу main на наступну
версію слід користуватися інструкцією відповідної операції: цей блок
очікує саме 0.32.0 і набір із 38 тестів.

Перед запуском відкрити Docker Desktop і дочекатися готовності двигуна.
Вставити весь блок разом з першим `& {` і останнім `}`.
Він переходить до `%USERPROFILE%\Documents\TechBaza\techbaza-iot`.
Якщо папку перенесено, змінити `$repoPath`.

Помилка зупиняє решту script block. Сценарій не видаляє базу.
Під час фіксації приймання також виправлено пошкоджений фрагмент
PowerShell у попередній версії журналу; результат користувача отримано
за коректним блоком, надісланим у чаті.

```powershell
& {
    $ErrorActionPreference = 'Stop'

    $repoPath = Join-Path $env:USERPROFILE 'Documents\TechBaza\techbaza-iot'
    if (-not (Test-Path -LiteralPath $repoPath -PathType Container)) {
        throw "Не знайдено папку проєкту: $repoPath"
    }
    Set-Location -LiteralPath $repoPath
    if (-not (Test-Path -LiteralPath '.git') -or -not (Test-Path -LiteralPath 'compose.yml' -PathType Leaf)) {
        throw 'У вибраній папці немає .git або compose.yml'
    }

    function Assert-Step([string]$Name) {
        if ($LASTEXITCODE -ne 0) { throw "Помилка: $Name (exit $LASTEXITCODE)" }
    }

    $engine = docker info --format '{{.OSType}}'
    Assert-Step 'Docker недоступний. Запусти Docker Desktop і дочекайся готовності'
    if ($engine.Trim() -ne 'linux') {
        throw 'Для проєкту потрібен режим Linux containers'
    }

    $branch = git branch --show-current
    Assert-Step 'git branch'
    if ($branch.Trim() -ne 'main') { throw 'Потрібна гілка main' }
    $remote = git remote get-url origin
    Assert-Step 'git remote'
    if ($remote.Trim() -notmatch '^https://github\.com/Mahone1008/STechbaza-iot(?:\.git)?/?$') {
        throw "Неочікуваний origin: $remote"
    }
    $changes = git status --porcelain
    Assert-Step 'git status'
    if ($changes) {
        $changes
        throw 'Є локальні зміни. Надішли показаний список перед оновленням.'
    }

    git pull --ff-only origin main
    Assert-Step 'git pull'
    git log -1 --oneline
    Assert-Step 'git log'
    docker compose stop backend
    Assert-Step 'stop backend'
    docker compose build backend
    Assert-Step 'build backend'
    docker compose run --rm -T backend alembic upgrade head
    Assert-Step 'alembic upgrade'
    docker compose run --rm -T backend alembic current
    Assert-Step 'alembic current'
    docker compose run --rm -T -e TECHBAZA_RUN_DB_TESTS=1 -e TECHBAZA_RUN_MQTT_TESTS=1 backend python -m unittest discover -s tests -v
    Assert-Step '38 tests'
    docker compose up -d backend
    Assert-Step 'start backend'

    $health = $null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:8000/health' -TimeoutSec 5
            break
        } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $health -or $health.status -ne 'ok' -or $health.version -ne '0.32.0') {
        docker compose logs --tail 80 backend
        throw 'Очікується /health: ok, version 0.32.0. Надішли показані логи.'
    }
    $spec = Invoke-RestMethod 'http://127.0.0.1:8000/openapi.json' -TimeoutSec 10
    $paths = $spec.paths.PSObject.Properties.Name
    foreach ($path in @('/api/v1/organizations/{organization_id}/access', '/api/v1/devices/{device_id}/overview')) {
        if ($paths -notcontains $path) { throw "Немає нового маршруту: $path" }
    }
    $health | Format-Table
    Write-Host 'PASS: Stage 8 operation 1 — tests and backend 0.32.0 ready' -ForegroundColor Green
}
```

## Операція 2 — авторизація в браузері

Початок: 26.09.2026 після приймання операції 1. Backend **0.33.0**,
нова міграція **20260926_0016**.

Реалізовано:

- Browser login/refresh/logout з HttpOnly, SameSite=Strict refresh cookie.
- Access JSON без refresh secret; access надалі зберігається лише у пам'яті UI.
- Exact Origin + custom header, CORS allowlist, auth no-store і validation без secrets.
- Спільні PostgreSQL-ліміти за IP/account для старого і нового auth flow.
- Негайне відкликання access через server-side session після logout.
- 16 додаткових unittest перевірок, загалом 54; окрема перевірка Chromium у CI.
- Розширено CI міграцією 0016, її rollback/upgrade та реальним браузером.

[Повний контракт і межі](browser-auth-v1.md).
[PowerShell-сценарій перевірки](../scripts/check-stage8-op2.ps1).

### Перевірки розробки

У середовищі підготовки: **Ran 54 tests — OK (skipped=31)**:
23 виконано, 31 потребує PostgreSQL/MQTT і не зараховується тут як пройдений.
Compileall та offline SQL усіх міграцій до 0016 пройшли.
Повний CI підтверджено на коді [2ca71a1](https://github.com/Mahone1008/STechbaza-iot/commit/2ca71a133d1e50257633048a4713fd8f42d4d6af):

- [Backend checks — run 36263951374](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36263951374): success.
- Python 3.13, PostgreSQL 16, Mosquitto 2.
- Створення порожньої БД до 0016, downgrade 0016 → 0015 → upgrade 0016,
  а також downgrade до 0014 та upgrade до head в ізольованій CI-базі пройшли.
- **Ran 54 tests in 5.045s — OK, без пропусків.**
- **PASS: Chromium login, HttpOnly cookie, reload/rotation, CSRF/CORS rejection,
  logout and access revocation.**
- Переглянуто журнал виконання, не лише підсумковий статус job.

Локальне приймання користувачем також підтверджено нижче окремими
скриншотами; тести на фізичному обладнанні сюди не входять.

### Локальне приймання операції 2 — підтверджено 26.09.2026

Користувач надав чотири скриншоти; перевірено всі:

| Файл | Підтверджений результат |
|---|---|
| image(20260926-185354).png | Fast-forward main до 98c8b06, початок збірки backend |
| image(20260926-185411).png | Збірка успішна, upgrade 0015 → 0016, 20260926_0016 (head), нові auth-тести проходять |
| image(20260926-185425).png | Попередні regression/MQTT/notification тести проходять; навмисний MQTT збій оброблено |
| image(20260926-185435).png | 54 тести — OK, backend 0.33.0, CORS 200, CSRF 403, обидва фінальні PASS |

- **Ran 54 tests in 5.349s — OK, без пропусків.**
- Міграція: **20260926_0016 (head)**.
- Backend запущено; PostgreSQL healthy, Mosquitto running.
- Health: status **ok**, service **techbaza-backend**, version **0.33.0**.
- Реальний HTTP CORS preflight з дозволеним origin: **200**.
- Реальний HTTP browser refresh без Origin/CSRF header: **403**.
- Перевірка наявності трьох browser routes в OpenAPI пройшла до фінального PASS.
- Прийнята локальна версія main: **98c8b06**; код операції: **2ca71a1**.

Traceback з `Injected temporary database processing failure` належить
навмисному тесту повторної MQTT-доставки. Сам тест завершився `ok`.
Реальний Chromium перевірено окремо у CI; ці локальні скриншоти підтверджують
Docker/PostgreSQL/MQTT/HTTP перевірки на комп'ютері користувача.

### Відтворення перевірки версії 0.33.0

Відкрити Docker Desktop, дочекатися готовності Linux engine, оновити main.
Сценарій зупиняє backend на час тестів, збирає image, застосовує міграцію,
виконує весь unittest набір, запускає backend та перевіряє реальний HTTP.

Очікується:

- migration `20260926_0016 (head)`;
- **Ran 54 tests ... OK**, без skipped;
- health `ok`, version **0.33.0**;
- CORS preflight **200**, browser refresh без Origin/header **403**;
- фінальний зелений **PASS**.

Сценарій використовує локальний origin за замовчуванням
`http://127.0.0.1:3000`; при власному AUTH_BROWSER_ORIGINS слід узгодити
origin у перевірці. Паролі або реальні refresh tokens для запуску не потрібні.
Цей сценарій збережено для відтворення прийнятої версії 0.33.0.
Після наступного оновлення main використовувати інструкції відповідної операції.

**Операцію 2 закрито. Етап 8 триває: прийнято 2 з 6 операцій,
залишилося 4. Подальший стан операції 3 наведено нижче.**

## Операція 3 — дані панелі та графіків

Початок: 26.09.2026 після приймання операції 2. Backend **0.34.0**,
нова міграція **20260926_0017**.

Реалізовано:

- В overview додано telemetry_freshness і readings: давність та якість
  показань окремо від online heartbeat; без підміни пропусків нулем.
- Новий GET telemetry/series для числових метрик enabled capabilities:
  UTC-період [start, end), min/max/average/count, явні порожні інтервали.
- Не більше 7 днів, 1000 інтервалів і 100000 вхідних пакетів;
  SQL timeout 3 секунди, явна відмова замість прихованого обрізання графіка.
- Tenant/RBAC-перевірки, фільтрація вимкнених модулів, no-store.
- Міграція розширює індекс telemetry_messages до (device_id, received_at, id),
  стабільний UUID tie-break для сирої історії. Дані не видаляються.
- 7 unit і 13 PostgreSQL-тестів, загалом **74**; CI перевіряє rollback індексу.

[Контракт, алгоритми, обмеження і сценарії](telemetry-panel-charts-v1.md).
[PowerShell-сценарій](../scripts/check-stage8-op3.ps1).

### Перевірки розробки

У середовищі підготовки: **Ran 74 tests in 1.177s — OK (skipped=44)**.
30 виконано, 44 потребують PostgreSQL/MQTT; пропущені не зараховано як успішні.
Compileall і offline SQL міграцій до 0017 пройшли.

Повний CI підтверджено на коді
[e96793b](https://github.com/Mahone1008/STechbaza-iot/commit/e96793b3fbc6676e7122c9eb6b69ba45a0f8fcaf):

- [Backend checks — run 36264996670](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36264996670): **success**.
- Python 3.13, PostgreSQL 16, Mosquitto 2.
- Міграція порожньої бази до 0017 та контрольні downgrade/upgrade
  до 0016, 0015, 0014 і назад до head успішні в ізольованій CI-базі.
- **Ran 74 tests in 6.591s — OK, без пропусків.**
- Усі 20 нових тестів телеметрії та 54 попередніх перевірки пройшли.
- **PASS: Chromium login, HttpOnly cookie, reload/rotation, CSRF/CORS rejection,
  logout and access revocation.**
- Перевірено журнал job 108467870343, включно з результатами нових тестів,
  підсумком unittest і реальним браузерним сценарієм.

Цей результат не замінює локальне приймання користувачем нижче.

### Локальне приймання операції 3 — підтверджено 26.09.2026

Перевірено всі чотири скриншоти користувача з Windows PowerShell:

| Файл | Підтверджений результат |
|---|---|
| image(20260926-191238).png | Fast-forward main до 0d6928d, зупинка backend, початок успішної збірки |
| image(20260926-191256).png | Image Built, upgrade 0016 → 0017, 20260926_0017 (head), auth та попередні regression tests проходять |
| image(20260926-191313).png | Навмисний збій MQTT оброблено, повторна доставка завершується ok; notification і нові telemetry tests проходять |
| image(20260926-191325).png | Завершення нових telemetry tests, 74 тести — OK, запуск backend 0.34.0 і обидва фінальні PASS |

Підтверджено:

- **Ran 74 tests in 6.705s — OK, без пропусків.**
- Міграція: **20260926_0017 (head)**.
- Health: status **ok**, service **techbaza-backend**, version **0.34.0**.
- Backend запущено; PostgreSQL healthy, Mosquitto running.
- Успішна перевірка маршруту series та полів telemetry_freshness/readings в OpenAPI.
- Реальний HTTP-запит до series без JWT відхилено з **401**.
- Обидві зелені строки **PASS** підтверджують завершення всього блоку.
- Прийнята локальна версія main: **0d6928d**; код операції: **e96793b**.

Traceback `Injected temporary database processing failure` та
`MQTT message processing must be retried` належать навмисному сценарію
тимчасової відмови обробки. Тест завершився `ok`; підсумок усього набору —
`OK`. Це не помилка локального приймання.

Ці скриншоти підтверджують Docker/PostgreSQL/MQTT/HTTP перевірки на
комп'ютері користувача. Окремий Chromium-сценарій підтверджено у CI вище;
новий frontend та фізичне обладнання цією операцією не приймалися.

### Відтворення перевірки версії 0.34.0

Сценарій [check-stage8-op3.ps1](../scripts/check-stage8-op3.ps1) збережено
для прийнятої версії 0.34.0: 74 тести, міграція 0017, health і HTTP 401.
Після наступного оновлення main використовувати сценарій відповідної операції.

**Операцію 3 закрито. Етап 8 триває: прийнято 3 з 6 операцій,
залишилося 3. Подальший статус операції 4 наведено нижче.**

## Операція 4 — демонстраційний стенд

Початок: 26.09.2026 після приймання операції 3. Backend **0.35.0**,
міграція залишається **20260926_0017**.

Реалізовано:

- Окремий compose.demo.yml: project techbaza-demo, PostgreSQL/MQTT/volumes,
  API лише на 127.0.0.1:8001; основна локальна база не використовується.
- Випадкові credentials у локальному .env.demo, seed з opt-in і перевіркою
  БД, атомарністю, стабільними UUID та повтором без скидання історії/паролів.
- Два tenants, чотири облікові записи та шість модульних пристроїв:
  pump, pressure, stale, offline, new, other.
- Постійний MQTT simulator з ACK/Result, сценаріями alarm/gap/fault/offline,
  durable SQLite станом, дедуплікацією та outbox відповідей.
- Справжня HTTP/MQTT перевірка login/roles, телеметрії, команд, графіка,
  alarm/notification/recovery та restart контейнера симулятора.
- 12 нових unit tests, загалом **86**; окремий CI job для Compose demo.

[Повна інструкція, склад і межі](demo-stand-v1.md).
[PowerShell перевірка](../scripts/check-stage8-op4.ps1).

### Перевірки розробки

Локально у середовищі підготовки: **Ran 86 tests in 1.200s — OK (skipped=44)**.
42 виконано; 44 DB/MQTT tests тут пропущено, вони потребують повного CI.
Compileall пройшов.

Повний CI підтверджено на коді
[047feaf](https://github.com/Mahone1008/STechbaza-iot/commit/047feaf6a4f37a1fcab0e55e69b8bba85af55625):

- [Backend checks — run 36265982282](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36265982282): обидва jobs **success**.
- Job hardening: Python 3.13, PostgreSQL 16, Mosquitto 2;
  міграції/rollback/upgrade до 0017, **86 tests in 6.411s — OK без пропусків**,
  окремий Chromium login/cookie/rotation/CSRF/CORS/logout/revocation — PASS.
- Job demo: справжня збірка Docker image з compose.demo.yml;
  **86 tests in 6.563s — OK без пропусків** у конфігурації demo.
- Seed created, потім seed already exists; дані й паролі збережено.
- PASS: чотири login, tenant isolation, viewer 403, модульні/live/stale/offline/new стани.
- PASS: HTTP commands → MQTT ACK/Result, request_id deduplication, telemetry і actor audit.
- PASS: графік, low-pressure alarm, acknowledge, персональне прочитання,
  recovery, gap і повернення показань.
- PASS: VFD failure повертає failed; Stop дозволений; normal відновлено.
- PASS: реальний restart simulator зберіг стан і command ledger,
  boot sessions змінилися; HTTP-перевірка після restart успішна.
- Переглянуто журнали jobs **108470612379** і **108470800426**,
  включно з підсумками тестів та всіма PASS, не лише статусами jobs.

Навмисні MQTT Traceback у regression tests завершилися успішною повторною
доставкою та OK. CI demo зупинено після перевірки; локальний користувацький
demo сценарій залишає контейнери запущеними для подальшої роботи.

### Локальне приймання — підтверджено 26.09.2026

Переглянуто всі сім скриншотів користувача з Windows PowerShell:

| Файл | Що підтверджує |
|---|---|
| image(20260926-193137).png | Fast-forward main до afb637f, створення .env.demo без виведення паролів, збірка demo image |
| image(20260926-193155).png | Окремі ресурси techbaza-demo, міграції порожньої бази 0001 → 0017, 20260926_0017 (head), початок тестів |
| image(20260926-193208).png | Demo та regression tests проходять; навмисний тимчасовий збій обробки MQTT у тесті повторної доставки |
| image(20260926-193221).png | Повторна доставка завершується ok; Ran 86 tests in 6.997s — OK без пропусків; перше створення demo-даних |
| image(20260926-193233).png | Маніфест чотирьох облікових записів і шести пристроїв із різним складом модулів |
| image(20260926-193246).png | Повторний seed: already exists; дані й паролі збережено, ідентифікатори незмінні |
| image(20260926-193301).png | Усі живі HTTP/MQTT сценарії PASS, фактичний restart simulator, перевірка збереження стану/журналу, health 0.35.0 і фінальний PASS |

Підтверджені результати:

- Перевірено main на commit [afb637f](https://github.com/Mahone1008/STechbaza-iot/commit/afb637f025fdf3ad16710f7095d16a8f4c63326b);
  код операції — [047feaf](https://github.com/Mahone1008/STechbaza-iot/commit/047feaf6a4f37a1fcab0e55e69b8bba85af55625).
- **Ran 86 tests in 6.997s — OK, без пропусків.**
- Міграція окремої demo-бази: **20260926_0017 (head)**.
- Seed створив дві організації, чотири облікові записи та шість пристроїв.
  Повторний запуск зберіг дані й паролі.
- **PASS:** чотири входи, tenant isolation, viewer 403,
  модульні набори й стани live/stale/offline/new.
- **PASS:** HTTP commands → MQTT ACK/Result,
  повторний request_id без повторного виконання, телеметрія та actor audit.
- **PASS:** графік, аварія низького тиску, acknowledge,
  персональне прочитання notification, recovery і gap.
- **PASS:** VFD fault повертає failed; Stop доступний; normal відновлено.
- **PASS:** справжній перезапуск контейнера simulator зберіг стан пристроїв
  і журнал команд; boot sessions оновилися.
  Повторна швидка HTTP-перевірка після restart пройшла.
- `/health`: status `ok`, service `techbaza-backend`, version **0.35.0**.
- Backend і PostgreSQL healthy; Mosquitto та simulator запущені.
  Demo API доступний на **http://127.0.0.1:8001**,
  Swagger — **http://127.0.0.1:8001/docs**.
  PostgreSQL і MQTT не публікують порти на host.
- Блок завершився фінальним зеленим **PASS**.

Traceback `Injected temporary database processing failure` належить
навмисному regression-сценарію. Повторна доставка завершилася `ok`,
а повний набір — `OK`; це не помилка запуску стенду.

**Операцію 4 закрито. Прийнято 4 з 6 операцій Етапу 8; залишилося 2:
операція 5 — комплексні перевірки, операція 6 — приймання тестової збірки
з перевіркою чистого встановлення й резервного копіювання/відновлення.
Операції 5–6 ще не розпочаті; Етап 8 триває.**

Приймання підтверджує роботу програмного demo-стенду й перевірених
сценаріїв. Випробування з фізичним обладнанням і production-готовність
залишаються окремими задачами.

## Операція 5 — Комплексні перевірки

Мета — перевірити взаємодію функцій та відновлення після відмов процесів.
Backend **0.36.0**, міграція без змін: **20260926_0017**.

Зміни:

- 12 нових HTTP/JWT/PostgreSQL сценаріїв: одночасні command requests,
  конфлікти request_id/actor, зміни membership/module через HTTP,
  відмова невалідним запитам без побічних дій, tenant/anonymous/session guards,
  publish retry, expiry, Result до ACK, неправильний Device UID,
  duplicate/old-session telemetry → snapshot/alarm/notification/chart.
- Загальний regression suite — **98 тестів**.
- Строгий runner відхиляє будь-який skipped test, error/failure або порожній набір.
- Живий Compose-сценарій: справжній restart backend із queued commands,
  TTL expiry без пізнього виконання, справжній stop/start MQTT broker,
  відновлення delivery/телеметрії/аварій та робочий Stop.
- Збережено повторення Chromium auth і demo-сценаріїв операції 4,
  включно зі справжнім restart simulator.
- [Матриця сценаріїв і межі перевірки](comprehensive-checks-v1.md).
- [PowerShell для локального приймання](../scripts/check-stage8-op5.ps1).

### Перевірки розробки

У середовищі підготовки немає PostgreSQL/Mosquitto/Docker.
Unittest discovery: **98 tests in 1.209s — OK (skipped=56)**;
фактично виконано 42, 56 integration tests тут не запускалися.
Цей частковий запуск не зараховано як повне приймання.
Повний CI підтверджено на commit
[9b84fa2](https://github.com/Mahone1008/STechbaza-iot/commit/9b84fa2f2fc2e23b57c4b180835a7b14bf774225).

- [Backend checks — run 36267006983](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36267006983): **success**, обидва jobs успішні.
- Hardening job **108473501647**: Python 3.13, PostgreSQL 16, Mosquitto 2,
  міграції та rollback/upgrade 0017/0016/0015/0014 — успішні;
  **Ran 98 tests in 7.657s — OK, zero skips**.
- Chromium: login, HttpOnly cookie, reload/refresh rotation, CSRF/CORS rejection,
  logout та access revocation — **PASS**.
- Demo job **108473691531**: справжня Docker image і Compose environment;
  **Ran 98 tests in 8.064s — OK, zero skips**.
- Seed created, потім already exists зі збереженням даних/паролів — **PASS**.
- Живі HTTP/MQTT сценарії операції 4 та фактичний restart simulator — **PASS**.
- Offline/stale/одна active offline alarm, дві queued commands — **PASS**.
- Фактичний restart backend зберіг IDs, created_at/expires_at та чергу.
  Коротка команда expired з нульовими publish, довга succeeded після
  normal/reconnect; повтор HTTP не створив нової команди — **PASS**.
- Фактичний stop broker: HTTP продовжує читати дані, device offline,
  readings stale, нова команда queued — **PASS**.
- Start broker: telemetry/commands відновлено, offline incident resolved
  рівно один раз, перевірено Start/показання/Stop; насос зупинено — **PASS**.
- Фінальна quick HTTP-перевірка — **PASS**. CI demo зупинено після перевірок.

Переглянуто журнали обох jobs, підсумки тестів і всі live PASS.
Навмисні MQTT Traceback належать тесту повторної доставки після тимчасової
помилки БД. PostgreSQL duplicate-key log у конкурентному тесті очікуваний:
unique constraint відхиляє другий INSERT, сервіс повертає первинну команду;
HTTP відповіді 201/200, один record і один publish підтверджені тестом.
Ці записи не були приховані або зараховані як неперевірені помилки.

CI підтверджує автоматичне приймання у своєму середовищі.
Окреме локальне приймання користувачем наведено нижче.

### Локальне приймання — підтверджено 26.09.2026

Переглянуто всі шість скриншотів користувача з Windows PowerShell:

| Файл | Що підтверджує |
|---|---|
| image(20260926-194947).png | Fast-forward main до 2f3c45a; зупинка demo workers, успішна збірка image та запуск залежностей |
| image(20260926-194958).png | 20260926_0017 (head); browser auth, усі 12 нових comprehensive tests, demo та frontend tests проходять |
| image(20260926-195013).png | Regression PostgreSQL/MQTT tests; навмисний збій обробки, повторна доставка і завершення відповідного тесту ok |
| image(20260926-195025).png | Ran 98 tests in 7.630s — OK; PASS: 98 backend tests, zero skips; seed already exists, дані й паролі збережено |
| image(20260926-195041).png | Маніфест різних модулів шести demo-пристроїв; запуск стенду; PASS живих прав, HTTP/MQTT, графіків, аварій та VFD failure |
| image(20260926-195138).png | Simulator restart, backend restart/queue/TTL, broker stop/start/recovery — PASS; health 0.36.0, compose ps та фінальний зелений PASS |

Підтверджені результати:

- Прийнято код із main на commit
  [2f3c45a](https://github.com/Mahone1008/STechbaza-iot/commit/2f3c45adbb2d706709fb0f092fbe3f7699a3918f);
  реалізація операції — 9b84fa2.
- **Ran 98 tests in 7.630s — OK, без пропусків.**
  Строгий runner окремо вивів **PASS: 98 backend tests, zero skips**.
- Міграція: **20260926_0017 (head)**.
- Повторний seed зберіг існуючі demo-дані й паролі.
- Права/tenant isolation, модульні стани, HTTP commands → MQTT ACK/Result,
  request_id deduplication, actor audit, графік, аварія/acknowledge,
  персональне прочитання, recovery/gap і VFD fault/Stop — **PASS**.
- Фактичний restart simulator зберіг стан пристроїв і command ledger;
  boot sessions змінилися — **PASS**.
- Offline/stale та одна активна offline alarm; дві команди залишилися queued.
- Фактичний restart backend зберіг чергу й TTL. Діюча команда виконалася
  після відновлення; прострочена не була опублікована — **PASS**.
- При зупиненому MQTT broker HTTP залишався доступним, API показав
  offline/stale/alarm, нова команда лишилася queued — **PASS**.
- Після запуску broker відновилися telemetry/commands, offline incident
  закрився; demo-насос зупинено. Фінальна quick HTTP-перевірка — **PASS**.
- `/health`: status `ok`, service `techbaza-backend`, version **0.36.0**.
- Backend і PostgreSQL healthy; broker і simulator запущені.
  Demo API — **http://127.0.0.1:8001**, Swagger — **http://127.0.0.1:8001/docs**.
- Фінальний зелений **PASS: Stage 8 operation 5 — 98 tests, zero skips,
  live scenarios and recovery verified**.

Traceback `Injected temporary database processing failure` та
`MQTT message processing must be retried` належать навмисній відмові
в regression test. Повторна доставка і весь набір завершилися успішно.
Повідомлення `Stage 8 operation 4 — live demo acceptance complete`
означає повторення попередніх demo-сценаріїв усередині операції 5.

**Операцію 5 закрито. Прийнято 5 з 6 операцій Етапу 8.
Залишилася операція 6 — приймання тестової збірки: чисте встановлення,
резервне копіювання та відновлення. Операція 6 ще не розпочата;
Етап 8 триває.**


## Операція 6 — Чисте встановлення та backup/restore

Мета — підтвердити встановлення з tracked source на порожню БД,
точне відновлення backup поточного demo та роботу відновленого стенду.
Backend **0.37.0**, міграція без змін: **20260926_0017**.

- Окремий Compose без host ports і з унікальними projects/volumes.
- Чистий `git archive HEAD`, збірка без cache, усі міграції,
  **109 regression tests** і живий demo test на чистому стенді.
- Backup PostgreSQL, SQLite стану simulator, environment і Git source;
  SHA-256 manifest. Звичайний demo зупиняється лише на узгоджений знімок.
- Restore у нову порожню БД; точне порівняння схеми й усіх public rows
  до запуску workers. Повний round-trip SQLite і command ledger.
- Явна транзакційна recovery policy: відкликання старих sessions,
  заборона повторної доставки commands з backup, збереження історії.
- Фактичний HTTP canary: старі access/refresh → 401, queued STOP не
  публікується і не оживає при повторному request_id; новий login працює.
- Живий HTTP/MQTT test відновленої копії, health 0.37.0 звичайного demo,
  приватний acceptance-report.json, cleanup лише тимчасових projects.
- [Backup/restore — процедура та обмеження](backup-restore-v1.md).
- [Тестова збірка — готовність до фронтенду та production backlog](test-backend-release-v1.md).
- [Єдиний PowerShell сценарій](../scripts/check-stage8-op6.ps1).

### Перевірки розробки

Локальний discovery: **Ran 109 tests in 1.204s — OK (skipped=60)**.
Фактично виконано 49; 60 PostgreSQL/MQTT integration tests потребують
оточення CI. Частковий запуск не є повним прийманням.
Нові перевірки охоплюють пошкоджений bundle, SQLite WAL, відмову
перезапису, opt-in, транзакційність та ідемпотентність restore policy.

### Невдалі спроби CI та виправлення

Перші прогони зупинилися на порівнянні restore; як приймання їх не зараховано:

- [36268246247](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36268246247), commit 3f61b79;
- [36268559498](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36268559498), commit f87e216;
- [36268669333](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36268669333), commit 08d949f.

Діагностика третього прогону підтвердила: **вміст і кількість рядків усіх
20 таблиць збіглися**. Відмінність стосувалася SQL-запису CHECK у семи
таблицях: після pg_dump/restore PostgreSQL переносить cast varchar[] →
text[] на окремі елементи масиву. Логічне обмеження при цьому те саме.
Порівняння цього точного еквівалентного запису нормалізовано; самі
constraints не пропускаються і дозволені значення не вилучаються.
PostgreSQL regression test перевіряє round-trip, а також те, що додавання
нової дозволеної ролі або зміна timestamp timezone все одно виявляються.

Окремо перед фінальним прийманням усунено втрату точності у fingerprint:
числа PostgreSQL/JSONB більше не проходять через Python float. Тест
розрізняє numeric і JSONB значення, що відрізняються за межами точності
float. Загальний набір збільшено з 107 до **109 tests**.

### Повний CI — підтверджено 26.09.2026

Перевірений код: commit
[38d231a](https://github.com/Mahone1008/STechbaza-iot/commit/38d231ae691c966cc6b8e6d41e2f6317fd929c83).
[Backend checks — run 36269123220](https://github.com/Mahone1008/STechbaza-iot/actions/runs/36269123220):
**success**, обидва jobs завершилися успішно; переглянуто їх журнали.

| Перевірка | Результат |
|---|---|
| Hardening job 108479575336: Python 3.13/PostgreSQL 16/Mosquitto 2 | 109 tests in 8.438s — OK, zero skips |
| Міграції порожньої БД та downgrade/upgrade | PASS, head 20260926_0017 |
| Chromium login/cookie/rotation/CSRF/CORS/logout/revocation | PASS |
| Demo job 108479774508: зібраний Docker image | 109 tests in 7.864s — OK, zero skips |
| Попередні live demo, simulator/backend restart, broker outage/recovery | PASS |
| Чистий git archive, build без cache, порожні volumes, всі міграції | PASS |
| Regression suite на чистій установці | 109 tests in 8.044s — OK, zero skips |
| Seed і живі HTTP/MQTT на чистій установці | PASS |
| Backup реального CI demo: PostgreSQL + SQLite + environment + source | PASS |
| Розміри та SHA-256 усіх файлів bundle | PASS |
| Restore у порожню БД: усі 20 таблиць, усі рядки, схема | PASS, точне порівняння до recovery policy |
| SQLite device state, command ledger і pending rows | PASS, усі рядки збігаються до boot |
| Нові boot sessions зі збереженням стану та ledger | PASS |
| Відкликання sessions і заборона автоматичного command replay | PASS |
| Старі access/refresh після restore | HTTP 401, двічі: до та після live test |
| Контрольна queued STOP із backup | expired, 0 publish attempts; повтор request_id не відновив доставку |
| Новий login і повний HTTP/MQTT test на відновленому стенді | PASS |
| Звичайний demo після перевірки | health ok, backend 0.37.0; quick HTTP PASS |
| Acceptance report і cleanup лише тимчасових projects/volumes | PASS |

Фінальний console result:
`PASS: Stage 8 operation 6 - clean install, exact backup/restore, safe recovery, demo 0.37.0`.

CI перевірив актуальний PowerShell сценарій повністю. Неуспішні попередні
прогони не підмінено цим результатом: їх причину й виправлення наведено вище.
Приватні dump/environment/canary files як CI artifacts не публікувалися.

### Локальне приймання — підтверджено 26.09.2026

Переглянуто всі **11 скриншотів** користувача з Windows PowerShell.
Прийнятий commit:
[ae0aada](https://github.com/Mahone1008/STechbaza-iot/commit/ae0aadacf8bb571f723f9067aeaec055c0671776).
Запуск: **20260926-233445-7e358328**.

| Скриншот | Підтвердження |
|---|---|
| image(20260926-203917).png | Fast-forward main до ae0aada, правильний репозиторій STechbaza-iot, успішна збірка Docker image |
| image(20260926-203933).png | Нові clean volumes, порожня БД, повний ланцюжок міграцій до 20260926_0017 (head), початок backup/auth tests |
| image(20260926-203946).png | Browser auth, comprehensive, simulator, frontend API, hardening tests; початок навмисного MQTT failure сценарію |
| image(20260926-203959).png | Повторна доставка MQTT завершилася ok; нові restore/precision/CHECK tests і telemetry checks — ok; Ran 109 tests in 7.454s |
| image(20260926-204009).png | OK, PASS: 109 backend tests, zero skips; seed створив нові demo identities у чистій БД |
| image(20260926-204432).png | Усі живі сценарії на чистому стенді — PASS; clean project видалено; звичайний demo оновлено, повторний seed зберіг дані й паролі |
| image(20260926-204443).png | Збережено demo identities, ролі та різний набір capabilities пристроїв |
| image(20260926-204455).png | Live source demo — PASS; контрольні login/queued STOP; знімок 20 таблиць, SQLite backup, бінарний dump, SHA-256; source відновив роботу; restore target порожній |
| image(20260926-204507).png | PASS: schema and all 20 tables match; відновлена БД на 0017 head; seed підтвердив збереження identities/паролів |
| image(20260926-204526).png | SQLite rows збігаються; recovery policy застосовано; стан і ledger пережили новий boot; старі access/refresh відхилено, STOP не повторився; live restore scenarios і повторна перевірка захисту — PASS |
| image(20260926-204536).png | Health ok / techbaza-backend / 0.37.0; report routine — PASS; тимчасовий restore project і volumes видалено; звичайний demo працює на 8001; фінальний зелений PASS |

Підсумок локального приймання:

- **109 tests in 7.454s — OK, zero skips.**
- Чисте встановлення зі tracked source, усі міграції, seed і живі
  HTTP/MQTT сценарії виконані успішно.
- PostgreSQL backup відновлено в окрему порожню БД. **Усі 20 таблиць,
  кількість та вміст рядків і схема збіглися до recovery policy.**
- SQLite state, command ledger і pending rows відновлені; нові boot sessions
  зберегли стан пристроїв та історію виконання.
- Старі sessions відкликані, автоматична доставка commands із backup
  заблокована. Контрольні access/refresh отримали HTTP 401; queued STOP
  лишилася expired з 0 publish attempts і не ожила при повторному request_id.
  Перевірено до та після живих команд на відновленому стенді.
- Права, ізоляція tenants, модулі, HTTP → MQTT ACK/Result, deduplication,
  actor audit, графіки, аварії/acknowledge, персональне прочитання,
  recovery/gap, VFD fault та доступність Stop — **PASS**.
- Звичайний demo відновив роботу; backend і PostgreSQL healthy,
  broker і simulator запущені. `/health`: **ok, techbaza-backend, 0.37.0**.
- Backup та `acceptance-report.json` залишені локально в
  `backups/acceptance-20260926-233445-7e358328/`.
  Створення звіту підтверджене успішним завершенням report routine;
  приватні файли користувач не передавав.
- Тимчасові clean/restore projects та їх volumes прибрані.
- Фінальний зелений результат:
  `PASS: Stage 8 operation 6 - clean install, exact backup/restore, safe recovery, demo 0.37.0`.

Traceback `Injected temporary database processing failure` і
`MQTT message processing must be retried` належать навмисній відмові
в тесті. Повторна доставка завершилася `ok`, весь набір — `OK` без skips.
Рядок `Stage 8 operation 4 - live demo acceptance complete` означає
повторне використання живих demo-сценаріїв усередині операції 6.

**Операцію 6 закрито. Етап 8 завершено: прийнято 6 з 6 операцій.**
Можна переходити до Етапу 9 — фронтенду, з тією самою схемою:
одна операція, пояснення, зміни в main, автоматичні перевірки,
локальне приймання користувачем, потім наступна операція.
Роботи Етапу 9 цим записом не розпочато.

Готовність стосується першої тестової версії backend і програмного demo.
Окремі production/hardware критерії та подальші функції перелічені в
[описі тестової збірки](test-backend-release-v1.md).

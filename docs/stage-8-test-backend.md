# Етап 8 — Підготовка тестової версії backend

Початок: 26.09.2026. Вхідна точка: завершений Етап 7,
backend 0.31.0, migration 20260925_0015.

Етап містить шість операцій. Після їх приймання можна починати Етап 9 —
фронтенд. Готовність тестового backend не дорівнює готовності production.

| Операція | Робота | Статус |
|---|---|---|
| 1 | API для перших екранів: права, модулі, запити, відповіді й помилки | Закрито 26.09.2026 — CI та локальне приймання пройдено |
| 2 | Авторизація в браузері | Реалізовано у 0.33.0; очікується CI та локальне приймання |
| 3 | Панель і графіки | Не розпочато |
| 4 | Демонстраційний стенд | Не розпочато |
| 5 | Комплексні перевірки | Не розпочато |
| 6 | Приймання тестової збірки | Не розпочато |

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
Повний результат PostgreSQL/MQTT/Chromium у CI буде записаний окремо.

### Локальне приймання операції 2

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
Знімки результатів користувача чи його «є/есть» закривають операцію.

**Операція 2 ще не закрита. Операція 3 не починається до її приймання.**

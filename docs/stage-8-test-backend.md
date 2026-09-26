# Етап 8 — Підготовка тестової версії backend

Початок: 26.09.2026. Вхідна точка: завершений Етап 7,
backend 0.31.0, migration 20260925_0015.

Етап містить шість операцій. Після їх приймання можна починати Етап 9 —
фронтенд. Готовність тестового backend не дорівнює готовності production.

| Операція | Робота | Статус |
|---|---|---|
| 1 | API для перших екранів: права, модулі, запити, відповіді й помилки | Реалізовано у 0.32.0; очікується локальна перевірка користувача |
| 2 | Авторизація в браузері | Не розпочато |
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
пропущено через відсутність PostgreSQL/MQTT. Це не зараховується як
повний набір. Підсумок CI із реальними PostgreSQL/MQTT буде записано після
запуску на опублікованому commit.

### Локальне приймання користувачем

Виконати наступний блок у PowerShell з кореня локального STechbaza-iot.
Він перевіряє репозиторій, оновлює main, збирає backend, перевіряє
міграцію, запускає всі тести й піднімає сервіс. База не видаляється.

```powershell
$ErrorActionPreference = 'Stop'

function Assert-Step([string]$Name) {
    if ($LASTEXITCODE -ne 0) { throw "Помилка: $Name (exit $LASTEXITCODE)" }
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
if ($changes) { throw 'Є локальні зміни. Надішли git status --short перед оновленням.' }

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
    throw 'Очікується /health: ok, version 0.32.0. Надішли docker compose logs --tail 80 backend.'
}
$spec = Invoke-RestMethod 'http://127.0.0.1:8000/openapi.json' -TimeoutSec 10
$paths = $spec.paths.PSObject.Properties.Name
foreach ($path in @('/api/v1/organizations/{organization_id}/access', '/api/v1/devices/{device_id}/overview')) {
    if ($paths -notcontains $path) { throw "Немає нового маршруту: $path" }
}
$health | Format-Table
Write-Host 'PASS: Stage 8 operation 1 — tests and backend 0.32.0 ready' -ForegroundColor Green
```

Очікується migration `20260925_0015 (head)`, **Ran 38 tests ... OK без
skipped**, `/health` — `ok` / `0.32.0`, фінальний зелений PASS.
Traceback `Injected temporary database processing failure` у MQTT-тесті
навмисний; оцінювати слід підсумковий статус тесту й усього набору.
При помилці блок припиняється: потрібно розібрати її до наступної операції.

**Операцію 1 не закрито:** очікується результат користувача або «є/есть»,
якщо всі очікувані перевірки пройшли. Операція 2 до цього не починається.

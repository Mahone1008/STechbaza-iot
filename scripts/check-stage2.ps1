param()
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$project = 'techbaza-stage2-check'
$existing = docker ps -aq --filter "label=com.docker.compose.project=$project"
if ($LASTEXITCODE -ne 0) { throw 'Docker недоступний' }
if ($existing) { throw 'Окремий stage2-check вже існує. Перевірте його перед повторним запуском.' }
$compose = @('compose', '-p', $project, '--env-file', '.env.demo', '-f', 'compose.demo.yml')
try {
    & docker @compose build backend
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed' }
    & docker @compose up -d --wait --wait-timeout 90 postgres mosquitto
    if ($LASTEXITCODE -ne 0) { throw 'Isolated test services failed' }
    & docker @compose run --rm -T --no-deps backend alembic upgrade head
    if ($LASTEXITCODE -ne 0) { throw 'Migration failed' }
    foreach ($suite in @('test_equipment*.py', 'test_onboarding_postgres.py', 'test_label_accounts_postgres.py', 'test_controller_lifecycle_postgres.py')) {
        & docker @compose run --rm -T --no-deps -e TECHBAZA_RUN_DB_TESTS=1 backend python -m unittest discover -s tests -p $suite -v
        if ($LASTEXITCODE -ne 0) { throw "Stage 2 check failed: $suite" }
    }
    Write-Host 'PASS: ізольовані перевірки етапу 2; фізичні контролери не використовувалися.'
} finally {
    & docker @compose down -v --remove-orphans
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Не вдалося прибрати окремі test-сервіси; перевірте techbaza-stage2-check.' }
}

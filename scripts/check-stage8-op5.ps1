# Етап 8/5. Лише окремий techbaza-demo; дані та .env.demo зберігаються.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

function Assert-Step([string]$Name) {
    if ($LASTEXITCODE -ne 0) { throw "Failed: $Name (exit $LASTEXITCODE)" }
}
function Demo {
    & docker compose -p techbaza-demo --env-file .env.demo -f compose.demo.yml @args
    Assert-Step 'demo Docker Compose command'
}

$engine = docker info --format '{{.OSType}}'
Assert-Step 'Docker Desktop must be running'
if ($engine.Trim() -ne 'linux') { throw 'Linux containers are required' }
if (-not (Test-Path -LiteralPath '.env.demo' -PathType Leaf)) {
    throw 'Missing .env.demo from accepted operation 4. Do not regenerate existing demo credentials.'
}

Demo stop backend simulator
Demo build backend
Demo up -d postgres mosquitto
Demo run --rm -T backend alembic upgrade head
Demo run --rm -T backend alembic current
Demo run --rm -T -e TECHBAZA_RUN_DB_TESTS=1 -e TECHBAZA_RUN_MQTT_TESTS=1 backend python -m app.tools.backend_check
Demo run --rm -T backend python -m app.demo.seed
Demo up -d --wait --wait-timeout 90 backend simulator

try {
    Demo exec -T backend python -m app.demo.check
    Demo exec -T simulator python -m app.demo.simulator checkpoint
    Demo restart simulator
    Demo exec -T simulator python -m app.demo.simulator verify-restart
    Demo exec -T backend python -m app.demo.check --quick

    Demo exec -T backend python -m app.demo.resilience prepare-restart
    Demo restart backend
    Demo exec -T backend python -m app.demo.resilience verify-restart

    Demo stop mosquitto
    Demo exec -T backend python -m app.demo.resilience broker-down
    Demo start mosquitto
    Demo exec -T backend python -m app.demo.resilience broker-recovered
    Demo exec -T backend python -m app.demo.check --quick
}
catch {
    Write-Host 'Checks failed. Restoring demo services; no data is deleted.' -ForegroundColor Yellow
    & docker compose -p techbaza-demo --env-file .env.demo -f compose.demo.yml start mosquitto
    & docker compose -p techbaza-demo --env-file .env.demo -f compose.demo.yml up -d --wait --wait-timeout 90 backend simulator
    & docker compose -p techbaza-demo --env-file .env.demo -f compose.demo.yml exec -T simulator python -m app.demo.simulator scenario pump normal
    & docker compose -p techbaza-demo --env-file .env.demo -f compose.demo.yml logs --tail 100 backend simulator
    throw
}

$health = Invoke-RestMethod 'http://127.0.0.1:8001/health' -TimeoutSec 10
if ($health.status -ne 'ok' -or $health.version -ne '0.36.0') {
    throw 'Expected demo backend 0.36.0 at port 8001'
}
$health | Format-Table
Demo ps
Write-Host 'PASS: Stage 8 operation 5 - 98 tests, zero skips, live scenarios, simulator/backend/broker recovery' -ForegroundColor Green
Write-Host 'Demo API: http://127.0.0.1:8001/docs'

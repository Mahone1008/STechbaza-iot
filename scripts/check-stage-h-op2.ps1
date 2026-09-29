# Windows PowerShell 5.1 / PowerShell 7. Tests use new isolated volumes.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$demoEnv = Join-Path $repoRoot '.env.demo'
$acceptanceCompose = Join-Path $repoRoot 'compose.acceptance.yml'
$h02Project = 'techbaza-h02-' + [guid]::NewGuid().ToString('N').Substring(0, 12)

function Assert-Step([string]$Name) {
    if ($LASTEXITCODE -ne 0) { throw "Failed: $Name (exit $LASTEXITCODE)" }
}
function Isolated {
    & docker compose -p $h02Project --env-file $demoEnv -f $acceptanceCompose @args
    Assert-Step 'H-02 isolated command'
}
function Demo {
    & docker compose -p techbaza-demo --env-file $demoEnv -f (Join-Path $repoRoot 'compose.demo.yml') @args
    Assert-Step 'demo command'
}

if (-not (Test-Path -LiteralPath $demoEnv -PathType Leaf)) {
    throw 'Missing accepted .env.demo. Keep existing credentials; do not regenerate them.'
}
$engine = docker info --format '{{.OSType}}'
Assert-Step 'Docker Desktop Linux engine'
if ($engine.Trim() -ne 'linux') { throw 'Linux containers are required' }

try {
    Isolated build backend
    Isolated up -d --wait --wait-timeout 90 postgres mosquitto
    Isolated run --rm -T backend alembic upgrade head
    Isolated run --rm -T -e TECHBAZA_RUN_DB_TESTS=1 -e TECHBAZA_RUN_MQTT_TESTS=1 backend python -m app.tools.backend_check
    Write-Host 'PASS: H-02 command queue >100, retry, concurrent dispatch and full regression; zero skips' -ForegroundColor Green
}
finally {
    # Only this run's random project; accepted demo volumes are never removed.
    Isolated down --volumes
}

# Promote the exact tested image; keep demo database, users and simulator state.
docker image tag techbaza-acceptance-backend:0.39.0 techbaza-demo-backend:local
Assert-Step 'Promote H-02 image'
Demo stop backend simulator
Demo up -d --no-build --wait --wait-timeout 90 backend simulator
Demo exec -T backend python -m app.demo.check --quick

$health = Invoke-RestMethod 'http://127.0.0.1:8001/health' -TimeoutSec 10
if ($health.status -ne 'ok' -or $health.version -ne '0.39.0') {
    throw 'Expected demo backend 0.39.0 on port 8001'
}
$health | Format-Table
Demo ps
Write-Host 'PASS: H-02 acceptance; demo 0.39.0 is running. Send this result for operation closure.' -ForegroundColor Green


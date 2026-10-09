# Windows PowerShell 5.1 / PowerShell 7. Tests use new isolated volumes.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$demoEnv = Join-Path $repoRoot '.env.demo'
$acceptanceCompose = Join-Path $repoRoot 'compose.acceptance.yml'
$h03Project = 'techbaza-h03-' + [guid]::NewGuid().ToString('N').Substring(0, 12)

function Assert-Step([string]$Name) {
    if ($LASTEXITCODE -ne 0) { throw "Failed: $Name (exit $LASTEXITCODE)" }
}
function Isolated {
    & docker compose -p $h03Project --env-file $demoEnv -f $acceptanceCompose @args
    Assert-Step 'H-03 isolated command'
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
    Write-Host 'PASS: H-03 alarm namespaces, legacy guards, HTTP/MQTT and full regression; zero skips' -ForegroundColor Green
}
finally {
    # Only this run's random project; accepted demo volumes are never removed.
    Isolated down --volumes
}

# Pause writers so the read-only preflight cannot race with an old API write.
# The override runs the new checker against the existing demo database.
$preflightCompose = [System.IO.Path]::GetTempFileName()
try {
    @'
services:
  backend:
    image: techbaza-acceptance-backend:0.53.0
'@ | Set-Content -LiteralPath $preflightCompose -Encoding Ascii
    Demo stop backend simulator
    try {
        & docker compose -p techbaza-demo --env-file $demoEnv -f (Join-Path $repoRoot 'compose.demo.yml') -f $preflightCompose run --rm -T --no-deps backend python -m app.tools.alarm_key_check
        Assert-Step 'Existing demo alarm key preflight'
    }
    catch {
        # The running image tag is unchanged; resume the previous demo.
        $preflightError = $_
        Demo up -d --no-build --wait --wait-timeout 90 backend simulator
        throw $preflightError
    }
}
finally {
    Remove-Item -LiteralPath $preflightCompose -Force
}

# Promote only after a successful preflight; preserve demo data and credentials.
docker image tag techbaza-acceptance-backend:0.53.0 techbaza-demo-backend:local
Assert-Step 'Promote H-03 image'
Demo up -d --no-build --wait --wait-timeout 90 backend simulator
Demo exec -T backend python -m app.demo.check --quick

$health = Invoke-RestMethod 'http://127.0.0.1:8001/health' -TimeoutSec 10
if ($health.status -ne 'ok' -or $health.version -ne '0.53.0') {
    throw 'Expected demo backend 0.53.0 on port 8001'
}
$health | Format-Table
Demo ps
Write-Host 'PASS: H-03 acceptance; demo 0.53.0 is running. Send this result for operation closure.' -ForegroundColor Green


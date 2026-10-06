# Stage 8 operation 3: run from PowerShell after updating main.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

function Assert-Step([string]$Name) {
    if ($LASTEXITCODE -ne 0) { throw "Failed: $Name (exit $LASTEXITCODE)" }
}

$engine = docker info --format '{{.OSType}}'
Assert-Step 'Docker Desktop must be running'
if ($engine.Trim() -ne 'linux') { throw 'Linux containers are required' }

docker compose stop backend
Assert-Step 'stop backend'
docker compose build backend
Assert-Step 'build backend'
docker compose run --rm -T backend alembic upgrade head
Assert-Step 'apply migrations'
docker compose run --rm -T backend alembic current
Assert-Step 'current migration: expected 20261006_0027 (head)'
docker compose run --rm -T -e TECHBAZA_RUN_DB_TESTS=1 -e TECHBAZA_RUN_MQTT_TESTS=1 backend python -m unittest discover -s tests -v
Assert-Step '74 regression and integration tests'
docker compose up -d backend
Assert-Step 'start backend'

$health = $null
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8000/health' -TimeoutSec 5
        break
    }
    catch { Start-Sleep -Seconds 1 }
}
if (-not $health -or $health.status -ne 'ok' -or $health.version -ne '0.34.0') {
    docker compose logs --tail 80 backend
    throw 'Expected health ok, version 0.34.0'
}

$spec = Invoke-RestMethod 'http://127.0.0.1:8000/openapi.json' -TimeoutSec 10
$seriesPath = '/api/v1/devices/{device_id}/telemetry/series'
if ($spec.paths.PSObject.Properties.Name -notcontains $seriesPath) {
    throw 'Missing telemetry series route'
}
$fields = $spec.components.schemas.DeviceOverviewRead.properties.PSObject.Properties.Name
foreach ($field in @('telemetry_freshness', 'readings')) {
    if ($fields -notcontains $field) { throw "Missing overview field: $field" }
}

# A real unauthenticated HTTP request must be rejected before reading data.
$seriesUrl = 'http://127.0.0.1:8000/api/v1/devices/00000000-0000-0000-0000-000000000001/telemetry/series?metric=pressure.bar&start=2026-09-26T10:00:00Z&end=2026-09-26T11:00:00Z&bucket_seconds=300'
$unauthorizedStatus = 0
try {
    $reply = Invoke-WebRequest -UseBasicParsing -Uri $seriesUrl -TimeoutSec 10
    $unauthorizedStatus = [int]$reply.StatusCode
}
catch {
    if ($null -eq $_.Exception.Response) { throw }
    $unauthorizedStatus = [int]$_.Exception.Response.StatusCode
}
if ($unauthorizedStatus -ne 401) { throw "Expected series 401 without JWT, got $unauthorizedStatus" }

$health | Format-Table
Write-Host 'PASS: series route, overview quality fields, unauthenticated request rejected with 401' -ForegroundColor Green
Write-Host 'PASS: Stage 8 operation 3 - tests and backend 0.34.0 ready' -ForegroundColor Green

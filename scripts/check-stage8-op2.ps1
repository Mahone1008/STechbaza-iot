# Stage 8 operation 2: run from PowerShell after updating main.
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
Assert-Step 'current migration'
docker compose run --rm -T -e TECHBAZA_RUN_DB_TESTS=1 -e TECHBAZA_RUN_MQTT_TESTS=1 backend python -m unittest discover -s tests -v
Assert-Step '54 regression and integration tests'
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
if (-not $health -or $health.status -ne 'ok' -or $health.version -ne '0.33.0') {
    docker compose logs --tail 80 backend
    throw 'Expected health ok, version 0.33.0'
}

$spec = Invoke-RestMethod 'http://127.0.0.1:8000/openapi.json' -TimeoutSec 10
$paths = $spec.paths.PSObject.Properties.Name
foreach ($action in @('login', 'refresh', 'logout')) {
    $path = "/api/v1/auth/browser/$action"
    if ($paths -notcontains $path) { throw "Missing route: $path" }
}

# No credentials: check real HTTP CORS and CSRF rejection without changing users.
$headers = @{
    'Origin' = 'http://127.0.0.1:3000'
    'Access-Control-Request-Method' = 'POST'
    'Access-Control-Request-Headers' = 'content-type,x-techbaza-csrf'
}
$cors = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/api/v1/auth/browser/login' -Method Options -Headers $headers -TimeoutSec 10
if ($cors.StatusCode -ne 200 -or $cors.Headers['Access-Control-Allow-Origin'] -ne 'http://127.0.0.1:3000' -or $cors.Headers['Access-Control-Allow-Credentials'] -ne 'true') {
    throw 'CORS preflight did not return expected allowed origin and credentials'
}

$csrfStatus = 0
try {
    $reply = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/api/v1/auth/browser/refresh' -Method Post -TimeoutSec 10
    $csrfStatus = [int]$reply.StatusCode
}
catch {
    if ($null -eq $_.Exception.Response) { throw }
    $csrfStatus = [int]$_.Exception.Response.StatusCode
}
if ($csrfStatus -ne 403) { throw "Expected CSRF rejection 403, got $csrfStatus" }

$health | Format-Table
Write-Host 'PASS: CORS preflight 200, missing CSRF protection rejected with 403' -ForegroundColor Green
Write-Host 'PASS: Stage 8 operation 2 - tests and backend 0.33.0 ready' -ForegroundColor Green

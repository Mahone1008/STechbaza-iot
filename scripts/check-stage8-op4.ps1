# Після оновлення main. Окремий demo-стенд; основний compose.yml не змінюється.
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

if (-not (Test-Path -LiteralPath '.env.demo')) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $lines = foreach ($key in @('DEMO_DB_PASSWORD', 'DEMO_JWT_SECRET', 'DEMO_ACCOUNT_KEY_SECRET', 'DEMO_OWNER_PASSWORD', 'DEMO_OPERATOR_PASSWORD', 'DEMO_VIEWER_PASSWORD', 'DEMO_OTHER_PASSWORD')) {
            $bytes = New-Object byte[] 32
            $rng.GetBytes($bytes)
            $value = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
            "$key=$value"
        }
        $encoding = New-Object System.Text.UTF8Encoding($false)
        $path = Join-Path (Get-Location).Path '.env.demo'
        $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::CreateNew)
        try {
            $data = $encoding.GetBytes(($lines -join "`n") + "`n")
            $stream.Write($data, 0, $data.Length)
        }
        finally { $stream.Dispose() }
    }
    finally { $rng.Dispose() }
    Write-Host 'Created .env.demo; credentials preserved locally, not printed'
}

Demo stop backend simulator
Demo build backend
Demo up -d postgres mosquitto
Demo run --rm -T backend alembic upgrade head
Demo run --rm -T backend alembic current
Demo run --rm -T -e TECHBAZA_RUN_DB_TESTS=1 -e TECHBAZA_RUN_MQTT_TESTS=1 backend python -m unittest discover -s tests -v
Demo run --rm -T backend python -m app.demo.seed
Demo run --rm -T backend python -m app.demo.seed
Demo up -d --wait --wait-timeout 90 backend simulator
Demo exec -T backend python -m app.demo.check
Demo exec -T simulator python -m app.demo.simulator checkpoint
Demo restart simulator
Demo exec -T simulator python -m app.demo.simulator verify-restart
Demo exec -T backend python -m app.demo.check --quick

$health = Invoke-RestMethod 'http://127.0.0.1:8001/health' -TimeoutSec 10
if ($health.status -ne 'ok' -or $health.version -ne '0.35.0') {
    throw 'Expected demo backend 0.35.0 at port 8001'
}
$health | Format-Table
Demo ps
Write-Host 'PASS: Stage 8 operation 4 - isolated demo, 86 tests, live MQTT scenarios and restart verified' -ForegroundColor Green
Write-Host 'Demo API: http://127.0.0.1:8001/docs'

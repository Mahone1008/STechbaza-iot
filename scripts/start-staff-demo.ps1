param([switch]$ResetExisting)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $root
try {
    if (-not (Test-Path '.env.demo')) { throw 'Prepare the existing demo before starting the staff portal.' }
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop and wait until its engine is running, then retry.' }
    & (Join-Path $PSScriptRoot 'prepare-staff.ps1')
    $dc = @('compose', '-p', 'techbaza-demo', '--env-file', '.env.demo', '-f', 'compose.demo.yml')
    foreach ($overlay in @('v3', 'controllers')) {
        if (Test-Path ".env.$overlay") { $dc += @('--env-file', ".env.$overlay", '-f', "compose.$overlay.yml") }
    }
    $dc += @('--env-file', '.env.staff', '-f', 'compose.staff.demo.yml')
    & docker @dc build backend
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
    & docker @dc up -d --wait postgres mosquitto
    if ($LASTEXITCODE -ne 0) { throw 'Database/broker startup failed.' }
    if (Test-Path '.env.controllers') {
        & docker @dc up -d --wait controller-gateway
        if ($LASTEXITCODE -ne 0) { throw 'Controller gateway is not ready; no reset was performed.' }
    }
    & docker @dc stop backend staff-backend simulator
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop database writers.' }
    & docker @dc run --rm -T --no-deps backend alembic upgrade head
    if ($LASTEXITCODE -ne 0) { throw 'Migration failed. Database was not reset.' }
    if ($ResetExisting) {
        & (Join-Path $PSScriptRoot 'reset-demo-review.ps1') -AllExisting -Apply
    } else {
        & docker @dc up -d --no-build --wait backend staff-backend
        if ($LASTEXITCODE -ne 0) { throw 'Application startup failed.' }
    }
    Write-Host 'PASS: customer API 127.0.0.1:8001, private staff API 127.0.0.1:8002.'
    Write-Host 'Start customer frontend on port 3000 with NEXT_PUBLIC_PORTAL_MODE=customer; staff frontend on 3001 with NEXT_PUBLIC_PORTAL_MODE=staff. See docs/staff-console-v1.md.'
} finally { Pop-Location }

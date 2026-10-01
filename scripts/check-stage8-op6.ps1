# Однаковий сценарій для Windows PowerShell 5.1 та CI PowerShell 7.
# Дані backup містять приватні credentials; каталог backups ігнорується Git.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

function Assert-Step([string]$Name) {
    if ($LASTEXITCODE -ne 0) { throw "Failed: $Name (exit $LASTEXITCODE)" }
}
function Demo {
    & docker compose -p techbaza-demo --env-file $demoEnv -f (Join-Path $repoRoot 'compose.demo.yml') @args
    Assert-Step 'source demo command'
}
function Isolated {
    param([string]$Project)
    if ($Project -notin @($cleanProject, $restoreProject)) { throw 'Unexpected acceptance project' }
    & docker compose -p $Project --env-file $acceptanceEnv -f $acceptanceCompose @args
    Assert-Step 'isolated acceptance command'
}
function Backup-Tool {
    param([string]$Action)
    Demo run --rm -T --no-deps -v "${backupPath}:/backup" backend python -m app.demo.backup_check $Action @args
}
function Restore-Tool {
    param([string]$Action)
    Isolated $restoreProject run --rm -T --no-deps -v "${backupPath}:/backup" backend python -m app.demo.backup_check $Action @args
}

$engine = docker info --format '{{.OSType}}'
Assert-Step 'Docker Desktop Linux engine'
if ($engine.Trim() -ne 'linux') { throw 'Linux containers are required' }
$demoEnv = Join-Path $repoRoot '.env.demo'
if (-not (Test-Path -LiteralPath $demoEnv -PathType Leaf)) { throw 'Missing accepted .env.demo; do not regenerate credentials' }
$revision = (git rev-parse HEAD).Trim()
Assert-Step 'Git revision'
$runId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$backupPath = Join-Path $repoRoot "backups/acceptance-$runId"
$sourcePath = Join-Path $backupPath 'source'
$cleanProject = "techbaza-accept-$runId-clean"
$restoreProject = "techbaza-accept-$runId-restore"
$null = New-Item -ItemType Directory -Path $sourcePath
$archive = Join-Path $backupPath 'source.tar'
git archive --format=tar --output $archive HEAD
Assert-Step 'Export clean tracked source'
tar -xf $archive -C $sourcePath
Assert-Step 'Extract clean source archive'
$acceptanceCompose = Join-Path $sourcePath 'compose.acceptance.yml'
$acceptanceEnv = Join-Path $backupPath 'environment.env'
Copy-Item -LiteralPath $demoEnv -Destination $acceptanceEnv

$sourcePaused = $false
$canaryCreated = $false
$completed = $false
try {
    # Нові volumes + лише tracked source без .env, кешу БД та локальних файлів.
    Isolated $cleanProject build --no-cache backend
    Isolated $cleanProject up -d --wait --wait-timeout 90 postgres mosquitto
    Isolated $cleanProject run --rm -T --no-deps backend python -m app.demo.backup_check empty
    Isolated $cleanProject run --rm -T backend alembic upgrade head
    Isolated $cleanProject run --rm -T backend alembic current
    Isolated $cleanProject run --rm -T -e TECHBAZA_RUN_DB_TESTS=1 -e TECHBAZA_RUN_MQTT_TESTS=1 backend python -m app.tools.backend_check
    Isolated $cleanProject run --rm -T backend python -m app.demo.seed
    Isolated $cleanProject up -d --wait --wait-timeout 90 backend simulator
    Isolated $cleanProject exec -T backend python -m app.demo.check
    Isolated $cleanProject down --volumes
    Write-Host 'PASS: clean tracked-source installation, migrations, full tests and live HTTP/MQTT' -ForegroundColor Green

    # H-05: спочатку перевірка старих даних новим image, потім promotion.
    # При відмові finally відновить попередній image, tag ще не змінено.
    Demo stop backend simulator
    $sourcePaused = $true
    $preflightCompose = [System.IO.Path]::GetTempFileName()
    try {
        @'
services:
  backend:
    image: techbaza-acceptance-backend:0.41.0
'@ | Set-Content -LiteralPath $preflightCompose -Encoding Ascii
        & docker compose -p techbaza-demo --env-file $demoEnv -f (Join-Path $repoRoot 'compose.demo.yml') -f $preflightCompose run --rm -T --no-deps backend python -m app.tools.alarm_key_check
        Assert-Step 'Existing demo alarm key preflight'
    }
    finally {
        Remove-Item -LiteralPath $preflightCompose -Force
    }
    docker image tag techbaza-acceptance-backend:0.41.0 techbaza-demo-backend:local
    Assert-Step 'Promote verified backend image'
    Demo run --rm -T backend alembic upgrade head
    Demo up -d --no-build --wait --wait-timeout 90 backend simulator
    $sourcePaused = $false
    Demo exec -T backend python -m app.demo.check

    $canaryCreated = $true
    Backup-Tool canary
    Demo stop simulator backend
    $sourcePaused = $true
    Backup-Tool snapshot
    Demo run --rm -T --no-deps -v "${backupPath}:/backup" simulator python -m app.demo.backup_check sqlite-export
    $dumpName = "/tmp/techbaza-$runId.dump"
    Demo exec -T postgres pg_dump -U techbaza_demo -d techbaza_demo --format=custom --file $dumpName
    Demo cp "postgres:$dumpName" (Join-Path $backupPath 'postgres.dump')
    Demo exec -T postgres rm -- $dumpName
    Backup-Tool manifest --revision $revision
    Backup-Tool verify

    # Source продовжує роботу; restore ніколи не пише у його volumes або broker.
    Demo up -d --no-build --wait --wait-timeout 90 backend simulator
    $sourcePaused = $false
    Backup-Tool source-resume
    $canaryCreated = $false

    Isolated $restoreProject up -d --wait --wait-timeout 90 postgres mosquitto
    Restore-Tool empty
    Restore-Tool verify
    Isolated $restoreProject cp (Join-Path $backupPath 'postgres.dump') 'postgres:/tmp/restore.dump'
    Isolated $restoreProject exec -T postgres pg_restore -U techbaza_demo -d techbaza_demo --single-transaction --exit-on-error --no-owner --no-privileges /tmp/restore.dump
    Isolated $restoreProject exec -T postgres rm -- /tmp/restore.dump
    Restore-Tool compare
    Isolated $restoreProject run --rm -T backend alembic current
    Isolated $restoreProject run --rm -T --no-deps -v "${backupPath}:/backup" simulator python -m app.demo.backup_check sqlite-import
    Restore-Tool guard

    Isolated $restoreProject run --rm -T --no-deps simulator python -m app.demo.simulator checkpoint
    Isolated $restoreProject up -d --wait --wait-timeout 90 backend simulator
    Isolated $restoreProject exec -T simulator python -m app.demo.simulator verify-restart
    Restore-Tool check-restored
    Isolated $restoreProject exec -T backend python -m app.demo.check
    # Ще раз після живих команд: старий STOP не ожив і tokens залишаються revoked.
    Restore-Tool check-restored --revision $revision
    Demo exec -T backend python -m app.demo.check --quick

    $health = Invoke-RestMethod 'http://127.0.0.1:8001/health' -TimeoutSec 10
    if ($health.status -ne 'ok' -or $health.version -ne '0.41.0') { throw 'Expected demo backend 0.41.0 on 8001' }
    $health | Format-Table
    Backup-Tool report
    $completed = $true
}
finally {
    if ($sourcePaused -or $canaryCreated) {
        & docker compose -p techbaza-demo --env-file $demoEnv -f (Join-Path $repoRoot 'compose.demo.yml') up -d --no-build --wait --wait-timeout 90 backend simulator
        if ($canaryCreated) {
            & docker compose -p techbaza-demo --env-file $demoEnv -f (Join-Path $repoRoot 'compose.demo.yml') run --rm -T --no-deps -v "${backupPath}:/backup" backend python -m app.demo.backup_check source-resume
        }
    }
    if (-not $completed) {
        & docker compose -p $restoreProject --env-file $acceptanceEnv -f $acceptanceCompose logs --tail 80 backend simulator
        Write-Host "Acceptance failed; backup directory retained: $backupPath" -ForegroundColor Yellow
    }
    # Імена створені саме цим запуском; source techbaza-demo сюди не потрапляє.
    Isolated $cleanProject down --volumes
    Isolated $restoreProject down --volumes
}
Demo ps
Write-Host 'PASS: Stage 8 operation 6 - clean install, exact backup/restore, safe recovery, demo 0.41.0' -ForegroundColor Green
Write-Host "Private backup and report: $backupPath"
Write-Host 'Demo API: http://127.0.0.1:8001/docs'


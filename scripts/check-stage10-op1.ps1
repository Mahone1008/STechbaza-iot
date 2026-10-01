param(
    [switch]$Start
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$frontend = Join-Path $repoRoot 'frontend'
$demoEnv = Join-Path $repoRoot '.env.demo'
$demoCompose = Join-Path $repoRoot 'compose.demo.yml'
$stage9Check = Join-Path $PSScriptRoot 'check-stage9-op4.ps1'

function Assert-LastExit {
    param([Parameter(Mandatory = $true)][string]$Step)
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE."
    }
}

function Invoke-Npm {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $npm = Get-Command npm.cmd -ErrorAction Stop
    & $npm.Source @Arguments
    Assert-LastExit "npm $($Arguments -join ' ')"
}

function Demo {
    & docker compose -p techbaza-demo --env-file $demoEnv -f $demoCompose @args
    Assert-LastExit "demo compose $($args -join ' ')"
}

function Read-EnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $prefix = "$Name="
    $line = Get-Content -LiteralPath $Path | Where-Object { $_.StartsWith($prefix) } | Select-Object -First 1
    if (-not $line) { throw "Missing $Name in .env.demo." }
    $value = $line.Substring($prefix.Length)
    if (-not $value) { throw "$Name is empty in .env.demo." }
    return $value
}

function Set-TemporaryEnvironment {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][hashtable]$Previous
    )
    $Previous[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Restore-TemporaryEnvironment {
    param([Parameter(Mandatory = $true)][hashtable]$Previous)
    foreach ($entry in $Previous.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
}

Set-Location $repoRoot
Write-Host "Repository: $repoRoot" -ForegroundColor Cyan

if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $existingServer = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($existingServer) {
        throw 'Port 3000 is already in use. Stop the previous KERUMO server with Ctrl+C and run the check again.'
    }
}

if (-not (Test-Path -LiteralPath $demoEnv -PathType Leaf)) {
    throw 'Missing .env.demo. Restore the accepted local demo credentials; do not create new secrets for an existing demo database.'
}

# Reuse the accepted Stage 9 gate: clean install, OpenAPI zero-diff, unit tests,
# production build and mocked Chromium smoke tests.
& powershell -NoProfile -ExecutionPolicy Bypass -File $stage9Check
Assert-LastExit 'Stage 9 frontend baseline'

$engine = (& docker info --format '{{.OSType}}').Trim()
Assert-LastExit 'Docker Desktop status'
if ($engine -ne 'linux') { throw 'Docker Desktop must use Linux containers.' }

# Preserve the accepted demo volumes and credentials. Seed is idempotent; no
# reset/delete command is used here.
Demo build backend
Demo up -d --wait --wait-timeout 90 postgres mosquitto
Demo run --rm -T backend alembic upgrade head
Demo run --rm -T backend python -m app.demo.seed
Demo up -d --no-build --force-recreate --wait --wait-timeout 90 backend simulator

$health = Invoke-RestMethod 'http://127.0.0.1:8001/health' -TimeoutSec 10
if ($health.status -ne 'ok' -or $health.version -ne '0.40.0') {
    throw 'Expected demo backend 0.40.0 on http://127.0.0.1:8001.'
}

$demoEmail = 'owner@techbaza-demo.example.com'
$viewerEmail = 'viewer@techbaza-demo.example.com'
$demoPassword = Read-EnvValue -Path $demoEnv -Name 'DEMO_OWNER_PASSWORD'
$viewerPassword = Read-EnvValue -Path $demoEnv -Name 'DEMO_VIEWER_PASSWORD'
$previousEnvironment = @{}

try {
    if ($env:KERUMO_RUN_ALARM_DEMO -eq '1') {
        # Run the guarded fixture inside the isolated demo backend.
        # Explicit UTF-8 keeps this portable in Windows PowerShell 5.1.
        $oldOutputEncoding = $OutputEncoding
        try {
            $OutputEncoding = New-Object System.Text.UTF8Encoding $false
            Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot 'scripts/prepare-stage13-demo.py') | & docker compose -p techbaza-demo --env-file $demoEnv -f $demoCompose exec -T backend python -
            Assert-LastExit 'Stage 13 isolated alarm fixture'
        }
        finally { $OutputEncoding = $oldOutputEncoding }
    }
    # Commands target only the isolated TB-DEMO-PUMP simulator on localhost.
    Set-TemporaryEnvironment -Name 'KERUMO_RUN_COMMAND_DEMO' -Value '1' -Previous $previousEnvironment
    Set-TemporaryEnvironment -Name 'KERUMO_API_BASE_URL' -Value 'http://127.0.0.1:8001' -Previous $previousEnvironment
    Set-TemporaryEnvironment -Name 'KERUMO_DEMO_EMAIL' -Value $demoEmail -Previous $previousEnvironment
    Set-TemporaryEnvironment -Name 'KERUMO_DEMO_PASSWORD' -Value $demoPassword -Previous $previousEnvironment
    Set-TemporaryEnvironment -Name 'KERUMO_VIEWER_EMAIL' -Value $viewerEmail -Previous $previousEnvironment
    Set-TemporaryEnvironment -Name 'KERUMO_VIEWER_PASSWORD' -Value $viewerPassword -Previous $previousEnvironment

    Set-Location $frontend
    Invoke-Npm -Arguments @('run', 'test:browser:live')
}
finally {
    Restore-TemporaryEnvironment -Previous $previousEnvironment
    $demoPassword = $null
    $viewerPassword = $null
}

Write-Host 'PASS: Stage 10.1+ authentication, HttpOnly session and real role checks.' -ForegroundColor Green
Write-Host "Demo owner email: $demoEmail" -ForegroundColor Cyan
Write-Host "Demo viewer email: $viewerEmail" -ForegroundColor Cyan
Write-Host 'Demo passwords were read only for automated tests and were not printed.' -ForegroundColor DarkGray

if ($Start) {
    Set-Location $frontend
    Write-Host 'Starting KERUMO at http://127.0.0.1:3000/login' -ForegroundColor Cyan
    Invoke-Npm -Arguments @('run', 'dev')
}


param(
    [switch]$Start
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$frontend = Join-Path $repoRoot 'frontend'
$stage10Op2Check = Join-Path $PSScriptRoot 'check-stage10-op2.ps1'

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

Set-Location $repoRoot
Write-Host "Repository: $repoRoot" -ForegroundColor Cyan

# Keep this script ASCII-compatible. Windows PowerShell 5.1 can read UTF-8
# without a BOM through the legacy code page, where some byte sequences are
# interpreted as smart quote delimiters and break parsing.
#
# Cumulative gate: Stage 10.2 already runs the clean frontend baseline, real
# FastAPI/PostgreSQL/Mosquitto environment and all mocked/live browser tests.
# Stage 10.3 extends those suites with /auth/me, organization access, viewer
# permissions, anonymous redirects and session-scoped cache isolation.
& powershell -NoProfile -ExecutionPolicy Bypass -File $stage10Op2Check
Assert-LastExit 'Stage 10.2 cumulative session gate'

Write-Host 'PASS: Stage 10.3 /auth/me profile, organization access, permission-aware UI, cache isolation and route guards.' -ForegroundColor Green
Write-Host 'Manual acceptance A: without a session, /devices must redirect to /login?returnTo=%2Fdevices.' -ForegroundColor Cyan
Write-Host 'Manual acceptance B: owner sees the organization returned by backend and the owner role.' -ForegroundColor Cyan
Write-Host 'Manual acceptance C: viewer sees the viewer role and disabled Start/Stop controls.' -ForegroundColor Cyan

if ($Start) {
    Set-Location $frontend
    Write-Host 'Starting KERUMO at http://127.0.0.1:3000/login' -ForegroundColor Cyan
    Invoke-Npm -Arguments @('run', 'dev')
}

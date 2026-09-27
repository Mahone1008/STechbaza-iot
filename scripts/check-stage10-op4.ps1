param(
    [switch]$Start
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$frontend = Join-Path $repoRoot 'frontend'
$stage10Op3Check = Join-Path $PSScriptRoot 'check-stage10-op3.ps1'

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

# Keep this script ASCII-compatible with Windows PowerShell 5.1.
# Stage 10.3 already runs the cumulative clean build, mocked Chromium suite,
# real FastAPI/PostgreSQL/Mosquitto environment and all live auth tests.
# Stage 10.4 extends those suites with browser logout, cross-tab revoke,
# pending request cancellation and no-session-resurrection scenarios.
& powershell -NoProfile -ExecutionPolicy Bypass -File $stage10Op3Check
Assert-LastExit 'Stage 10.3 cumulative permissions gate'

Write-Host 'PASS: Stage 10.4 server-side logout, cross-tab revoke, private cache cleanup and no session resurrection.' -ForegroundColor Green
Write-Host 'Manual acceptance A: open the user menu and choose logout.' -ForegroundColor Cyan
Write-Host 'Manual acceptance B: every open tab must return to login.' -ForegroundColor Cyan
Write-Host 'Manual acceptance C: F5 and direct /devices navigation must stay logged out.' -ForegroundColor Cyan

if ($Start) {
    Set-Location $frontend
    Write-Host 'Starting KERUMO at http://127.0.0.1:3000/login' -ForegroundColor Cyan
    Invoke-Npm -Arguments @('run', 'dev')
}

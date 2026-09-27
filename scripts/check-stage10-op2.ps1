param(
    [switch]$Start
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$frontend = Join-Path $repoRoot 'frontend'
$stage10Op1Check = Join-Path $PSScriptRoot 'check-stage10-op1.ps1'

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

# The Stage 10.1 gate is cumulative: it runs the accepted frontend baseline,
# starts the real demo backend and executes every mocked and live browser test.
# Stage 10.2 adds reload recovery and coordinated multi-tab refresh scenarios to
# those same suites, so reusing the gate avoids duplicated environment logic.
& powershell -NoProfile -ExecutionPolicy Bypass -File $stage10Op1Check
Assert-LastExit 'Stage 10.1 cumulative authentication gate'

Write-Host 'PASS: Stage 10.2 HttpOnly session recovery, proactive refresh, single-flight and cross-tab coordination.' -ForegroundColor Green
Write-Host 'Manual acceptance: log in, press F5 on /devices, then open /devices in a second tab.' -ForegroundColor Cyan
Write-Host 'Expected status after F5: Сесія відновлена · demo data' -ForegroundColor DarkGray

if ($Start) {
    Set-Location $frontend
    Write-Host 'Starting KERUMO at http://127.0.0.1:3000/login' -ForegroundColor Cyan
    Invoke-Npm -Arguments @('run', 'dev')
}

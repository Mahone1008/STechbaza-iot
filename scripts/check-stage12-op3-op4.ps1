param([switch]$Start)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot
# ASCII-only Windows PowerShell 5.1. Reuses existing credentials and demo volumes.
# The cumulative gate starts the isolated simulator and tests its Stop lifecycle.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-stage10-op4.ps1')
if ($LASTEXITCODE -ne 0) { throw "Stage 12.3-12.4 cumulative checks failed: $LASTEXITCODE" }
Write-Host 'PASS: command confirmation, request identity, lifecycle and stable journal checks.' -ForegroundColor Green
Write-Host 'Live command test: Stop on the isolated TB-DEMO-PUMP simulator only.' -ForegroundColor Cyan
Write-Host 'Manual A: confirm Start, frequency and Stop on TB-DEMO-PUMP; inspect ACK and result separately.' -ForegroundColor Cyan
Write-Host 'Manual B: inspect journal pages, author, TTL and manual refresh; Viewer has no control form.' -ForegroundColor Cyan
Write-Host 'Manual C: F5 restores telemetry filters but never replays a command.' -ForegroundColor Cyan
Write-Host 'Windows and manual acceptance must be recorded separately from CI.' -ForegroundColor Yellow
if ($Start) {
    Set-Location (Join-Path $repoRoot 'frontend')
    $npm = Get-Command npm.cmd -ErrorAction Stop
    Write-Host 'Starting KERUMO at http://127.0.0.1:3000/login' -ForegroundColor Cyan
    & $npm.Source run dev
    if ($LASTEXITCODE -ne 0) { throw "Frontend server exited with code $LASTEXITCODE." }
}

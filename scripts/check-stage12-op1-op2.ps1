param([switch]$Start)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot
# ASCII only for Windows PowerShell 5.1; preserve existing demo data and credentials.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-stage10-op4.ps1')
if ($LASTEXITCODE -ne 0) { throw "Stage 12.1-12.2 cumulative checks failed: $LASTEXITCODE" }
Write-Host 'PASS: Stage 12.1-12.2 telemetry history and bounded polling checks.' -ForegroundColor Green
Write-Host 'Manual A: open a device, select a metric/period/bucket, inspect chart gaps and the exact data table.' -ForegroundColor Cyan
Write-Host 'Manual B: compare different device modules; empty history is valid without simulator telemetry.' -ForegroundColor Cyan
Write-Host 'Manual C: check automatic refresh, manual-only mode, hidden tab, network recovery and a narrow screen.' -ForegroundColor Cyan
Write-Host 'History time means server receipt; averages are over valid samples. No physical commands are sent.' -ForegroundColor Cyan
Write-Host 'Stage 12.1 and 12.2 await Windows and manual user acceptance.' -ForegroundColor Yellow
if ($Start) {
    Set-Location (Join-Path $repoRoot 'frontend')
    $npm = Get-Command npm.cmd -ErrorAction Stop
    Write-Host 'Starting KERUMO at http://127.0.0.1:3000/login' -ForegroundColor Cyan
    & $npm.Source run dev
    if ($LASTEXITCODE -ne 0) { throw "Frontend server exited with code $LASTEXITCODE." }
}

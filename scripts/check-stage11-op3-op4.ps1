param([switch]$Start)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot
# ASCII only for Windows PowerShell 5.1. Preserve demo credentials and data.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-stage10-op4.ps1')
if ($LASTEXITCODE -ne 0) { throw "Stage 11.3-11.4 cumulative checks failed: $LASTEXITCODE" }
Write-Host 'PASS: Stage 11.3-11.4 module/channel widgets, quality, configuration refresh and revoked access.' -ForegroundColor Green
Write-Host 'Manual A: open the pump; compare its modules with the pressure-only and new water-level devices.' -ForegroundColor Cyan
Write-Host 'Manual B: missing readings show a dash; stale readings are explicitly historical, not current.' -ForegroundColor Cyan
Write-Host 'Manual C: Refresh panel, reload, switch devices, check narrow layout and logout in two tabs.' -ForegroundColor Cyan
Write-Host 'Configuration enable/disable is reflected on refresh; no configuration editor or physical command writes in this stage.' -ForegroundColor Cyan
Write-Host 'Stage 11.3 and 11.4 await manual user acceptance.' -ForegroundColor Yellow
if ($Start) {
    Set-Location (Join-Path $repoRoot 'frontend')
    $npm = Get-Command npm.cmd -ErrorAction Stop
    Write-Host 'Starting KERUMO at http://127.0.0.1:3000/login' -ForegroundColor Cyan
    & $npm.Source run dev
    if ($LASTEXITCODE -ne 0) { throw "Frontend server exited with code $LASTEXITCODE." }
}

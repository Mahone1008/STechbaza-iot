param(
    [switch]$Start
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$previousGate = Join-Path $PSScriptRoot 'check-stage10-op4.ps1'

# ASCII only: compatible with Windows PowerShell 5.1 without a UTF-8 BOM.
# The cumulative gate runs ALL current unit, mocked and real browser suites.
# Existing demo credentials and volumes are preserved; no reset is performed.
Set-Location $repoRoot
& powershell -NoProfile -ExecutionPolicy Bypass -File $previousGate
if ($LASTEXITCODE -ne 0) { throw "Stage 11.1-11.2 cumulative checks failed with exit code $LASTEXITCODE." }

Write-Host 'PASS: Stage 11.1-11.2 organizations, sites, validated context, paginated devices and bounded presence.' -ForegroundColor Green
Write-Host 'Manual A: organizations -> sites -> devices; verify breadcrumbs and direct device links.' -ForegroundColor Cyan
Write-Host 'Manual B: press F5 and open /devices; the selected site must be revalidated and restored.' -ForegroundColor Cyan
Write-Host 'Manual C: check Online / Offline / never-connected and last-seen time. Presence is refreshed manually.' -ForegroundColor Cyan
Write-Host 'Manual D: no simulated measurements or physical command controls on real device routes.' -ForegroundColor Cyan
Write-Host 'Manual E: repeat on a narrow screen and check logout in two tabs.' -ForegroundColor Cyan
Write-Host 'Stage 11.1 and 11.2 remain pending user acceptance until these checks are confirmed.' -ForegroundColor Yellow

if ($Start) {
    Set-Location (Join-Path $repoRoot 'frontend')
    $npm = Get-Command npm.cmd -ErrorAction Stop
    Write-Host 'Starting KERUMO at http://127.0.0.1:3000/login' -ForegroundColor Cyan
    & $npm.Source run dev
    if ($LASTEXITCODE -ne 0) { throw "Frontend server exited with code $LASTEXITCODE." }
}

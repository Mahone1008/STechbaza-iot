param([switch]$Start)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-stage13-op3-op4.ps1')
if ($LASTEXITCODE -ne 0) { throw "Stage 14.1-14.2 cumulative checks failed: $LASTEXITCODE" }
Write-Host 'PASS: stage 14.1-14.2 accessibility, keyboard, reflow and workspace journeys.' -ForegroundColor Green
Write-Host 'Includes all prior browser/live checks and the guarded MQTT demo incident. Data and credentials are retained.' -ForegroundColor Cyan
Write-Host 'Manual A: keyboard Tab/Shift+Tab, account menu, Escape and confirmation focus.' -ForegroundColor Cyan
Write-Host 'Manual B: narrow viewport, 200/400 percent browser zoom, tables and visible focus.' -ForegroundColor Cyan
Write-Host 'Manual C: Owner/Viewer, two organizations, two tabs, read/F5 and logout.' -ForegroundColor Cyan
Write-Host 'Automated accessibility checks do not establish complete WCAG conformance.' -ForegroundColor Cyan
if ($Start) {
    Set-Location (Join-Path $repoRoot 'frontend')
    $npm = Get-Command npm.cmd -ErrorAction Stop
    & $npm.Source run dev
    if ($LASTEXITCODE -ne 0) { throw "Frontend exited with code $LASTEXITCODE" }
}

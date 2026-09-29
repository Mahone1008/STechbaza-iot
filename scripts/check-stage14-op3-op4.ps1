param([switch]$Start)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-stage14-op1-op2.ps1')
if ($LASTEXITCODE -ne 0) { throw "Stage 14.3-14.4 cumulative checks failed: $LASTEXITCODE" }
Set-Location (Join-Path $repoRoot 'frontend')
$npm = Get-Command npm.cmd -ErrorAction Stop
& $npm.Source run check:budget
if ($LASTEXITCODE -ne 0) { throw 'Frontend build budget failed.' }
& $npm.Source audit --audit-level=high
if ($LASTEXITCODE -ne 0) { throw 'Dependency audit failed or could not reach the registry.' }
Write-Host 'PASS: stage 14.3-14.4 frontend test baseline. This is NOT a production release.' -ForegroundColor Green
Write-Host 'Evidence: frontend/artifacts/stage14/build-budget.json and frontend/test-results performance JSON.' -ForegroundColor Cyan
Write-Host 'Next: manual browser acceptance, real controller bench tests, then separate deployment/load testing.' -ForegroundColor Cyan
if ($Start) {
    & $npm.Source run start
    if ($LASTEXITCODE -ne 0) { throw "Frontend exited with code $LASTEXITCODE" }
}

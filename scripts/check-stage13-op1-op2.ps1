param([switch]$Start)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot
# ASCII-only PowerShell 5.1 wrapper; never removes demo volumes or credentials.
$previousAlarmDemo = [Environment]::GetEnvironmentVariable('KERUMO_RUN_ALARM_DEMO', 'Process')
try {
    $env:KERUMO_RUN_ALARM_DEMO = '1'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-stage12-op3-op4.ps1')
    if ($LASTEXITCODE -ne 0) { throw "Stage 13.1-13.2 cumulative checks failed: $LASTEXITCODE" }
}
finally {
    [Environment]::SetEnvironmentVariable('KERUMO_RUN_ALARM_DEMO', $previousAlarmDemo, 'Process')
}
Write-Host 'PASS: stage 13.1-13.2 alarm lists, filters, transitions and acknowledgement checks.' -ForegroundColor Green
Write-Host 'Live acknowledgement changes only an isolated demo incident, never equipment state.' -ForegroundColor Cyan
Write-Host 'Manual A: Alarms -> device -> incident; check filters, pages, history and actor.' -ForegroundColor Cyan
Write-Host 'Manual B: acknowledgement leaves an active alarm active; Viewer cannot acknowledge.' -ForegroundColor Cyan
Write-Host 'Manual C: refresh, F5, mobile and context changes; no automatic write replay.' -ForegroundColor Cyan
if ($Start) {
    Set-Location (Join-Path $repoRoot 'frontend')
    $npm = Get-Command npm.cmd -ErrorAction Stop
    & $npm.Source run dev
    if ($LASTEXITCODE -ne 0) { throw "Frontend exited with code $LASTEXITCODE" }
}

param([switch]$Start)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot
$previousNotificationDemo = [Environment]::GetEnvironmentVariable('KERUMO_RUN_NOTIFICATION_DEMO', 'Process')
$previousProject = [Environment]::GetEnvironmentVariable('KERUMO_DEMO_COMPOSE_PROJECT', 'Process')
try {
    $env:KERUMO_RUN_NOTIFICATION_DEMO = '1'
    $env:KERUMO_DEMO_COMPOSE_PROJECT = 'techbaza-demo'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-stage13-op1-op2.ps1')
    if ($LASTEXITCODE -ne 0) { throw "Stage 13.3-13.4 cumulative checks failed: $LASTEXITCODE" }
}
finally {
    [Environment]::SetEnvironmentVariable('KERUMO_RUN_NOTIFICATION_DEMO', $previousNotificationDemo, 'Process')
    [Environment]::SetEnvironmentVariable('KERUMO_DEMO_COMPOSE_PROJECT', $previousProject, 'Process')
}
Write-Host 'PASS: stage 13.3-13.4 organization notifications, personal reads and browser MQTT incident flow.' -ForegroundColor Green
Write-Host 'MQTT scenario uses TB-DEMO-PRESSURE only; low pressure and normal recovery. Existing history is retained.' -ForegroundColor Cyan
Write-Host 'Manual A: Notifications -> unread filter -> notification -> mark read; check count and F5.' -ForegroundColor Cyan
Write-Host 'Manual B: owner and Viewer have independent read status; only permitted roles acknowledge alarms.' -ForegroundColor Cyan
Write-Host 'Manual C: recovered incident stays in history; inspect raised and resolved notifications, mobile and tenant changes.' -ForegroundColor Cyan
if ($Start) {
    Set-Location (Join-Path $repoRoot 'frontend')
    $npm = Get-Command npm.cmd -ErrorAction Stop
    & $npm.Source run dev
    if ($LASTEXITCODE -ne 0) { throw "Frontend exited with code $LASTEXITCODE" }
}

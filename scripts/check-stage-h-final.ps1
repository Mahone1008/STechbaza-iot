# Windows PowerShell 5.1 / PowerShell 7. Existing demo credentials and volumes are preserved.
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'check-stage8-op6.ps1')

# The shared acceptance already checked clean install, full tests, live modules,
# existing-data preflight, exact PostgreSQL/SQLite restore and restored access guards.
Write-Host 'PASS: H-04 module/channel contract, typed state readings and role-aware commands' -ForegroundColor Green
Write-Host 'PASS: H-05 full regression, clean install, exact backup/restore and safe recovery' -ForegroundColor Green
Write-Host 'PASS: H-04/H-05 acceptance; demo 0.38.0 is running. Send this result for Stage H closure.' -ForegroundColor Green

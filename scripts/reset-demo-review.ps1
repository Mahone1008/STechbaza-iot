param([switch]$Apply, [switch]$AllExisting)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repoRoot
try {
    $credentials = Join-Path $repoRoot '.local/demo-accounts/accounts.json'
    if (-not $AllExisting -and -not (Test-Path -LiteralPath $credentials -PathType Leaf)) { throw 'Existing demo credentials file is required; passwords will not be generated or changed.' }
    $dc = @('compose', '-p', 'techbaza-demo', '--env-file', '.env.demo', '-f', 'compose.demo.yml')
    foreach ($overlay in @('v3', 'controllers')) {
        if (Test-Path ".env.$overlay") { $dc += @('--env-file', ".env.$overlay", '-f', "compose.$overlay.yml") }
    }
    if (Test-Path '.env.staff') { $dc += @('--env-file', '.env.staff', '-f', 'compose.staff.demo.yml') }
    & docker @dc up -d --wait postgres
    if ($LASTEXITCODE -ne 0) { throw 'Demo database is not ready.' }
    $arguments = @('run', '--rm', '-T', '--no-deps')
    if (-not $AllExisting) { $arguments += @('-v', "${credentials}:/private/accounts.json:ro") }
    $arguments += @('backend', 'python', '-m', 'app.demo.reset_review')
    if ($AllExisting) { $arguments += '--all-existing' } else { $arguments += @('--credentials', '/private/accounts.json') }
    & docker @dc @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Review reset preview failed; database was not changed.' }
    if ($Apply) {
        $writers = @('backend', 'simulator')
        if (Test-Path '.env.staff') { $writers += 'staff-backend' }
        & docker @dc stop @writers
        if ($LASTEXITCODE -ne 0) { throw 'Could not stop demo writers.' }
        $directory = Join-Path $repoRoot ('.local/demo-reset/' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        & docker @dc exec -T postgres pg_dump -U techbaza_demo -d techbaza_demo -Fc -f /tmp/kerumo-review-before-reset.dump
        if ($LASTEXITCODE -ne 0) { throw 'Backup failed; reset was not performed.' }
        $containerId = & docker @dc ps -q postgres
        if ($LASTEXITCODE -ne 0 -or -not $containerId) { throw 'Cannot find demo database container.' }
        & docker cp "${containerId}:/tmp/kerumo-review-before-reset.dump" (Join-Path $directory 'before-reset.dump')
        if ($LASTEXITCODE -ne 0) { throw 'Could not save backup; reset was not performed.' }
        & docker @dc exec -T postgres rm -f /tmp/kerumo-review-before-reset.dump
        if ($LASTEXITCODE -ne 0) { throw 'Could not complete backup step.' }
        & docker @dc @arguments --apply
        if ($LASTEXITCODE -ne 0) { throw 'Reset failed; transaction rolled back. Backup is in .local/demo-reset.' }
        $apps = @('backend')
        if (Test-Path '.env.staff') { $apps += 'staff-backend' }
        & docker @dc up -d --no-build --no-deps --wait @apps
        if ($LASTEXITCODE -ne 0) { throw 'Reset completed; backend needs to be started again.' }
        Write-Host "PASS: example objects and security cleared; passwords and roles preserved. Backup: $directory"
        Write-Host 'The simulator stays stopped because its example devices were deleted. Sign in again in the browser.'
    } else {
        Write-Host 'Preview only. Apply with a backup: ./scripts/reset-demo-review.ps1 -Apply (add -AllExisting to reset every existing demo account).'
    }
} finally { Pop-Location }

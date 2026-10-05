param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repoRoot
try {
    $credentials = Join-Path $repoRoot '.local/demo-accounts/accounts.json'
    if (-not (Test-Path -LiteralPath $credentials -PathType Leaf)) { throw 'Existing demo credentials file is required; passwords will not be generated or changed.' }
    $dc = @('compose', '-p', 'techbaza-demo', '--env-file', '.env.demo', '-f', 'compose.demo.yml')
    & docker @dc up -d --wait postgres
    if ($LASTEXITCODE -ne 0) { throw 'Demo database is not ready.' }
    $arguments = @('run', '--rm', '-T', '--no-deps', '-v', "${credentials}:/private/accounts.json:ro", 'backend', 'python', '-m', 'app.demo.reset_review', '--credentials', '/private/accounts.json')
    & docker @dc @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Review reset preview failed; database was not changed.' }
    if ($Apply) {
        & docker @dc stop backend simulator
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
        & docker @dc up -d --no-build --no-deps --wait backend
        if ($LASTEXITCODE -ne 0) { throw 'Reset completed; backend needs to be started again.' }
        Write-Host "PASS: example objects and security cleared; passwords and roles preserved. Backup: $directory"
        Write-Host 'The simulator stays stopped because its example devices were deleted. Sign in again in the browser.'
    } else {
        Write-Host 'Preview only. To apply this reset with a backup, run: ./scripts/reset-demo-review.ps1 -Apply'
    }
} finally { Pop-Location }

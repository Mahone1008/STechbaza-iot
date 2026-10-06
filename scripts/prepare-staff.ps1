# Generate private portal secrets once. Existing account passwords are never changed.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$path = Join-Path $root '.env.staff'
if (Test-Path -LiteralPath $path) { Write-Host 'Existing .env.staff kept. No secrets or account passwords changed.'; return }
function New-StaffSecret {
    $bytes = New-Object byte[] 48
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes); return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $random.Dispose() }
}
$jwtSecret = New-StaffSecret
$probeSecret = New-StaffSecret
$content = "STAFF_JWT_SECRET=$jwtSecret`nSTAFF_DIAGNOSTICS_SECRET=$probeSecret`n"
# CreateNew prevents overwriting a concurrent preparation or an existing key file.
$stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try { $bytes = [Text.UTF8Encoding]::new($false).GetBytes($content); $stream.Write($bytes, 0, $bytes.Length) }
finally { $stream.Dispose() }
Write-Host 'Prepared .env.staff. Keep it private and keep its backup with .env.demo.'

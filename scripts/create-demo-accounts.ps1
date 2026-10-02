param([switch]$ShowPasswords, [string]$CredentialsFile)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repoRoot
try {
    if (-not (Test-Path '.env.demo')) {
        throw 'Prepare the demo stand first: docs/demo-stand-v1.md. Existing accounts are not reset.'
    }
    if ($CredentialsFile) {
        if (-not (Test-Path -LiteralPath $CredentialsFile -PathType Leaf)) {
            throw 'The supplied credentials JSON file does not exist.'
        }
        $credentialsPath = (Resolve-Path -LiteralPath $CredentialsFile).Path
        $mount = "${credentialsPath}:/private/accounts.json:ro"
    } else {
        $credentialsDir = Join-Path $repoRoot '.local/demo-accounts'
        New-Item -ItemType Directory -Path $credentialsDir -Force | Out-Null
        $credentialsPath = Join-Path $credentialsDir 'accounts.json'
        $mount = "${credentialsDir}:/private"
    }
    $compose = @('compose', '-p', 'techbaza-demo', '--env-file', '.env.demo', '-f', 'compose.demo.yml')
    & docker @compose build backend
    if ($LASTEXITCODE -ne 0) { throw 'Demo backend build failed.' }
    & docker @compose up -d --wait --wait-timeout 60 postgres
    if ($LASTEXITCODE -ne 0) { throw 'Demo database is not ready.' }
    $arguments = @('run', '--rm', '-T', '--no-deps', '-v', $mount,
                   'backend', 'python', '-m', 'app.demo.review_accounts',
                   '--credentials', '/private/accounts.json')
    if ($ShowPasswords) { $arguments += '--show-passwords' }
    & docker @compose @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Demo account preparation failed; existing passwords and roles were preserved.' }
    Write-Host "PASS: demo accounts ready. Credentials: $credentialsPath"
    Write-Host 'Login through the existing frontend connected to demo API on port 8001.'
    if (-not $ShowPasswords) { Write-Host 'To display passwords locally, repeat with -ShowPasswords.' }
} finally {
    Pop-Location
}

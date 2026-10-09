# Update the retained Windows installation without changing identity, tunnel or control flags.
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
function Docker-Checked {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw "Docker operation failed ($LASTEXITCODE)." }
}
if (!(Test-Path '.env.demo')) { throw 'The retained .env.demo is required. No new credentials are generated.' }
$compose = @('compose', '-p', 'techbaza-demo', '--env-file', '.env.demo', '-f', 'compose.demo.yml')
foreach ($overlay in @('v3', 'controllers', 'staff')) {
    if (Test-Path ".env.$overlay") {
        $file = if ($overlay -eq 'staff') { 'compose.staff.demo.yml' } else { "compose.$overlay.yml" }
        $compose += @('--env-file', ".env.$overlay", '-f', $file)
    }
}
if (Test-Path '.local/v4/identity.json') { $compose += @('-f', 'compose.v4.yml') }
foreach ($pair in @(@('staff-backend', '.env.staff'), @('v3-gateway', '.env.v3'), @('controller-gateway', '.env.controllers'), @('v4-gateway', '.local/v4/identity.json'))) {
    $existing = & docker ps -aq --filter 'label=com.docker.compose.project=techbaza-demo' --filter "label=com.docker.compose.service=$($pair[0])"
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the retained installation.' }
    if ($existing -and !(Test-Path $pair[1])) { throw "Existing $($pair[0]) needs its retained $($pair[1])." }
}
$services = @('backend')
if (Test-Path '.env.staff') { $services += 'staff-backend' }
Docker-Checked @compose build backend
Docker-Checked @compose up -d --wait postgres mosquitto
Docker-Checked @compose run --rm -T backend alembic upgrade head
Docker-Checked @compose up -d --no-deps --force-recreate --wait @services
Write-Host 'Server updated. Restart both frontend terminals and upload firmware 0.10.0 using retained local headers.' -ForegroundColor Green
Write-Host 'Database, NVS, private headers, tunnel endpoint and control flags were retained. See docs/vfd-settings-v1.md.'

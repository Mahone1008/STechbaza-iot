# Windows PowerShell 5.1 / 7. Run from the existing repository, with Docker Desktop running.
param([string]$LanIp, [string]$WifiSsid)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repo
function Docker-Checked {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw "Docker operation failed ($LASTEXITCODE). See the preceding error." }
}
$demo = @('compose', '-p', 'techbaza-demo', '--env-file', '.env.demo', '-f', 'compose.demo.yml')
if (!(Test-Path '.env.demo')) { throw 'The existing .env.demo is required. Do not create new credentials for an existing database.' }
Docker-Checked info --format '{{.OSType}}'
if (!$LanIp) {
    Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } | Format-Table InterfaceAlias, IPAddress
    $LanIp = Read-Host 'IPv4 address of this PC on the same Wi-Fi/LAN as the ESP32 (not the ESP32 address)'
}
$parsedIp = $null
if (![System.Net.IPAddress]::TryParse($LanIp, [ref]$parsedIp) -or $parsedIp.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'Expected a LAN IPv4 address.' }
if (!$WifiSsid) { $WifiSsid = Read-Host 'Wi-Fi name (2.4 GHz)' }
$local = Join-Path $repo '.local/v3'
New-Item -ItemType Directory -Force -Path $local | Out-Null
$envContent = "V3_BIND_IP=$LanIp`n"
if (Test-Path '.env.v3') {
    if ((Get-Content '.env.v3' -Raw).Trim() -ne $envContent.Trim()) { throw 'Existing .env.v3 uses another IP. Plan certificate renewal; no files were replaced.' }
} else { [IO.File]::WriteAllText((Join-Path $repo '.env.v3'), $envContent, (New-Object Text.UTF8Encoding($false))) }
$v3 = @('compose', '-p', 'techbaza-demo', '--env-file', '.env.demo', '--env-file', '.env.v3', '-f', 'compose.demo.yml', '-f', 'compose.v3.yml')
Docker-Checked @v3 build v3-gateway backend
$password = Read-Host 'Wi-Fi password (stays in local ignored files)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
try {
    $request = @{host=$LanIp; ssid=$WifiSsid; wifi_password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)} | ConvertTo-Json -Compress
    [IO.File]::WriteAllText((Join-Path $local 'setup.json'), $request, (New-Object Text.UTF8Encoding($false)))
} finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $request = $null }
try {
    Docker-Checked run --rm -i --network none -v "${local}:/work:rw" --entrypoint python3 kerumo-v3-gateway:local /opt/kerumo/generate.py
} finally { Remove-Item (Join-Path $local 'setup.json') -ErrorAction SilentlyContinue }
$target = Join-Path $repo 'firmware/kerumo_v3/config.local.h'
$generated = Join-Path $local 'config.local.h'
if (Test-Path $target) {
    if ((Get-FileHash $target).Hash -ne (Get-FileHash $generated).Hash) { throw 'Firmware config differs; it was not overwritten. Review it before continuing.' }
} else { Copy-Item $generated $target }

# Quiesce writers and keep a private pre-change database/SQLite copy.
$backup = Join-Path $repo ('backups/v3-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Path $backup | Out-Null
Copy-Item '.env.demo' (Join-Path $backup 'environment.env')
Docker-Checked @demo up -d --wait postgres mosquitto
Docker-Checked @demo stop backend simulator
try {
    Docker-Checked @demo exec -T postgres pg_dump -U techbaza_demo -d techbaza_demo --format=custom --file=/tmp/kerumo-before-v3.dump
    Docker-Checked @demo cp postgres:/tmp/kerumo-before-v3.dump (Join-Path $backup 'postgres.dump')
    Docker-Checked @demo run --rm -T --no-deps -v "${backup}:/backup" simulator python -m app.demo.backup_check sqlite-export
    Docker-Checked @demo run --rm -T --no-deps backend alembic upgrade head
    Docker-Checked @demo run --rm -T --no-deps backend python -m app.bench.su600
    Docker-Checked @v3 up -d --no-build --wait --wait-timeout 90 backend simulator v3-gateway
} catch {
    Write-Host "Preparation stopped. Existing data and backup are retained at $backup. Do not reset volumes." -ForegroundColor Yellow
    throw
}
Write-Host 'READY: V3 bench registered; control disabled. Open firmware/kerumo_v3/kerumo_v3.ino in Arduino IDE.' -ForegroundColor Green
Write-Host 'API: http://127.0.0.1:8001/health ; website: http://localhost:3000' -ForegroundColor Cyan
Write-Host 'The PC and ESP32 must share the LAN. Allow incoming TCP 8883 only from the local subnet on the Private firewall profile.'
Write-Host 'Do not share .local/v3, .env.demo, .env.v3 or config.local.h. See docs/v3-su600-bench.md for Arduino settings and checks.'

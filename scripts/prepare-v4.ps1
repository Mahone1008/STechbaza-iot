# Windows PowerShell 5.1 / 7. Uses the existing demo and the registered bench identity.
param(
    [string]$Endpoint,
    [string]$BrokerHost,
    [int]$BrokerPort = 0,
    [string]$Apn = 'internet',
    [ValidateSet('ReadOnly', 'Bench', 'Extended', 'Remote')][string]$ControlMode = 'ReadOnly',
    [switch]$RenewEndpoint
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repo
function Docker-Checked {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw "Docker operation failed ($LASTEXITCODE)." }
}
if (!(Test-Path '.env.demo')) { throw 'Existing .env.demo is required; no credentials or database were reset.' }
$source = Join-Path $repo '.local/v3'
if (!(Test-Path (Join-Path $source 'identity.json'))) { throw 'Existing .local/v3/identity.json is required for the same physical bench.' }
if (Test-Path 'firmware/kerumo_v3/factory_config.local.h') { throw 'This V4 bench uses static enrollment. Keep the factory config and select the correct sketch before proceeding.' }
if (!$Endpoint -and !$BrokerHost -and !$BrokerPort) { $Endpoint = Read-Host 'External TCP tunnel address (tcp://hostname:port)' }
if ($Endpoint) {
    if ($BrokerHost -or $BrokerPort) { throw 'Use Endpoint or BrokerHost/BrokerPort, not both.' }
    $parsedEndpoint = $null
    if (![Uri]::TryCreate($Endpoint, [UriKind]::Absolute, [ref]$parsedEndpoint) -or $parsedEndpoint.Scheme -ne 'tcp' -or $parsedEndpoint.Port -lt 1 -or $parsedEndpoint.UserInfo -or $parsedEndpoint.AbsolutePath -ne '/' -or $parsedEndpoint.Query -or $parsedEndpoint.Fragment) { throw 'Expected tcp://hostname:port from the tunnel terminal.' }
    $BrokerHost = $parsedEndpoint.DnsSafeHost
    $BrokerPort = $parsedEndpoint.Port
}
if (!$BrokerHost) { $BrokerHost = Read-Host 'External TCP tunnel hostname (without tcp:// or port)' }
if (!$BrokerPort) { $BrokerPort = [int](Read-Host 'External TCP tunnel port') }
if ($BrokerPort -lt 1 -or $BrokerPort -gt 65535) { throw 'Expected a port from 1 to 65535.' }
$local = Join-Path $repo '.local/v4'
New-Item -ItemType Directory -Force -Path $local | Out-Null
$compose = @('compose', '-p', 'techbaza-demo', '--env-file', '.env.demo', '-f', 'compose.demo.yml')
foreach ($overlay in @('v3', 'controllers')) {
    if (Test-Path ".env.$overlay") { $compose += @('--env-file', ".env.$overlay", '-f', "compose.$overlay.yml") }
}
if (Test-Path '.env.staff') { $compose += @('--env-file', '.env.staff', '-f', 'compose.staff.demo.yml') }
$compose += @('-f', 'compose.v4.yml')
Docker-Checked info --format '{{.OSType}}'
# Never recreate a customer API as the combined demo if its private overlay was lost.
$staffContainer = & docker ps -aq --filter 'label=com.docker.compose.project=techbaza-demo' --filter 'label=com.docker.compose.service=staff-backend'
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the existing staff service.' }
if ($staffContainer -and !(Test-Path '.env.staff')) { throw 'Existing staff service requires its retained .env.staff before preparing LTE.' }
Docker-Checked @compose build backend v4-gateway
$request = @{host=$BrokerHost; port=$BrokerPort; apn=$Apn; control_mode=$ControlMode; renew_endpoint=[bool]$RenewEndpoint} | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $local 'setup.json'), $request, (New-Object Text.UTF8Encoding($false)))
try {
    Docker-Checked run --rm --network none -v "${local}:/work:rw" -v "${source}:/source:ro" --entrypoint python3 kerumo-v4-gateway:local /opt/kerumo/v4.py
} finally { Remove-Item (Join-Path $local 'setup.json') -ErrorAction SilentlyContinue }
Copy-Item (Join-Path $local 'lte_config.local.h') 'firmware/kerumo_v3/lte_config.local.h' -Force
Docker-Checked @compose up -d --wait postgres mosquitto backend v4-gateway
if ($ControlMode -eq 'ReadOnly') {
    Docker-Checked @compose exec -T backend python -m app.bench.su600 --disable-control
} elseif ($ControlMode -eq 'Bench') {
    Docker-Checked @compose exec -T backend python -m app.bench.su600 --enable-control-bench-without-motor
} else {
    Docker-Checked @compose exec -T backend python -m app.bench.su600 --enable-control-extended-test
}
# Recreate only this gateway so a renewed certificate is loaded.
Docker-Checked @compose up -d --no-deps --force-recreate v4-gateway
Write-Host "READY: local TLS gateway 127.0.0.1:8884; external endpoint ${BrokerHost}:$BrokerPort; $ControlMode." -ForegroundColor Green
Write-Host 'Upload firmware/kerumo_v3/kerumo_v3.ino. UART2: TX4/RX5; SU600: TX17/RX18. Keep the terminal with the TCP tunnel running.'
Write-Host 'Existing Wi-Fi config, NVS, accounts and telemetry history are retained. See docs/v4-lte-bench.md.'

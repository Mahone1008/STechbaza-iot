# Prepare an isolated factory LTE sketch. Does not change accounts, the old bench or the device.
param(
    [string]$KitPath,
    [string]$ApiUrl,
    [string]$CaPath,
    [string]$MqttCaPath,
    [string]$Apn = 'internet',
    [ValidateSet('ReadOnly', 'Bench', 'Extended', 'Remote', 'Full')][string]$ControlMode = 'Full',
    [string]$OutputDirectory,
    [string]$PythonCommand,
    [string]$DockerImage = 'techbaza-demo-backend:local'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (!$KitPath) { $KitPath = Read-Host 'Full path to the private factory JSON downloaded from Manufacturing' }
$kitFile = (Resolve-Path -LiteralPath $KitPath).Path
$kitMetadata = Get-Content -LiteralPath $kitFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (!$ApiUrl -and $kitMetadata.public_url) {
    $publicUri = $null
    if ([Uri]::TryCreate([string]$kitMetadata.public_url, [UriKind]::Absolute, [ref]$publicUri) -and $publicUri.Scheme -eq 'https') {
        $ApiUrl = $publicUri.GetLeftPart([UriPartial]::Authority)
    }
}
if (!$ApiUrl) { $ApiUrl = Read-Host 'Public HTTPS API origin, for example https://your-customer-domain' }
if (!$CaPath) { $CaPath = Read-Host 'Full path to the trusted API CA certificate (PEM)' }
$apiCaFile = (Resolve-Path -LiteralPath $CaPath).Path
if (!$MqttCaPath) { $MqttCaPath = Read-Host 'Full path to the trusted MQTT CA certificate (PEM)' }
if ($MqttCaPath) { $mqttCaFile = (Resolve-Path -LiteralPath $MqttCaPath).Path }
if (!$OutputDirectory) {
    $OutputDirectory = Join-Path $repo ('.local/factory-v4/' + [Guid]::NewGuid().ToString('N'))
}
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'OutputDirectory already exists. Choose a new directory; no files were overwritten.' }
$source = Join-Path $repo 'firmware/kerumo_v3'
# Do not copy any local config: the legacy bench UID, credentials and manifest belong to the old device.
$sketch = Join-Path $output 'kerumo_v3'
New-Item -ItemType Directory -Path $sketch -Force | Out-Null
Get-ChildItem -LiteralPath $source -File | Where-Object { $_.Name -notlike '*.local.h' } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $sketch
}
Copy-Item -LiteralPath (Join-Path $source 'src') -Destination (Join-Path $sketch 'src') -Recurse
$incomplete = Join-Path $sketch 'config.local.h'
[IO.File]::WriteAllText($incomplete, '#error "Factory bundle generation incomplete. Do not upload this sketch."', [Text.UTF8Encoding]::new($false))
$generator = Join-Path $repo 'backend/app/tools/factory_config.py'
$generationArgs = @($generator, $kitFile, '--ca', $apiCaFile, '--api-url', $ApiUrl,
    '--output', (Join-Path $sketch 'factory_config.local.h'), '--transport', 'lte',
    '--apn', $Apn, '--control-mode', $ControlMode)
if ($MqttCaPath) { $generationArgs += @('--mqtt-ca', $mqttCaFile) }
if ($PythonCommand) {
    & $PythonCommand @generationArgs
} else {
    if (!(Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Start Docker Desktop, or provide -PythonCommand with a Python installation containing cryptography.' }
    $dockerGeneration = @('run', '--rm', '--network', 'none',
        '-v', "${generator}:/generator.py:ro", '-v', "${kitFile}:/kit.json:ro",
        '-v', "${apiCaFile}:/api-ca.pem:ro", '-v', "${sketch}:/output:rw")
    # On Unix keep the private 0600 output owned by the operator, not container root.
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Unix) {
        $operatorUid = & id -u
        if ($LASTEXITCODE -ne 0) { throw 'Unable to determine the operator UID for Docker output.' }
        $operatorGid = & id -g
        if ($LASTEXITCODE -ne 0) { throw 'Unable to determine the operator GID for Docker output.' }
        $dockerGeneration += @('--user', "${operatorUid}:${operatorGid}")
    }
    if ($MqttCaPath) { $dockerGeneration += @('-v', "${mqttCaFile}:/mqtt-ca.pem:ro") }
    $dockerGeneration += @('--entrypoint', 'python', $DockerImage, '/generator.py', '/kit.json',
        '--ca', '/api-ca.pem', '--api-url', $ApiUrl, '--output', '/output/factory_config.local.h',
        '--transport', 'lte', '--apn', $Apn, '--control-mode', $ControlMode)
    if ($MqttCaPath) { $dockerGeneration += @('--mqtt-ca', '/mqtt-ca.pem') }
    & docker @dockerGeneration
}
if ($LASTEXITCODE -ne 0) { throw 'Factory generation failed. Inspect the new directory; existing firmware and keys were retained.' }
Remove-Item -LiteralPath $incomplete
Write-Host "READY: isolated V4 factory sketch: $sketch" -ForegroundColor Green
Write-Host 'Open kerumo_v3.ino in that directory and upload it to the intended board. Existing bench files are retained.'
Write-Host 'The registry must say 4G (LTE). API HTTPS and managed MQTT must be reachable through the SIM with trusted certificates.'
Write-Host "Firmware mode: $ControlMode. Full includes all control modes; the server and local installation checks authorize their use. QR activation never starts the motor."
Write-Host 'Next: Manufacturing prepares the passport; the installer confirms the installation; the customer activates it. See docs/v4-full-control-onboarding.md.'

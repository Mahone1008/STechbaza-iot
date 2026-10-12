# Prepare an isolated factory LTE sketch. Does not change accounts, the old bench or the device.
param(
    [Parameter(Mandatory=$true)][string]$KitPath,
    [Parameter(Mandatory=$true)][string]$ApiUrl,
    [Parameter(Mandatory=$true)][string]$CaPath,
    [string]$MqttCaPath,
    [string]$Apn = 'internet',
    [ValidateSet('ReadOnly', 'Bench', 'Extended', 'Remote')][string]$ControlMode = 'ReadOnly',
    [string]$OutputDirectory,
    [string]$PythonCommand = 'python'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$kitFile = (Resolve-Path -LiteralPath $KitPath).Path
$apiCaFile = (Resolve-Path -LiteralPath $CaPath).Path
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
& $PythonCommand @generationArgs
if ($LASTEXITCODE -ne 0) { throw 'Factory generation failed. Inspect the new directory; existing firmware and keys were retained.' }
Remove-Item -LiteralPath $incomplete
Write-Host "READY: isolated V4 factory sketch: $sketch" -ForegroundColor Green
Write-Host 'Open kerumo_v3.ino in that directory and upload it to the intended board. Existing bench files are retained.'
Write-Host 'The registry must say 4G (LTE). API HTTPS and managed MQTT must be reachable through the SIM with trusted certificates.'
Write-Host 'First acceptance defaults to ReadOnly. QR activation never starts the motor. See docs/v4-factory-onboarding.md.'

param([Parameter(Mandatory=$true)][string]$HostIp)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$root = Join-Path $PWD '.local/controllers'
New-Item -ItemType Directory -Force $root | Out-Null
docker build -t kerumo-v3-gateway:local infrastructure/v3
if ($LASTEXITCODE -ne 0) { throw 'Не вдалося зібрати шлюз' }
docker run --rm --network none -v "${root}:/work:rw" --entrypoint python3 kerumo-v3-gateway:local /opt/kerumo/controllers.py --host $HostIp
if ($LASTEXITCODE -ne 0) { throw 'Підготовку зупинено; наявні ключі не замінюйте' }
$privateEnv = docker run --rm --network none -v "${root}:/work:ro" --entrypoint cat kerumo-v3-gateway:local /work/controllers.env
if ($LASTEXITCODE -ne 0) { throw 'Не вдалося прочитати конфігурацію' }
$envPath = Join-Path $PWD '.env.controllers'
$content = ($privateEnv -join "`n") + "`n"
if ((Test-Path $envPath) -and [IO.File]::ReadAllText($envPath).Replace("`r`n", "`n") -ne $content) { throw '.env.controllers вже відрізняється; перевірте наявне розгортання' }
[IO.File]::WriteAllText($envPath, $content, [Text.UTF8Encoding]::new($false))
$privateEnv = $null
$ca = docker run --rm --network none -v "${root}:/work:ro" --entrypoint cat kerumo-v3-gateway:local /work/ca.crt
if ($LASTEXITCODE -ne 0) { throw 'Не вдалося прочитати CA' }
[IO.File]::WriteAllText((Join-Path $PWD '.local/controllers-ca.crt'), ($ca -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
Write-Host 'Шлюз підготовлено. Секрети у .env.controllers та .local/controllers; не публікуйте їх.'

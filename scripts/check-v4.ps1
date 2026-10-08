param([int]$Timeout = 90, [switch]$AllowControl)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repo
$probe = Join-Path $repo '.local/v4/probe'
if (!(Test-Path (Join-Path $probe 'identity.json'))) { throw 'Run scripts/prepare-v4.ps1 first.' }
$arguments = @('compose', '-p', 'techbaza-demo', '--env-file', '.env.demo', '-f', 'compose.demo.yml', '-f', 'compose.v4.yml',
               'run', '--rm', '-T', '--no-deps', '-v', "${probe}:/probe:ro", 'backend',
               'python', '-m', 'app.bench.v4_probe', '--timeout', "$Timeout")
if ($AllowControl) { $arguments += '--allow-control' }
& docker @arguments
if ($LASTEXITCODE -ne 0) { throw 'LTE test failed. Inspect the preceding message and Serial Monitor.' }

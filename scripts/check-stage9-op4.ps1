param(
    [switch]$Start
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$frontend = Join-Path $repoRoot "frontend"

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { $nodeCommand = Get-Command node -ErrorAction SilentlyContinue }
if (-not $nodeCommand) { throw "Node.js 20.9+ was not found." }

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) { throw "npm.cmd was not found in PATH." }

$pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $pythonCommand) { $pythonCommand = Get-Command python -ErrorAction SilentlyContinue }
if (-not $pythonCommand) { throw "Python was not found in PATH." }

function Invoke-Npm {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    & $npmCommand.Source @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

Set-Location $repoRoot
Write-Host "Repository: $repoRoot" -ForegroundColor Cyan
Write-Host "Frontend: $frontend" -ForegroundColor Cyan
Write-Host "Node.js $((& $nodeCommand.Source --version).Trim())" -ForegroundColor Cyan

Set-Location $frontend
Invoke-Npm -Arguments @("ci", "--no-audit", "--no-fund")

Set-Location $repoRoot
& $pythonCommand.Source ".\scripts\export_openapi.py"
if ($LASTEXITCODE -ne 0) { throw "OpenAPI export failed." }

Set-Location $frontend
Invoke-Npm -Arguments @("run", "api:generate")

Set-Location $repoRoot
& git diff --quiet -- "frontend/src/lib/api/openapi.json" "frontend/src/lib/api/schema.d.ts"
if ($LASTEXITCODE -ne 0) {
    throw "Generated OpenAPI files differ from Git. Review and commit the contract update before continuing."
}

Set-Location $frontend
Invoke-Npm -Arguments @("run", "api:verify")
Invoke-Npm -Arguments @("run", "typecheck")
Invoke-Npm -Arguments @("run", "lint")
Invoke-Npm -Arguments @("run", "test:unit")
Invoke-Npm -Arguments @("run", "build")
Invoke-Npm -Arguments @("run", "browser:install")
Invoke-Npm -Arguments @("run", "test:browser")

Write-Host "PASS: Stage 9.4 clean install, API contract, unit tests, production build and Chromium smoke tests." -ForegroundColor Green

if ($Start) {
    Write-Host "Starting KERUMO at http://127.0.0.1:3000" -ForegroundColor Cyan
    Invoke-Npm -Arguments @("run", "dev")
}

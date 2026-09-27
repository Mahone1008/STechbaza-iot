param(
    [switch]$Start
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$frontend = Join-Path $repoRoot "frontend"

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { $nodeCommand = Get-Command node -ErrorAction SilentlyContinue }
if (-not $nodeCommand) { throw "Node.js 20.9+ was not found. Open a new PowerShell after installing Node.js." }

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) { throw "npm.cmd was not found in PATH." }

$nodeVersionText = (& $nodeCommand.Source --version).TrimStart("v")
if ([version]$nodeVersionText -lt [version]"20.9.0") {
    throw "Node.js 20.9.0 or newer is required. Current version: $nodeVersionText"
}

Set-Location $frontend
Write-Host "Node.js $nodeVersionText" -ForegroundColor Cyan
Write-Host "Frontend: $frontend" -ForegroundColor Cyan

function Invoke-Npm {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    & $npmCommand.Source @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

Invoke-Npm -Arguments @("ci", "--no-audit", "--no-fund")
Invoke-Npm -Arguments @("run", "api:verify")
Invoke-Npm -Arguments @("run", "typecheck")
Invoke-Npm -Arguments @("run", "lint")
Invoke-Npm -Arguments @("run", "build")

Write-Host "PASS: Stage 9.3 OpenAPI contract, typecheck, lint and production build." -ForegroundColor Green
Write-Host "API status page: http://127.0.0.1:3000/ui-kit" -ForegroundColor Cyan

if ($Start) {
    Write-Host "Starting KERUMO at http://127.0.0.1:3000" -ForegroundColor Cyan
    & $npmCommand.Source run dev
}

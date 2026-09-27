param(
    [switch]$Start
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$frontend = Join-Path $repoRoot "frontend"

Set-Location $repoRoot

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
}
if (-not $nodeCommand) {
    throw "Node.js was not found. Install Node.js 20.9+ and open a new PowerShell window."
}

# On Windows PowerShell, calling `npm` may select npm.ps1 and fail when script
# execution is restricted. npm.cmd is the official Windows command shim and
# does not require changing the user's execution policy.
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
    throw "npm.cmd was not found in PATH. Reinstall Node.js with npm enabled and open a new PowerShell window."
}

$nodeVersionText = (& $nodeCommand.Source --version).TrimStart("v")
$nodeVersion = [version]$nodeVersionText
if ($nodeVersion -lt [version]"20.9.0") {
    throw "Node.js 20.9.0 or newer is required. Current version: $nodeVersionText"
}

Write-Host "Node.js $nodeVersionText" -ForegroundColor Cyan
Write-Host "npm command: $($npmCommand.Source)" -ForegroundColor Cyan
Write-Host "Frontend: $frontend" -ForegroundColor Cyan

Set-Location $frontend

if (-not (Test-Path ".\package-lock.json")) {
    throw "package-lock.json is missing. Run git pull and try again."
}

function Invoke-Npm {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $npmCommand.Source @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

Invoke-Npm -Arguments @("ci", "--no-audit", "--no-fund")
Invoke-Npm -Arguments @("run", "typecheck")
Invoke-Npm -Arguments @("run", "lint")
Invoke-Npm -Arguments @("run", "build")

Write-Host "PASS: Stage 9.2 frontend typecheck, lint and production build." -ForegroundColor Green

if ($Start) {
    Write-Host "Starting KERUMO at http://127.0.0.1:3000" -ForegroundColor Cyan
    & $npmCommand.Source run dev
}

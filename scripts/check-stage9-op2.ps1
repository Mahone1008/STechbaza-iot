param(
    [switch]$Start
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$frontend = Join-Path $repoRoot "frontend"

Set-Location $repoRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js не знайдено. Встановіть Node.js 20.9+ і відкрийте нове вікно PowerShell."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm не знайдено у PATH."
}

$nodeVersionText = (& node --version).TrimStart("v")
$nodeVersion = [version]$nodeVersionText
if ($nodeVersion -lt [version]"20.9.0") {
    throw "Потрібен Node.js 20.9.0 або новіший. Поточна версія: $nodeVersionText"
}

Write-Host "Node.js $nodeVersionText" -ForegroundColor Cyan
Write-Host "Frontend: $frontend" -ForegroundColor Cyan

Set-Location $frontend

if (-not (Test-Path ".\package-lock.json")) {
    throw "package-lock.json відсутній. Виконайте git pull після завершення CI операції 9.2."
}

npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "typecheck failed" }

npm run lint
if ($LASTEXITCODE -ne 0) { throw "lint failed" }

npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

Write-Host "PASS: Stage 9.2 frontend typecheck, lint and production build." -ForegroundColor Green

if ($Start) {
    Write-Host "Starting KERUMO at http://127.0.0.1:3000" -ForegroundColor Cyan
    npm run dev
}

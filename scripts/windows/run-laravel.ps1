param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path,
  [string]$HostAddress = "0.0.0.0",
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

$laravelDir = Join-Path $ProjectRoot "laravel"

$dataDir = Join-Path $env:LOCALAPPDATA "WorkColbeefSuite"
$logDir = Join-Path $dataDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$outLog = Join-Path $logDir "laravel-out.log"
$errLog = Join-Path $logDir "laravel-err.log"

Start-Process -FilePath "php" `
  -ArgumentList @("artisan", "serve", "--host=$HostAddress", "--port=$Port") `
  -WorkingDirectory $laravelDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog | Out-Null


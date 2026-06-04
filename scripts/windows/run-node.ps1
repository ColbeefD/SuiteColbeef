param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
)

$ErrorActionPreference = "Stop"

$dataDir = Join-Path $env:LOCALAPPDATA "WorkColbeefSuite"
$logDir = Join-Path $dataDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$outLog = Join-Path $logDir "node-out.log"
$errLog = Join-Path $logDir "node-err.log"

Start-Process -FilePath "node" `
  -ArgumentList @("server.js") `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog | Out-Null


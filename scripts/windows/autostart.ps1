param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("install", "uninstall")]
  [string]$Action,

  [ValidateSet("node", "laravel")]
  [string]$Mode = "laravel",

  [ValidateSet("runkey", "task")]
  [string]$Method = "runkey",

  [string]$TaskName = "WorkColbeefSuite",

  [string]$HostAddress = "0.0.0.0",

  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

function Quote([string]$s) {
  return '"' + ($s -replace '"', '""') + '"'
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..")).Path
$runNode = Join-Path $projectRoot "scripts\\windows\\run-node.ps1"
$runLaravel = Join-Path $projectRoot "scripts\\windows\\run-laravel.ps1"

if ($Action -eq "uninstall") {
  if ($Method -eq "task") {
    schtasks /Delete /TN $TaskName /F | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Aviso: no se pudo borrar la tarea ($TaskName). Puede que no exista o falten permisos."
      exit $LASTEXITCODE
    }

    Write-Host "OK: tarea eliminada ($TaskName)"
    exit 0
  }

  $runKeyPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
  Remove-ItemProperty -Path $runKeyPath -Name $TaskName -ErrorAction SilentlyContinue
  Write-Host "OK: auto-inicio removido (Run key) -> $TaskName"
  exit 0
}

$ps = Join-Path $env:WINDIR "System32\\WindowsPowerShell\\v1.0\\powershell.exe"

if ($Mode -eq "node") {
  $taskCmd = (Quote $ps) + " -NoProfile -ExecutionPolicy Bypass -File " + (Quote $runNode) + " -ProjectRoot " + (Quote $projectRoot)
} else {
  $taskCmd = (Quote $ps) + " -NoProfile -ExecutionPolicy Bypass -File " + (Quote $runLaravel) +
    " -ProjectRoot " + (Quote $projectRoot) +
    " -HostAddress " + (Quote $HostAddress) +
    " -Port " + $Port
}

if ($Method -eq "task") {
  schtasks /Create `
    /TN $TaskName `
    /SC ONLOGON `
    /RU $env:USERNAME `
    /RL LIMITED `
    /DELAY 0000:10 `
    /F `
    /TR $taskCmd | Out-Null

  if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: no se pudo crear la tarea ($TaskName)."
    Write-Host "Sugerencia: ejecuta PowerShell como Administrador, o usa -Method runkey."
    exit $LASTEXITCODE
  }

  Write-Host "OK: tarea creada ($TaskName) -> $Mode"
  Write-Host "Logs: $env:LOCALAPPDATA\\WorkColbeefSuite\\logs\\"
  exit 0
}

$runKeyPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"
New-Item -Path $runKeyPath -Force | Out-Null
New-ItemProperty -Path $runKeyPath -Name $TaskName -Value $taskCmd -PropertyType String -Force | Out-Null

Write-Host "OK: auto-inicio instalado (Run key) -> $Mode"
Write-Host "Nombre: $TaskName"
Write-Host "Logs: $env:LOCALAPPDATA\\WorkColbeefSuite\\logs\\"


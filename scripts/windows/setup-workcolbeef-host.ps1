# Configura el nombre local WorkColbeef -> IP del servidor (archivo hosts de Windows).
# Requiere ejecutar como Administrador.
param(
  [ValidateSet("install", "uninstall")]
  [string]$Action = "install",

  [string]$ServerIp = "192.168.20.205",
  [string]$Hostname = "WorkColbeef",
  [int]$Port = 8000,

  [switch]$CreateShortcut
)

$ErrorActionPreference = "Stop"

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-HostsPath {
  return Join-Path $env:Windir "System32\drivers\etc\hosts"
}

function Read-HostsLines {
  $path = Get-HostsPath
  if (-not (Test-Path $path)) {
    return @()
  }
  return Get-Content -Path $path -Encoding UTF8
}

function Write-HostsLines {
  param([string[]]$Lines)
  $path = Get-HostsPath
  Set-Content -Path $path -Value $Lines -Encoding UTF8
}

function Remove-WorkColbeefHostsEntries {
  param([string[]]$Lines)

  $marker = "# WorkColbeef Suite"
  $aliases = @("WorkColbeef", "workcolbeef")
  $out = New-Object System.Collections.Generic.List[string]

  foreach ($line in $Lines) {
    $trim = $line.Trim()
    if ($trim -eq $marker) { continue }
    if ($trim -match "^\s*#") {
      $out.Add($line)
      continue
    }
    $skip = $false
    foreach ($alias in $aliases) {
      if ($trim -match "\s$([regex]::Escape($alias))(\s|$)") {
        $skip = $true
        break
      }
    }
    if (-not $skip) {
      $out.Add($line)
    }
  }

  return ,$out.ToArray()
}

function Install-WorkColbeefHost {
  param([string[]]$Lines)

  $marker = "# WorkColbeef Suite"
  $entry = "$ServerIp`t$Hostname`tworkcolbeef"
  $clean = Remove-WorkColbeefHostsEntries -Lines $Lines

  $out = New-Object System.Collections.Generic.List[string]
  $out.AddRange($clean)
  if ($out.Count -gt 0 -and $out[$out.Count - 1].Trim() -ne "") {
    $out.Add("")
  }
  $out.Add($marker)
  $out.Add($entry)

  Write-HostsLines -Lines $out.ToArray()
}

function New-WorkColbeefShortcut {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $urlPath = Join-Path $desktop "WorkColbeef.url"
  $target = "http://${Hostname}:$Port/"
  $content = @(
    "[InternetShortcut]"
    "URL=$target"
    "IconIndex=0"
  )
  Set-Content -Path $urlPath -Value $content -Encoding ASCII
  return $urlPath
}

if (-not (Test-IsAdmin)) {
  Write-Host ""
  Write-Host "Este script necesita permisos de Administrador (modifica el archivo hosts)."
  Write-Host "Vuelve a ejecutar configurar-workcolbeef.bat con clic derecho -> Ejecutar como administrador."
  Write-Host ""
  exit 1
}

$hostsPath = Get-HostsPath
$lines = Read-HostsLines

if ($Action -eq "uninstall") {
  $clean = Remove-WorkColbeefHostsEntries -Lines $lines
  Write-HostsLines -Lines $clean
  Write-Host ""
  Write-Host "OK: entradas de WorkColbeef eliminadas de $hostsPath"
  Write-Host ""
  exit 0
}

Install-WorkColbeefHost -Lines $lines

Write-Host ""
Write-Host "OK: nombre local configurado."
Write-Host ""
Write-Host "  $Hostname  ->  $ServerIp"
Write-Host ""
Write-Host "Abre la suite en el navegador con:"
Write-Host "  http://${Hostname}:$Port/"
Write-Host ""
Write-Host "Nota: escribe la URL completa (con http://). Si solo escribes WorkColbeef,"
Write-Host "      el navegador puede buscar en Google. Usa el acceso directo del escritorio."
Write-Host ""

if ($CreateShortcut) {
  $shortcut = New-WorkColbeefShortcut
  Write-Host "Acceso directo creado: $shortcut"
  Write-Host ""
}

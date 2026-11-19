param(
  [int]$Port = 3100
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $projectRoot 'server-restart-exact.log'

function Write-RestartLog([string]$message) {
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message" | Add-Content -LiteralPath $logPath
}

# Hentikan hanya Node yang menjalankan CAP dari folder proyek ini.  Tidak
# menyentuh proses Node lain pada komputer maupun data SQLite.
$escapedRoot = [regex]::Escape($projectRoot)
$capNodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match $escapedRoot -and $_.CommandLine -match 'app\.mjs' }

foreach ($process in $capNodes) {
  Write-RestartLog "Stopping CAP Node PID $($process.ProcessId): $($process.CommandLine)"
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

for ($attempt = 0; $attempt -lt 25; $attempt += 1) {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) { break }
  Start-Sleep -Milliseconds 400
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  throw "Port $Port masih dipakai PID $($listener.OwningProcess); server tidak dijalankan agar tidak terjadi database lock."
}

Write-RestartLog "Starting one CAP server on port $Port"
Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $projectRoot 'Run-CAP-Server.ps1')`"", '-Port', $Port
)

for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port" -TimeoutSec 2
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      Write-RestartLog 'Server healthy.'
      exit 0
    }
  } catch {}
}

throw 'CAP server tidak sehat setelah restart. Periksa server-restart-exact.log.'

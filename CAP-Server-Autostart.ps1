param([int]$Port = 3100)

$ErrorActionPreference = 'Stop'
$serverPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$logPath = Join-Path $serverPath 'startup.log'
$errorLogPath = Join-Path $serverPath 'startup-error.log'

function Write-StartupLog([string]$Message) {
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  # Log yang sedang dibuka proses lain tidak boleh menggagalkan autostart.
  try { Add-Content -LiteralPath $logPath -Value "[$timestamp] $Message" -ErrorAction Stop } catch {}
}

# Jangan membuat proses kedua bila server sudah aktif, misalnya setelah restart
# manual atau ketika Windows memanggil entry startup lebih dari sekali.
try {
  $existing = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($existing) {
    Write-StartupLog "Port $Port sudah aktif (PID $($existing.OwningProcess)); autostart dilewati."
    exit 0
  }
} catch {}

$runner = Join-Path $serverPath 'Run-CAP-Server.ps1'
if (-not (Test-Path -LiteralPath $runner)) {
  throw 'Run-CAP-Server.ps1 tidak ditemukan.'
}

try {
  Write-StartupLog "Memulai CAP Analytics pada port $Port."
  & $runner -Port $Port
} catch {
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -LiteralPath $errorLogPath -Value "[$timestamp] $($_.Exception.Message)"
  throw
}

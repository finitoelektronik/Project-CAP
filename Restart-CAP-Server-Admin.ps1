param(
  [int]$Port = 3100,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

function Stop-CapNodeListener {
  param([int]$TargetPort)

  $listener = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) { return }

  $process = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
  if ($process.ProcessName -ne 'node') {
    throw "Port $TargetPort sedang dipakai proses $($process.ProcessName), bukan server CAP."
  }

  # Mode pengembangan memakai `node --watch app.mjs`. Bila hanya anak yang
  # mendengarkan port dihentikan, pengawas dapat menyalakan kembali versi lama
  # sebelum runner baru dimulai. Hentikan hanya leluhur Node yang benar-benar
  # menjalankan pengawas CAP, bukan proses Node lain di komputer.
  $watcher = $null
  $child = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  for ($depth = 0; $child -and $child.ParentProcessId -and $depth -lt 8; $depth += 1) {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($child.ParentProcessId)" -ErrorAction SilentlyContinue
    if (-not $parent) { break }
    if ($parent.Name -ieq 'node.exe' -and $parent.CommandLine -match '(?i)--watch.*app\.mjs') {
      $watcher = $parent
      break
    }
    $child = $parent
  }

  if ($watcher) {
    Stop-Process -Id $watcher.ProcessId -Force -ErrorAction Stop
  } else {
    Stop-Process -Id $process.Id -Force -ErrorAction Stop
  }
  Start-Sleep -Milliseconds 800
}

Stop-CapNodeListener -TargetPort $Port

$runner = Join-Path $PSScriptRoot 'Run-CAP-Server.ps1'
Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$runner`"", '-Port', $Port
)
$address = "http://localhost:$Port"
foreach ($attempt in 1..30) {
  Start-Sleep -Milliseconds 400
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $address -TimeoutSec 2
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      if (-not $NoBrowser) { Start-Process $address }
      exit 0
    }
  } catch {}
}

Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show(
  'CAP Analytics belum dapat dimulai ulang. Silakan jalankan CAP Analytics lagi atau kirim Paket Diagnostik.',
  'CAP Analytics',
  [System.Windows.Forms.MessageBoxButtons]::OK,
  [System.Windows.Forms.MessageBoxIcon]::Error
) | Out-Null
exit 1

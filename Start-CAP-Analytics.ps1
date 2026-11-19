param([int]$Port = 3100)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$address = "http://localhost:$Port"

function Test-CapServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $address -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

if (-not (Test-CapServer)) {
  $runner = Join-Path $root 'Run-CAP-Server.ps1'
  if (-not (Test-Path -LiteralPath $runner)) {
    throw 'File server CAP tidak ditemukan. Jalankan ulang pemasangan CAP Analytics.'
  }

  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$runner`"", '-Port', $Port
  )

  $ready = $false
  foreach ($attempt in 1..30) {
    Start-Sleep -Milliseconds 400
    if (Test-CapServer) { $ready = $true; break }
  }
  if (-not $ready) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      "CAP Analytics belum dapat dijalankan. Gunakan Restart CAP Analytics, lalu coba lagi.",
      'CAP Analytics',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
  }
}

Start-Process $address

param(
  [int]$Port = 3100
)

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
  $nodePath = $nodeCommand.Source
} else {
  $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  $systemNode = 'C:\Program Files\nodejs\node.exe'
  if (Test-Path -LiteralPath $bundledNode) {
    $nodePath = $bundledNode
  } elseif (Test-Path -LiteralPath $systemNode) {
    $nodePath = $systemNode
  } else {
    throw 'Node.js tidak ditemukan. Instal Node.js LTS atau buka aplikasi ini melalui Codex.'
  }
}

$env:PORT = $Port

# Hentikan hanya server Node lama pada port aplikasi ini. Data tetap aman karena
# seluruh data berada di SQLite, bukan di memori proses Node.
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq 'node') {
    Stop-Process -Id $process.Id -Force
    Start-Sleep -Milliseconds 500
  } elseif ($process) {
    throw "Port $Port sedang digunakan oleh $($process.ProcessName). Tutup aplikasi tersebut atau jalankan .\start-dev.ps1 -Port 3101."
  }
}

& $nodePath --watch app.mjs

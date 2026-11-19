param([int]$Port = 3100)

$ErrorActionPreference = 'Stop'
$serverPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundledNode = Join-Path $serverPath 'runtime\node\bin\node.exe'
$codexRuntimeNodes = @(
  Get-ChildItem -LiteralPath 'C:\Users' -Directory -ErrorAction SilentlyContinue |
    ForEach-Object {
      $runtimeRoot = Join-Path $_.FullName '.cache\codex-runtimes'
      if (Test-Path -LiteralPath $runtimeRoot) {
        Get-ChildItem -LiteralPath $runtimeRoot -Filter node.exe -Recurse -ErrorAction SilentlyContinue |
          Select-Object -ExpandProperty FullName
      }
    }
)
$nodeCandidates = @()
$systemNode = Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue
foreach ($candidate in @($systemNode, $bundledNode, 'C:\Program Files\nodejs\node.exe', 'C:\Program Files (x86)\nodejs\node.exe')) {
  if ($candidate -and (Test-Path -LiteralPath $candidate)) { $nodeCandidates += $candidate }
}
foreach ($candidate in $codexRuntimeNodes) {
  if ($candidate -and (Test-Path -LiteralPath $candidate)) { $nodeCandidates += $candidate }
}
$nodeCandidates = @($nodeCandidates | Select-Object -Unique)

if (-not $nodeCandidates) {
  throw 'Node.js LTS versi 22 atau lebih baru belum ditemukan. Instal Node.js lalu jalankan ulang tugas CAP Analytics.'
}

$env:PORT = $Port
Set-Location -LiteralPath $serverPath
# Pantau perubahan aplikasi dan mulai ulang server CAP secara otomatis setelah upgrade.
& $nodeCandidates[0] --watch app.mjs

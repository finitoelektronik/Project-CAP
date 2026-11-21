# Kunci sesi Claude Code ke satu modul CAP.
# Penguncian dicatat oleh penjaga otomatis (cap-module-guard.ps1) saat perintah ini dijalankan.
param([Parameter(Mandatory = $true)][string]$Module)
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$registry = Get-Content -LiteralPath (Join-Path $root 'cap-modules.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$entry = $registry.modules | Where-Object { $_.id -eq $Module }
if (-not $entry) {
  Write-Output "Modul '$Module' tidak dikenal. Pilihan:"
  $registry.modules | ForEach-Object { Write-Output "  - $($_.id): $($_.label)" }
  exit 1
}
Write-Output "Sesi dikunci ke modul: $($entry.id) ($($entry.label))"
Write-Output 'Wilayah berkas:'
$entry.files | ForEach-Object { Write-Output "  $_" }
if ($entry.id -ne 'inti') {
  Write-Output "Berkas bersama sementara (hanya bagian modul ini): $($registry.shared_temporary.files -join ', ')"
}

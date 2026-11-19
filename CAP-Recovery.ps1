$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$snapshots = Join-Path $root 'data\recovery\snapshots'
$runner = Join-Path $root 'scripts\cap_recovery_runner.cjs'

if (-not (Test-Path -LiteralPath $runner)) {
  throw 'CAP Recovery belum tersedia. Jalankan pembaruan CAP Analytics terlebih dahulu.'
}
if (-not (Test-Path -LiteralPath $snapshots)) {
  throw 'Belum ada snapshot pemulihan. Snapshot dibuat otomatis saat memasang atau memperbarui modul.'
}

$latest = Get-ChildItem -LiteralPath $snapshots -Directory | Sort-Object Name -Descending | Select-Object -First 1
if (-not $latest) { throw 'Belum ada snapshot pemulihan.' }

$answer = Read-Host "Pulihkan snapshot $($latest.Name) dan jalankan ulang CAP? (Y/N)"
if ($answer -notmatch '^[Yy]') { exit 0 }

$bundledNode = Join-Path $root 'runtime\node\bin\node.exe'
$node = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
& $node $runner $node $root $latest.Name restore
if ($LASTEXITCODE -eq 0) {
  Write-Host 'CAP Recovery selesai. Buka kembali http://localhost:3100.' -ForegroundColor Green
} else {
  throw 'CAP Recovery belum berhasil. Kirim Paket Diagnostik ke Codex.'
}
Read-Host 'Tekan Enter untuk menutup'

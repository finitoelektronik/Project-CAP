# Penjaga sesi CAP (hook PreToolUse Claude Code).
# - Mencatat kunci modul saat sesi menjalankan scripts/claude/cap-lock.ps1 -Module <id>.
# - Menolak Edit/Write berkas project di luar wilayah modul yang dikunci (lihat cap-modules.json).
# Keluar dengan kode 2 = tindakan ditolak; pesan di stderr dibaca oleh Claude.
$ErrorActionPreference = 'Stop'
try {
  $raw = [Console]::In.ReadToEnd()
  if (-not $raw.Trim()) { exit 0 }
  $hook = $raw | ConvertFrom-Json
} catch { exit 0 }

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path.TrimEnd('\')
$registryPath = Join-Path $root 'cap-modules.json'
if (-not (Test-Path -LiteralPath $registryPath)) { exit 0 }
$registry = Get-Content -LiteralPath $registryPath -Raw -Encoding UTF8 | ConvertFrom-Json
$sessionId = [string]$hook.session_id
if (-not $sessionId) { $sessionId = 'tanpa-sesi' }
$safeSession = ($sessionId -replace '[^A-Za-z0-9_-]', '_')
$lockDir = Join-Path $root '.claude\cap-locks'
$lockPath = Join-Path $lockDir "$safeSession.json"
$tool = [string]$hook.tool_name
$moduleList = ($registry.modules | ForEach-Object { "  - $($_.id): $($_.label)" }) -join "`n"

function Deny([string]$message) { [Console]::Error.WriteLine($message); exit 2 }
function Get-Lock { if (Test-Path -LiteralPath $lockPath) { return (Get-Content -LiteralPath $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json) } return $null }

# 1) Perintah penguncian lewat terminal.
if ($tool -in @('PowerShell', 'Bash')) {
  $command = [string]$hook.tool_input.command
  $match = [regex]::Match($command, 'cap-lock(?:\.ps1)?["'']?\s+(?:-Module\s+)?["'']?([a-z_]+)')
  if (-not $match.Success) { exit 0 }
  $module = $match.Groups[1].Value
  if (-not ($registry.modules | Where-Object { $_.id -eq $module })) { Deny "Modul '$module' tidak dikenal. Pilihan modul:`n$moduleList" }
  $current = Get-Lock
  if ($current -and $current.module -ne $module) { Deny "Sesi ini sudah terkunci ke modul '$($current.module)'. Modul tidak dapat diganti di sesi yang sama; buka sesi baru untuk modul '$module'." }
  if (-not $current) {
    New-Item -ItemType Directory -Force -Path $lockDir | Out-Null
    $lock = [ordered]@{ session_id = $sessionId; module = $module; locked_at = (Get-Date).ToString('s'); computer = $env:COMPUTERNAME }
    ($lock | ConvertTo-Json) | Set-Content -LiteralPath $lockPath -Encoding UTF8
  }
  exit 0
}

# 2) Edit berkas.
if ($tool -notin @('Edit', 'Write', 'MultiEdit', 'NotebookEdit')) { exit 0 }
$target = [string]$hook.tool_input.file_path
if (-not $target) { $target = [string]$hook.tool_input.notebook_path }
if (-not $target) { exit 0 }
try { $full = [System.IO.Path]::GetFullPath($target) } catch { exit 0 }
if (-not $full.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) { exit 0 }
$relative = $full.Substring($root.Length + 1).Replace('\', '/')
if ($relative -like '.claude/cap-locks/*') { Deny 'Berkas kunci sesi hanya boleh diubah oleh penjaga otomatis.' }

$lock = Get-Lock
if (-not $lock) {
  Deny "Sesi ini belum memilih modul. Tampilkan daftar modul berikut kepada pengguna, minta pengguna memilih SATU, lalu jalankan: & .\scripts\claude\cap-lock.ps1 -Module <id>`n$moduleList"
}

$owner = $null
foreach ($module in $registry.modules) {
  if ($module.id -eq 'inti') { continue }
  foreach ($pattern in $module.files) { if ($relative -like $pattern) { $owner = $module.id; break } }
  if ($owner) { break }
}
if (-not $owner) {
  $shared = @($registry.shared_temporary.files) | Where-Object { $relative -like $_ }
  if ($shared) { exit 0 }
  $owner = 'inti'
}
if ($owner -ne $lock.module) {
  Deny "Berkas '$relative' milik modul '$owner', sedangkan sesi ini terkunci ke modul '$($lock.module)'. Kerjakan perubahan itu di sesi baru yang dikunci ke modul '$owner'."
}
exit 0

param(
  [string]$InstallPath = (Join-Path $env:LOCALAPPDATA 'CAP Analytics'),
  [switch]$CopyDatabase,
  [switch]$StartAfterInstall,
  [switch]$ForceUpdate
)

$ErrorActionPreference = 'Stop'
$SourcePath = Split-Path -Parent $MyInvocation.MyCommand.Path

function Test-NodeVersion {
  $bundledNode = Join-Path $SourcePath 'runtime\node\bin\node.exe'
  $nodePath = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source) }
  if (-not $nodePath) {
    throw "Node.js belum terpasang. Instal Node.js LTS versi 22 atau lebih baru dari https://nodejs.org/, lalu jalankan instalasi ini kembali."
  }
  $version = (& $nodePath --version).Trim().TrimStart('v').Split('.')[0]
  if ([int]$version -lt 22) {
    throw "Node.js versi $version terdeteksi. CAP Analytics membutuhkan Node.js versi 22 atau lebih baru."
  }
}

function Get-CapPythonLauncher {
  $bundledPython = Join-Path $SourcePath 'runtime\python\python.exe'
  if (Test-Path -LiteralPath $bundledPython) {
    try {
      & $bundledPython -c "import openpyxl, xlrd" 2>$null
      if ($LASTEXITCODE -eq 0) { return @{ Command = $bundledPython; Arguments = @() } }
    } catch {}
  }
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    try {
      & $py.Source -3 -c "import openpyxl, xlrd" 2>$null
      if ($LASTEXITCODE -eq 0) { return @{ Command = $py.Source; Arguments = @('-3') } }
    } catch {}
  }
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    try {
      & $python.Source -c "import openpyxl, xlrd" 2>$null
      if ($LASTEXITCODE -eq 0) { return @{ Command = $python.Source; Arguments = @() } }
    } catch {}
  }
  return $null
}

function Ensure-PythonExcel {
  $existing = Get-CapPythonLauncher
  if ($existing) { return }
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw 'Python belum tersedia dan winget tidak ditemukan. Instal Python 3.12 dari https://www.python.org/downloads/ lalu jalankan installer CAP kembali.'
  }
  Write-Host 'Memasang Python 3.12 untuk fitur impor dan ekspor Excel...' -ForegroundColor Yellow
  & $winget.Source install --id Python.Python.3.12 --exact --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw 'Pemasangan Python tidak berhasil. Jalankan installer kembali sebagai Administrator.' }
  $py = Get-Command py -ErrorAction SilentlyContinue
  if (-not $py) { throw 'Python sudah dipasang tetapi belum dapat ditemukan. Tutup PowerShell, buka kembali, lalu jalankan installer CAP sekali lagi.' }
  Write-Host 'Menyiapkan pembaca Excel...' -ForegroundColor Yellow
  & $py.Source -3 -m pip install --disable-pip-version-check --user openpyxl xlrd
  if ($LASTEXITCODE -ne 0) { throw 'Pustaka Excel openpyxl/xlrd tidak dapat dipasang.' }
  if (-not (Get-CapPythonLauncher)) { throw 'Python atau pustaka Excel belum siap. Jalankan installer CAP sekali lagi.' }
}

Test-NodeVersion
Ensure-PythonExcel

if (Test-Path -LiteralPath $InstallPath) {
  if (-not $ForceUpdate) {
    $answer = Read-Host "Folder '$InstallPath' sudah ada. Perbarui file aplikasi di folder ini? (Y/N)"
    if ($answer -notmatch '^[Yy]') { Write-Host 'Instalasi dibatalkan.'; exit 0 }
  }
} else {
  New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
}

foreach ($file in @('app.mjs', 'start-dev.ps1', 'Start-CAP-Analytics.cmd', 'Start-CAP-Analytics.ps1', 'Restart-CAP-Analytics.cmd', 'Restart-CAP-Server-Admin.ps1', 'CAP Analytics.exe', 'Restart CAP Analytics.exe', 'CAP-Recovery.cmd', 'CAP-Recovery.ps1', 'CAP-Server-Autostart.ps1', 'Run-CAP-Server.ps1', 'Aktifkan-Akses-LAN.ps1', 'Aktifkan-AutoStart.ps1', 'Aktifkan-AutoStart-Pengguna.ps1', 'PANDUAN_INSTALASI.md', 'MODULE_PACKAGE_SPEC.md')) {
  Copy-Item -LiteralPath (Join-Path $SourcePath $file) -Destination $InstallPath -Force
}
foreach ($folder in @('public', 'scripts', 'runtime')) {
  $origin = Join-Path $SourcePath $folder
  if (Test-Path -LiteralPath $origin) {
    Copy-Item -LiteralPath $origin -Destination $InstallPath -Recurse -Force
  }
}

$targetData = Join-Path $InstallPath 'data'
New-Item -ItemType Directory -Path $targetData -Force | Out-Null
if ($CopyDatabase) {
  $database = Join-Path $SourcePath 'data\app.db'
  if (Test-Path -LiteralPath $database) {
    Copy-Item -LiteralPath $database -Destination $targetData -Force
    Write-Host 'Database lama ikut dipindahkan.' -ForegroundColor Yellow
  }
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'CAP Analytics.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $InstallPath 'CAP Analytics.exe'
$shortcut.Arguments = ''
$shortcut.WorkingDirectory = $InstallPath
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,220"
$shortcut.Save()

$restartShortcutPath = Join-Path $desktop 'Restart CAP Analytics.lnk'
$restartShortcut = $shell.CreateShortcut($restartShortcutPath)
$restartShortcut.TargetPath = Join-Path $InstallPath 'Restart CAP Analytics.exe'
$restartShortcut.Arguments = ''
$restartShortcut.WorkingDirectory = $InstallPath
$restartShortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,238"
$restartShortcut.Save()

$recoveryShortcutPath = Join-Path $desktop 'CAP Recovery.lnk'
$recoveryShortcut = $shell.CreateShortcut($recoveryShortcutPath)
$recoveryShortcut.TargetPath = $env:ComSpec
$recoveryShortcut.Arguments = '/c "' + (Join-Path $InstallPath 'CAP-Recovery.cmd') + '"'
$recoveryShortcut.WorkingDirectory = $InstallPath
$recoveryShortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,238"
$recoveryShortcut.Save()

Write-Host ''
Write-Host 'CAP Analytics berhasil dipasang.' -ForegroundColor Green
Write-Host "Folder aplikasi: $InstallPath"
Write-Host "Shortcut desktop: $shortcutPath"
Write-Host "Shortcut mulai ulang: $restartShortcutPath"
Write-Host "Shortcut pemulihan: $recoveryShortcutPath"
Write-Host 'Data absensi baru akan tersimpan pada komputer ini.'

if ($StartAfterInstall) {
  Start-Process -FilePath (Join-Path $InstallPath 'CAP Analytics.exe') -WorkingDirectory $InstallPath
}

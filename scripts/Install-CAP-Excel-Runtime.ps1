param(
  [string]$InstallPath = (Join-Path $env:LOCALAPPDATA 'CAP Analytics')
)

$ErrorActionPreference = 'Stop'

function Get-CapPython {
  # Utamakan Python untuk seluruh komputer: CAP dapat berjalan sebagai akun
  # layanan yang berbeda dari Administrator yang menjalankan perbaikan ini.
  foreach ($path in @(
    'C:\Program Files\Python312\python.exe',
    'C:\Program Files\Python313\python.exe',
    'C:\Program Files\Python311\python.exe',
    (Join-Path $InstallPath 'runtime\python\python.exe')
  )) {
    if (Test-Path -LiteralPath $path) { return @{ Command = $path; Arguments = @() } }
  }
  return $null
}

function Test-ExcelRuntime($runtime) {
  if (-not $runtime) { return $false }
  & $runtime.Command @($runtime.Arguments) -c 'import openpyxl, xlrd' 2>$null
  return $LASTEXITCODE -eq 0
}

Write-Host 'Memeriksa runtime Excel CAP...' -ForegroundColor Cyan
$runtime = Get-CapPython
if (-not $runtime) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw 'Python belum tersedia dan winget tidak ditemukan. Instal Python 3.12 dari https://www.python.org/downloads/windows/ lalu jalankan skrip ini kembali.'
  }
  Write-Host 'Memasang Python 3.12...' -ForegroundColor Yellow
  & $winget.Source install --id Python.Python.3.12 --exact --scope machine --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw 'Pemasangan Python tidak berhasil.' }
  $runtime = Get-CapPython
  if (-not $runtime) { throw 'Python sudah dipasang tetapi belum ditemukan. Tutup PowerShell, buka kembali sebagai Administrator, lalu jalankan skrip ini sekali lagi.' }
}

if (-not (Test-ExcelRuntime $runtime)) {
  Write-Host 'Memasang pembaca Excel openpyxl dan xlrd...' -ForegroundColor Yellow
  & $runtime.Command @($runtime.Arguments) -m pip install --disable-pip-version-check --upgrade openpyxl xlrd
  if ($LASTEXITCODE -ne 0) { throw 'Pemasangan openpyxl/xlrd tidak berhasil.' }
}

if (-not (Test-ExcelRuntime $runtime)) { throw 'Runtime Excel belum siap setelah pemasangan.' }
Write-Host 'Selesai. Python, openpyxl, dan xlrd siap untuk impor Excel CAP.' -ForegroundColor Green
Write-Host 'Tidak ada file Core, modul, atau database CAP yang diubah.' -ForegroundColor Green

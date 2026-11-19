$ErrorActionPreference = 'Stop'
$sourcePath = Split-Path -Parent $MyInvocation.MyCommand.Path
$payload = Join-Path $sourcePath 'cap-analytics-payload.zip'
if (-not (Test-Path -LiteralPath $payload)) { throw 'Berkas paket CAP tidak ditemukan.' }

$work = Join-Path $env:TEMP ('cap-analytics-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
  Expand-Archive -LiteralPath $payload -DestinationPath $work -Force
  $installer = Join-Path $work 'Install-CAP-Analytics.ps1'
  if (-not (Test-Path -LiteralPath $installer)) { throw 'Installer CAP tidak lengkap.' }
  & $installer -StartAfterInstall -ForceUpdate
  if ($LASTEXITCODE -ne 0) { throw 'Instalasi CAP tidak selesai.' }

  $firewall = Join-Path $env:LOCALAPPDATA 'CAP Analytics\Aktifkan-Akses-LAN.ps1'
  if (Test-Path -LiteralPath $firewall) {
    $answer = Read-Host 'Aktifkan akses LAN CAP pada port 3100? (Y/N, rekomendasi Y)'
    if ($answer -match '^[Yy]') {
      Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$firewall,'-Port','3100'
    }
  }
  Write-Host 'Instalasi selesai. CAP berjalan di http://localhost:3100' -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Read-Host 'Tekan Enter untuk menutup installer'

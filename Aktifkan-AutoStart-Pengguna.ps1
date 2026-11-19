# Tidak memerlukan Administrator. Server berjalan saat pengguna Windows ini masuk.
param([int]$Port = 3100)

$ErrorActionPreference = 'Stop'
$serverPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$runner = Join-Path $serverPath 'CAP-Server-Autostart.ps1'
if (-not (Test-Path -LiteralPath $runner)) {
  throw 'CAP-Server-Autostart.ps1 tidak ditemukan.'
}

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$command = "`"$powershell`" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -Port $Port"
$startupFolder = [Environment]::GetFolderPath('Startup')
$launcher = Join-Path $startupFolder 'CAP-Analytics-Server.cmd'
$logPath = Join-Path $serverPath 'startup.log'

# Startup folder lebih andal daripada Registry Run pada komputer yang membatasi
# Registry atau Task Scheduler. Beri Windows waktu untuk menyiapkan jaringan
# sebelum server Node dijalankan.
$launcherCommand = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Port {1} >> "{2}" 2>&1' -f $runner, $Port, $logPath
$launcherLines = @(
  '@echo off',
  'setlocal',
  'timeout /t 12 /nobreak >nul',
  $launcherCommand
)
Set-Content -LiteralPath $launcher -Value $launcherLines -Encoding Ascii
# Gunakan satu pemicu saja. Dua pemicu yang berjalan bersamaan dapat membuat
# dua proses Node mencoba membuka port 3100 pada detik yang sama.
Remove-ItemProperty -Path $runKey -Name 'CAP Analytics LAN Server' -ErrorAction SilentlyContinue

$taskName = 'CAP Analytics Server'
$taskAction = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`" -Port $Port"
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn
$taskTrigger.Delay = 'PT15S'
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
try {
  Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Force -ErrorAction Stop | Out-Null
  Write-Host 'Task Scheduler CAP Analytics aktif sebagai cadangan autostart.' -ForegroundColor Green
} catch {
  Write-Warning "Task Scheduler tidak dapat didaftarkan: $($_.Exception.Message)"
}

Write-Host 'Auto-start CAP Analytics aktif untuk pengguna Windows ini melalui Windows Startup.' -ForegroundColor Green
Write-Host "Peluncur Startup: $launcher" -ForegroundColor DarkGray
Write-Host 'Server akan berjalan otomatis setelah pengguna masuk ke Windows, tanpa bergantung pada browser.' -ForegroundColor Green

# Jalankan sebagai Administrator pada komputer server CAP Analytics.
param(
  [int]$Port = 3100,
  [switch]$RunNow,
  [switch]$UserLogonOnly
)

$ErrorActionPreference = 'Stop'
$serverPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$runner = Join-Path $serverPath 'Run-CAP-Server.ps1'
if (-not (Test-Path -LiteralPath $runner)) {
  throw 'Run-CAP-Server.ps1 tidak ditemukan.'
}

$taskName = 'CAP Analytics LAN Server'
$bundledNode = Join-Path $serverPath 'runtime\node\bin\node.exe'
$cacheNode = Get-ChildItem -LiteralPath 'C:\Users' -Filter node.exe -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\.cache\\codex-runtimes\\' } |
  Select-Object -First 1
$availableNode = @($bundledNode, 'C:\Program Files\nodejs\node.exe', 'C:\Program Files (x86)\nodejs\node.exe', $cacheNode.FullName) |
  Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
  Select-Object -First 1
if ($UserLogonOnly) {
  & (Join-Path $serverPath 'Aktifkan-AutoStart-Pengguna.ps1') -Port $Port
  Write-Host 'Mode startup pengguna dipakai. Server akan otomatis menyala setiap Anda masuk ke Windows.' -ForegroundColor Yellow
  if ($RunNow) { Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList '-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',(Join-Path $serverPath 'CAP-Server-Autostart.ps1'),'-Port',$Port -WorkingDirectory $serverPath -WindowStyle Hidden }
  exit 0
}
if (-not $availableNode) { throw 'Runtime Node tidak ditemukan. Instal Node.js atau gunakan paket CAP yang menyertakan runtime.' }

$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Port $Port"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Menjalankan CAP Analytics untuk akses LAN saat Windows menyala.' -Force | Out-Null

Write-Host "Auto-start CAP Analytics aktif. Tugas '$taskName' akan berjalan saat Windows menyala." -ForegroundColor Green
if ($RunNow) {
  Start-ScheduledTask -TaskName $taskName
  Write-Host 'Tugas dijalankan sekarang.' -ForegroundColor Green
}

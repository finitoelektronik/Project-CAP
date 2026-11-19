# Jalankan sebagai Administrator hanya pada komputer yang menjadi server CAP Analytics.
param([int]$Port = 3100)

$ErrorActionPreference = 'Stop'
$ruleName = 'CAP Analytics LAN (Private)'
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  Set-NetFirewallRule -DisplayName $ruleName -Enabled True -Profile Private -Action Allow | Out-Null
} else {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private | Out-Null
}

Write-Host "Akses LAN untuk CAP Analytics pada port $Port telah diaktifkan untuk jaringan Privat." -ForegroundColor Green
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Select-Object IPAddress, InterfaceAlias

@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Restart-CAP-Server-Admin.ps1" -Port 3100

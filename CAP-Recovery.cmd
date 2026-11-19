@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js belum ditemukan.
  echo Instal Node.js LTS, lalu jalankan CAP Recovery kembali.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CAP-Recovery.ps1"


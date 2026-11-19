@echo off
setlocal
set "CAP_LOG=%USERPROFILE%\Desktop\CAP-Install.log"

echo [%date% %time%] Memulai installer CAP Analytics > "%CAP_LOG%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer-bootstrap.ps1" >> "%CAP_LOG%" 2>&1
set "CAP_RESULT=%ERRORLEVEL%"

if not "%CAP_RESULT%"=="0" (
  echo.>> "%CAP_LOG%"
  echo Installer berhenti dengan kode %CAP_RESULT%.>> "%CAP_LOG%"
  start "CAP Installer Log" notepad.exe "%CAP_LOG%"
  exit /b %CAP_RESULT%
)

exit /b 0

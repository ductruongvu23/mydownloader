@echo off
setlocal
cd /d "%~dp0"

echo ==========================================================
echo   CAI DAT MOI TRUONG WINDOWS LTSC CHO MYDOWNLOADER
echo ==========================================================

:: Kiem tra quyen Administrator
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] Dang chay voi quyen Administrator.
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-ltsc.ps1"
    pause
    exit /b
)

echo [*] Dang yeu cau quyen Administrator (UAC)...
powershell.exe -NoProfile -Command "Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File """"%~dp0setup-ltsc.ps1""""' -Verb RunAs"

@echo off
title Cai dat moi truong Windows LTSC cho MyDownloader
cd /d "%~dp0"

:: Kiem tra neu da co quyen Administrator
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] Dang chay voi quyen Administrator...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-ltsc.ps1"
) else (
    echo [*] Dang yeu cau quyen Administrator (UAC)...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"\"%~dp0setup-ltsc.ps1\"\"'"
)
pause

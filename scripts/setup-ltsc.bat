@echo off
setlocal EnableDelayedExpansion
title Cai dat moi truong Windows LTSC cho MyDownloader
chcp 65001 >nul

:: Kiem tra quyen Administrator & Tu dong xin UAC neu chua co
fltmc >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Dang yeu cau quyen Administrator (UAC)...
    powershell -NoProfile -Command "Start-Process cmd.exe -ArgumentList '/k `\"%~f0`\"' -Verb RunAs"
    exit /b
)

echo ==========================================================
echo   BẮT ĐẦU CÀI ĐẶT MÔI TRƯỜNG CHO WINDOWS LTSC
echo ==========================================================

:: ------------------------------------------------------------
:: 1. Thiet lap bien moi truong $HOME
:: ------------------------------------------------------------
echo.
echo [1/3] Đang thiết lập biến môi trường HOME...
powershell -NoProfile -Command "[System.Environment]::SetEnvironmentVariable('HOME', $env:USERPROFILE, 'User'); [System.Environment]::SetEnvironmentVariable('HOME', $env:USERPROFILE, 'Process'); Write-Host '  -> [OK] HOME = ' $env:USERPROFILE -ForegroundColor Green"

:: ------------------------------------------------------------
:: 2. Cai dat Visual C++ Redistributable All-in-One
:: ------------------------------------------------------------
echo.
echo [2/3] Đang cài đặt Visual C++ Redistributable All-in-One...
if exist "%TEMP%\vcredist_aio\Installer.cmd" (
    echo   -> Tìm thấy bộ cài All-in-One tại %TEMP%\vcredist_aio
    echo   -> Đang chạy cài đặt gói runtimes (có thể mất 1-2 phút)...
    cd /d "%TEMP%\vcredist_aio"
    call "%TEMP%\vcredist_aio\Installer.cmd" /quiet
    echo   -> [OK] Đã hoàn tất cài đặt Visual C++ All-in-One!
) else if exist "%TEMP%\vc_redist.x64.exe" (
    echo   -> Đang cài đặt vc_redist.x64.exe...
    "%TEMP%\vc_redist.x64.exe" /install /quiet /norestart
    echo   -> [OK] Đã hoàn tất cài đặt Visual C++ x64!
) else (
    echo   -> Đang tải và cài đặt vc_redist.x64.exe từ Microsoft...
    curl.exe -L -o "%TEMP%\vc_redist.x64.exe" "https://aka.ms/vs/17/release/vc_redist.x64.exe"
    "%TEMP%\vc_redist.x64.exe" /install /quiet /norestart
    echo   -> [OK] Đã hoàn tất cài đặt Visual C++ x64!
)

:: ------------------------------------------------------------
:: 3. Cai dat Media Feature Pack
:: ------------------------------------------------------------
echo.
echo [3/3] Đang kiểm tra và cài đặt Media Feature Pack (DISM)...
powershell -NoProfile -Command ^
  "$mfp = Get-WindowsCapability -Online -Name 'Media.MediaFeaturePack*';" ^
  "if ($mfp) {" ^
  "    Write-Host '  -> Tìm thấy gói: ' $mfp.Name ' (' $mfp.State ')' -ForegroundColor Cyan;" ^
  "    if ($mfp.State -eq 'Installed') {" ^
  "        Write-Host '  -> [OK] Media Feature Pack đã được cài đặt sẵn trên máy!' -ForegroundColor Green;" ^
  "    } else {" ^
  "        Write-Host '  -> Đang tải và cài đặt từ Windows Update...' -ForegroundColor Yellow;" ^
  "        $r = Add-WindowsCapability -Online -Name $mfp.Name;" ^
  "        Write-Host '  -> [OK] Đã cài đặt xong! RestartNeeded=' $r.RestartNeeded -ForegroundColor Green;" ^
  "    }" ^
  "} else {" ^
  "    Write-Host '  -> [!] Bản Windows này không cần gói bổ sung MediaFeaturePack (đã tích hợp sẵn codec).' -ForegroundColor Yellow;" ^
  "}"

echo.
echo ==========================================================
echo   HOÀN TẤT THIẾT LẬP MÔI TRƯỜNG WINDOWS LTSC!
echo ==========================================================
echo Bạn có thể đóng cửa sổ này hoặc nhấn phím bất kỳ...
pause >nul

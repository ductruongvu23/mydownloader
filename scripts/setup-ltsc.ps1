# scripts/setup-ltsc.ps1
# Tự động cài đặt 3 thành phần cần thiết cho Windows LTSC (Playwright, Chromium, Video/Audio)

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[*] Đang yêu cầu quyền Quản trị viên (Administrator / UAC)..." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  BẮT ĐẦU CÀI ĐẶT MÔI TRƯỜNG CHO WINDOWS LTSC (IDMCLONE)   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# ------------------------------------------------------------
# 1. Thiết lập biến môi trường $HOME
# ------------------------------------------------------------
Write-Host "`n[1/3] Đang thiết lập biến môi trường `$HOME..." -ForegroundColor Green
try {
    $userProfile = $env:USERPROFILE
    [System.Environment]::SetEnvironmentVariable('HOME', $userProfile, 'User')
    [System.Environment]::SetEnvironmentVariable('HOME', $userProfile, 'Process')
    Write-Host "  -> [OK] Đã gán `$HOME = $userProfile thành công!" -ForegroundColor Green
} catch {
    Write-Host "  -> [!] Lỗi gán `$HOME: $_" -ForegroundColor Red
}

# ------------------------------------------------------------
# 2. Cài đặt Visual C++ Redistributable (All-in-One)
# ------------------------------------------------------------
Write-Host "`n[2/3] Đang cài đặt Visual C++ Redistributable Runtimes (2015-2022 / All-in-One)..." -ForegroundColor Green

$aioCmd = "$env:TEMP\vcredist_aio\Installer.cmd"
if (Test-Path $aioCmd) {
    Write-Host "  -> Tìm thấy bộ cài All-in-One tại $aioCmd. Đang cài đặt chạy ngầm..." -ForegroundColor Cyan
    $p = Start-Process cmd.exe -ArgumentList "/c `"$aioCmd`" /quiet" -Wait -PassThru
    Write-Host "  -> [OK] Hoàn tất cài đặt Visual C++ All-in-One (Mã thoát: $($p.ExitCode))!" -ForegroundColor Green
} else {
    $vcX64 = "$env:TEMP\vc_redist.x64.exe"
    if (-not (Test-Path $vcX64)) {
        Write-Host "  -> Đang tải vc_redist.x64.exe từ Microsoft..." -ForegroundColor Cyan
        curl.exe -L -o $vcX64 "https://aka.ms/vs/17/release/vc_redist.x64.exe"
    }
    Write-Host "  -> Đang chạy cài đặt vc_redist.x64.exe..." -ForegroundColor Cyan
    $p = Start-Process $vcX64 -ArgumentList "/install /quiet /norestart" -Wait -PassThru
    Write-Host "  -> [OK] Hoàn tất cài đặt Visual C++ x64 (Mã thoát: $($p.ExitCode))!" -ForegroundColor Green
}

# ------------------------------------------------------------
# 3. Cài đặt Media Feature Pack cho Windows LTSC
# ------------------------------------------------------------
Write-Host "`n[3/3] Đang cài đặt Media Feature Pack (Codec Video/Audio cho Windows LTSC)..." -ForegroundColor Green
try {
    $mfp = Get-WindowsCapability -Online -Name "Media.MediaFeaturePack*"
    if ($mfp) {
        Write-Host "  -> Tìm thấy gói: $($mfp.Name) (Trạng thái hiện tại: $($mfp.State))" -ForegroundColor Cyan
        if ($mfp.State -eq 'Installed') {
            Write-Host "  -> [OK] Media Feature Pack đã được cài đặt từ trước!" -ForegroundColor Green
        } else {
            Write-Host "  -> Đang tải và kích hoạt gói Media Feature Pack từ Windows Update..." -ForegroundColor Yellow
            $result = Add-WindowsCapability -Online -Name $mfp.Name
            Write-Host "  -> [OK] Cài đặt thành công! (Cần khởi động lại máy: $($result.RestartNeeded))" -ForegroundColor Green
        }
    } else {
        Write-Host "  -> [!] Không tìm thấy gói Media.MediaFeaturePack qua DISM Online." -ForegroundColor Yellow
        Write-Host "      (Lưu ý: Một số phiên bản Windows không thuộc dòng N/KN đã tích hợp sẵn Media subsystem)." -ForegroundColor Gray
    }
} catch {
    Write-Host "  -> [!] Lỗi khi cài Media Feature Pack: $_" -ForegroundColor Red
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  HOÀN TẤT THIẾT LẬP MÔI TRƯỜNG CHO WINDOWS LTSC!          " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Nhấn phím bất kỳ để đóng cửa sổ này..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

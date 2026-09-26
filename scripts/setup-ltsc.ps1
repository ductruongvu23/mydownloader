# scripts/setup-ltsc.ps1
# Cai dat 3 thanh phan can thiet cho Windows LTSC:
# 1. Bien moi truong $HOME
# 2. Visual C++ Redistributable All-in-One
# 3. Media Feature Pack (Codec Video/Audio)

# Tu dong yeu cau quyen Administrator neu chua co
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[*] Dang yeu cau quyen Administrator (UAC)..." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$PSCommandPath`""
    exit
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  CAI DAT MOI TRUONG WINDOWS LTSC CHO MYDOWNLOADER        " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# ------------------------------------------------------------
# 1. Thiet lap bien moi truong $HOME
# ------------------------------------------------------------
Write-Host "`n[1/3] Dang thiet lap bien moi truong HOME..." -ForegroundColor Green
try {
    $userProfile = $env:USERPROFILE
    [System.Environment]::SetEnvironmentVariable('HOME', $userProfile, 'User')
    [System.Environment]::SetEnvironmentVariable('HOME', $userProfile, 'Process')
    Write-Host "  -> [OK] HOME = $userProfile" -ForegroundColor Green
} catch {
    Write-Host "  -> [!] Loi khi thiet lap HOME: $_" -ForegroundColor Red
}

# ------------------------------------------------------------
# 2. Cai dat Visual C++ Redistributable All-in-One
# ------------------------------------------------------------
Write-Host "`n[2/3] Dang cai dat Visual C++ Redistributable (All-in-One)..." -ForegroundColor Green

$aioCmd = "$env:TEMP\vcredist_aio\Installer.cmd"
if (Test-Path $aioCmd) {
    Write-Host "  -> Tim thay bo cai All-in-One tai: $aioCmd" -ForegroundColor Cyan
    Write-Host "  -> Dang tien hanh cai dat (co the mat 1-2 phut, vui long cho)..." -ForegroundColor Yellow
    $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$aioCmd`" /auto" -Wait -PassThru -NoNewWindow
    Write-Host "  -> [OK] Hoan tat cai dat Visual C++ All-in-One! (ExitCode: $($p.ExitCode))" -ForegroundColor Green
} else {
    $vcX64 = "$env:TEMP\vc_redist.x64.exe"
    if (-not (Test-Path $vcX64)) {
        Write-Host "  -> Dang tai vc_redist.x64.exe tu Microsoft..." -ForegroundColor Cyan
        curl.exe -L -o $vcX64 "https://aka.ms/vs/17/release/vc_redist.x64.exe"
    }
    Write-Host "  -> Dang cai dat vc_redist.x64.exe..." -ForegroundColor Cyan
    $p = Start-Process $vcX64 -ArgumentList "/install /quiet /norestart" -Wait -PassThru
    Write-Host "  -> [OK] Hoan tat cai dat Visual C++ x64! (ExitCode: $($p.ExitCode))" -ForegroundColor Green
}

# ------------------------------------------------------------
# 3. Cai dat Media Feature Pack
# ------------------------------------------------------------
Write-Host "`n[3/3] Dang kiem tra va cai dat Media Feature Pack (Codec Video/Audio)..." -ForegroundColor Green
try {
    $mfp = Get-WindowsCapability -Online -Name "Media.MediaFeaturePack*"
    if ($mfp) {
        Write-Host "  -> Tim thay goi: $($mfp.Name) (Trang thai: $($mfp.State))" -ForegroundColor Cyan
        if ($mfp.State -eq 'Installed') {
            Write-Host "  -> [OK] Media Feature Pack da duoc cai dat san tren may!" -ForegroundColor Green
        } else {
            Write-Host "  -> Dang tai va kich hoat goi Media Feature Pack tu Windows Update..." -ForegroundColor Yellow
            $result = Add-WindowsCapability -Online -Name $mfp.Name
            Write-Host "  -> [OK] Cai dat Media Feature Pack thanh cong!" -ForegroundColor Green
            if ($result.RestartNeeded) {
                Write-Host "  -> [CHU Y] He thong can duoc khoi dong lai (Restart) de ap dung codec!" -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "  -> [!] Khong tim thay Media.MediaFeaturePack qua DISM." -ForegroundColor Yellow
        Write-Host "      (Co the ban Windows LTSC nay da tich hop san codec hoac khong can goi bo sung)." -ForegroundColor Gray
    }
} catch {
    Write-Host "  -> [!] Loi: $_" -ForegroundColor Red
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  HOAN TAT TOAN BO QUA TRINH THIET LAP!" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Nhan Enter de thoat cua so..."
$null = Read-Host

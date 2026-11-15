# rust/package.ps1
# Dong goi ban phat hanh: build release, gom MyDownloader.exe + mydownloader-host.exe + extension\
# vao rust\dist\MyDownloader roi nen thanh rust\dist\MyDownloader-<version>-win-x64.zip.
#   powershell -ExecutionPolicy Bypass -File rust\package.ps1            # chi dong goi
#   powershell -ExecutionPolicy Bypass -File rust\package.ps1 -Release   # dong goi + day len GitHub Releases (gh da dang nhap)
# Phien ban lay tu Cargo.toml. (File de khong dau: PowerShell 5.1 doc .ps1 khong BOM theo ANSI.)
param([switch]$Release)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$version = (Select-String -Path "$PSScriptRoot\Cargo.toml" -Pattern '^version\s*=\s*"(.+)"' | Select-Object -First 1).Matches[0].Groups[1].Value

# Version extension di theo Cargo.toml
$manifest = "$root\extension\manifest.json"
$text = [IO.File]::ReadAllText($manifest)
$synced = $text -replace '("version"\s*:\s*")[^"]*', "`${1}$version"
if ($synced -ne $text) { [IO.File]::WriteAllText($manifest, $synced); Write-Host "Da doi version extension thanh $version" }

# rust-toolchain.toml va .cargo\config.toml (toolchain GNU + gcc MSYS2) chi co hieu luc khi cargo chay trong rust\
Push-Location $PSScriptRoot
try { cargo build --release } finally { Pop-Location }
if ($LASTEXITCODE) { throw 'cargo build loi (neu bao Permission denied: thoat MyDownloader dang chay tu target\release roi chay lai)' }

$target = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { 'target' }
$bin = [IO.Path]::Combine($PSScriptRoot, $target, 'release')
$dist = "$PSScriptRoot\dist"
$stage = "$dist\MyDownloader"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory $stage | Out-Null
Copy-Item "$bin\MyDownloader.exe", "$bin\mydownloader-host.exe" $stage
Copy-Item "$root\extension" $stage -Recurse   # native::extension_dir() tim extension\ canh exe
# Bo tu cap nhat 2.x (src/update.rs) tai asset MyDownloader-*win*.zip. Ten zip khong duoc bat dau bang
# MyDownloader-Update-/FastUpdate- va khong kem .exe roi: app Electron 1.x se tai nham ve lam goi cap nhat.
$zip = "$dist\MyDownloader-$version-win-x64.zip"
if (Test-Path $zip) { Remove-Item $zip }
& "$env:SystemRoot\System32\tar.exe" -a -c -f $zip -C $dist MyDownloader
if ($LASTEXITCODE) { throw 'Nen zip loi' }
$entries = & "$env:SystemRoot\System32\tar.exe" -t -f $zip
foreach ($e in 'MyDownloader/MyDownloader.exe', 'MyDownloader/mydownloader-host.exe', 'MyDownloader/extension/manifest.json') {
    if ($entries -notcontains $e) { throw "Zip thieu $e" }
}
Write-Host "Da tao $zip"

if (-not $Release) { return }
# Bo tu cap nhat 2.x so tag_name cua releases/latest voi version dang chay, nen tag phai la v<version>
$tag = "v$version"
$repo = 'ductruongvu23/mydownloader'
# Tag duoc tao tren GitHub tai commit dang dung, nen thu dong goi phai trung voi commit da push
if (git -C $root status --porcelain -- rust extension resources) { throw 'Con thay doi chua commit trong rust\, extension\ hoac resources\: commit roi chay lai' }
if (-not (git -C $root branch -r --contains HEAD)) { throw 'Commit hien tai chua co tren GitHub: git push roi chay lai' }
cmd /c "gh release view $tag --repo $repo >nul 2>nul"
if ($LASTEXITCODE -eq 0) {
    # Release da co (vd lan truoc upload loi giua chung, gh de lai ban nhap): thay asset roi cong bo
    gh release upload $tag $zip --repo $repo --clobber
    if ($LASTEXITCODE -eq 0) { gh release edit $tag --repo $repo --draft=false }
} else {
    gh release create $tag $zip --repo $repo --target (git -C $root rev-parse HEAD) --title "MyDownloader $tag" --notes-file "$PSScriptRoot\release-notes.md" --generate-notes
}
if ($LASTEXITCODE) { throw 'gh release loi' }

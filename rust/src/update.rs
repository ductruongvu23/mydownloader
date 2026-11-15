// Tự cập nhật từ GitHub Releases. Gói phát hành: asset "MyDownloader-<version>-win64.zip",
// ở gốc zip có MyDownloader.exe, mydownloader-host.exe, extension/ (và có thể aria2c.exe).
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde_json::Value;

use crate::app::Core;
use crate::util;

const RELEASES_API: &str = "https://api.github.com/repos/ductruongvu23/mydownloader/releases/latest";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct Release {
    pub version: String,
    pub page: String,
    pub zip: Option<String>,
}

fn user_agent() -> String {
    format!("MyDownloader/{}", env!("CARGO_PKG_VERSION"))
}

pub fn newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| v.split('.').map(|x| x.trim().parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    parse(latest) > parse(current)
}

/// Bản mới hơn bản đang chạy, hoặc None nếu đã mới nhất / chưa có bản phát hành.
pub async fn latest() -> Result<Option<Release>, String> {
    // Biến môi trường chỉ để trỏ sang máy chủ thử khi kiểm tra bộ cập nhật
    let api = std::env::var("MYDOWNLOADER_RELEASES_API").unwrap_or_else(|_| RELEASES_API.into());
    let resp = reqwest::Client::new()
        .get(api)
        .header("User-Agent", user_agent())
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let v: Value = resp.error_for_status().map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let version = v["tag_name"].as_str().unwrap_or("").trim_start_matches(['v', 'V']).to_string();
    if version.is_empty() || !newer(&version, env!("CARGO_PKG_VERSION")) {
        return Ok(None);
    }
    let zip = v["assets"].as_array().and_then(|assets| {
        assets
            .iter()
            .find(|a| a["name"].as_str().is_some_and(is_app_package))
            .and_then(|a| a["browser_download_url"].as_str())
            .map(str::to_string)
    });
    Ok(Some(Release { version, page: v["html_url"].as_str().unwrap_or("").to_string(), zip }))
}

/// Gói app cho Windows: "MyDownloader-<ver>-win64.zip" hoặc "...-win-x64.zip" (không phải gói extension riêng).
fn is_app_package(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.starts_with("mydownloader-") && n.ends_with(".zip") && n.contains("win") && !n.contains("extension")
}

/// Thư mục chứa MyDownloader.exe trong gói: ở gốc zip hoặc trong một thư mục bọc ngoài.
fn package_root(extracted: &Path) -> Option<PathBuf> {
    if extracted.join("MyDownloader.exe").is_file() {
        return Some(extracted.to_path_buf());
    }
    std::fs::read_dir(extracted)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.join("MyDownloader.exe").is_file())
}

/// Tải gói, giải nén và thay file trong thư mục cài. `progress(đã tải, tổng)`.
pub async fn install(zip_url: &str, progress: impl Fn(u64, u64)) -> Result<(), String> {
    let work = std::env::temp_dir().join(format!("mydownloader-update-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let zip = work.join("update.zip");
    let mut resp = reqwest::Client::new()
        .get(zip_url)
        .header("User-Agent", user_agent())
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Không tải được gói cập nhật: {e}"))?;
    let total = resp.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(&zip).map_err(|e| e.to_string())?;
    let mut done = 0u64;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Tải gói cập nhật bị ngắt: {e}"))? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        done += chunk.len() as u64;
        progress(done, total);
    }
    drop(file);
    let files = work.join("files");
    std::fs::create_dir_all(&files).map_err(|e| e.to_string())?;
    extract(&zip, &files)?;
    let root = package_root(&files).ok_or("Gói cập nhật không có MyDownloader.exe")?;
    replace_files(&root, &util::exe_dir())?;
    let _ = std::fs::remove_dir_all(&work);
    Ok(())
}

/// Giải nén zip bằng tar.exe có sẵn trong Windows 10+ (gọi đường dẫn đầy đủ: tar của Git không đọc zip).
fn extract(zip: &Path, out: &Path) -> Result<(), String> {
    let tar = PathBuf::from(std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into())).join(r"System32\tar.exe");
    let status = Command::new(tar)
        .arg("-xf")
        .arg(zip)
        .arg("-C")
        .arg(out)
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| format!("Không chạy được tar để giải nén: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Giải nén gói cập nhật thất bại".into())
    }
}

fn old_path(p: &Path) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(".old");
    s.into()
}

/// Chép đè từng tệp. Exe đang chạy không xóa được nhưng đổi tên được, nên luôn đổi tệp cũ sang .old
/// rồi mới chép (không xóa thẳng: tệp đang bị phần mềm khác giữ có thể "xóa chờ" rồi mất hẳn);
/// chép lỗi thì trả tệp cũ về chỗ cũ. Các tệp .old được dọn ở lần chạy sau.
fn replace_files(src: &Path, dst: &Path) -> Result<(), String> {
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let (from, to) = (entry.path(), dst.join(entry.file_name()));
        if from.is_dir() {
            std::fs::create_dir_all(&to).map_err(|e| e.to_string())?;
            replace_files(&from, &to)?;
            continue;
        }
        let old = old_path(&to);
        let moved = to.exists() && {
            let _ = std::fs::remove_file(&old);
            std::fs::rename(&to, &old).map_err(|e| format!("Không thay được {}: {e}", to.display()))?;
            true
        };
        if let Err(e) = std::fs::copy(&from, &to) {
            if moved {
                let _ = std::fs::rename(&old, &to);
            }
            return Err(format!("Không chép được {}: {e}", to.display()));
        }
    }
    Ok(())
}

/// Lần chạy sau khi cập nhật: dọn các tệp .old còn lại.
pub fn cleanup_old() {
    fn walk(dir: &Path) {
        for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p);
            } else if p.extension().is_some_and(|x| x == "old") {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
    walk(&util::exe_dir());
}

/// Mở bản mới (chờ tiến trình này thoát hẳn rồi mới nhận kênh IPC) và thoát.
pub fn restart(core: &Core) -> ! {
    let exe = util::exe_dir().join("MyDownloader.exe");
    if let Err(e) = Command::new(&exe).arg(format!("--wait-pid={}", std::process::id())).spawn() {
        util::log(&format!("Không mở lại được sau khi cập nhật: {e}"));
    }
    core.quit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_compare() {
        assert!(newer("2.0.1", "2.0.0"));
        assert!(newer("2.10.0", "2.9.9"));
        assert!(!newer("2.0.0", "2.0.0"));
        assert!(!newer("1.9.9", "2.0.0"));
    }

    #[test]
    fn finds_package_asset_and_root() {
        assert!(is_app_package("MyDownloader-2.0.1-win64.zip"));
        assert!(is_app_package("MyDownloader-2.0.1-win-x64.zip"));
        assert!(!is_app_package("MyDownloader-Extension-2.0.1.zip"));
        assert!(!is_app_package("MyDownloader-Update-1.0.6.zip"));

        let root = std::env::temp_dir().join(format!("mydl-pkgroot-test-{}", std::process::id()));
        let nested = root.join("MyDownloader");
        std::fs::create_dir_all(&nested).unwrap();
        assert_eq!(package_root(&root), None);
        std::fs::write(nested.join("MyDownloader.exe"), "x").unwrap();
        assert_eq!(package_root(&root), Some(nested.clone()));
        std::fs::write(root.join("MyDownloader.exe"), "x").unwrap();
        assert_eq!(package_root(&root), Some(root.clone()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn extracts_zip_and_replaces_locked_files() {
        let root = std::env::temp_dir().join(format!("mydl-update-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (pkg, install, out) = (root.join("pkg"), root.join("install"), root.join("out"));
        for d in [&pkg.join("extension"), &install.join("extension"), &out] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(pkg.join("MyDownloader.exe"), "new exe").unwrap();
        std::fs::write(pkg.join("extension").join("manifest.json"), "new manifest").unwrap();
        std::fs::write(install.join("MyDownloader.exe"), "old exe").unwrap();
        std::fs::write(install.join("extension").join("manifest.json"), "old manifest").unwrap();
        std::fs::write(install.join("keep.txt"), "user file").unwrap();

        let zip = root.join("u.zip");
        let tar = PathBuf::from(std::env::var("SystemRoot").unwrap()).join(r"System32\tar.exe");
        let ok = Command::new(tar).current_dir(&pkg).args(["-a", "-cf"]).arg(&zip).args(["MyDownloader.exe", "extension"]).status().unwrap();
        assert!(ok.success());
        extract(&zip, &out).unwrap();

        // Exe cũ đang được giữ mở (như khi app đang chạy): vẫn phải thay được
        use std::os::windows::fs::OpenOptionsExt;
        let held = std::fs::OpenOptions::new().read(true).share_mode(0x1 | 0x4).open(install.join("MyDownloader.exe")).unwrap();
        replace_files(&out, &install).unwrap();
        assert_eq!(std::fs::read_to_string(install.join("MyDownloader.exe")).unwrap(), "new exe");
        assert_eq!(std::fs::read_to_string(install.join("MyDownloader.exe.old")).unwrap(), "old exe");
        assert_eq!(std::fs::read_to_string(install.join("extension").join("manifest.json")).unwrap(), "new manifest");
        assert_eq!(std::fs::read_to_string(install.join("keep.txt")).unwrap(), "user file");
        drop(held);
        let _ = std::fs::remove_dir_all(&root);
    }
}

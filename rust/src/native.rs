// Đăng ký native messaging host cho trình duyệt (HKCU, không cần quyền admin) và khởi động cùng Windows.
use serde_json::json;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

use crate::util;

pub const HOST_NAME: &str = "com.mydownloader.host";
/// ID cố định nhờ khóa "key" trong extension/manifest.json (không đổi theo thư mục cài).
pub const EXTENSION_ID: &str = "pialejfhnnjfpkmlgkogbhphaeomhafe";

/// (tên trình duyệt, khóa của hãng, khóa NativeMessagingHosts)
const BROWSERS: [(&str, &str, &str); 5] = [
    ("Chrome", r"Software\Google\Chrome", r"Software\Google\Chrome\NativeMessagingHosts"),
    ("Edge", r"Software\Microsoft\Edge", r"Software\Microsoft\Edge\NativeMessagingHosts"),
    ("Brave", r"Software\BraveSoftware\Brave-Browser", r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts"),
    ("Cốc Cốc", r"Software\CocCoc\Browser", r"Software\CocCoc\Browser\NativeMessagingHosts"),
    ("Chromium", r"Software\Chromium", r"Software\Chromium\NativeMessagingHosts"),
];

/// Ghi manifest của host và trỏ registry của từng trình duyệt có trên máy tới nó.
/// Trả về tên các trình duyệt đã đăng ký.
pub fn register_host() -> Result<Vec<&'static str>, String> {
    let host = util::exe_dir().join("mydownloader-host.exe");
    if !host.is_file() {
        return Err(format!("Thiếu {}", host.display()));
    }
    let manifest = util::data_dir().join("native-host.json");
    let body = json!({
        "name": HOST_NAME,
        "description": "MyDownloader native messaging host",
        "path": host,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{EXTENSION_ID}/")],
    });
    std::fs::write(&manifest, serde_json::to_vec_pretty(&body).unwrap_or_default())
        .map_err(|e| format!("Không ghi được {}: {e}", manifest.display()))?;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let manifest = manifest.to_string_lossy().into_owned();
    let mut ok = Vec::new();
    for (name, vendor, hosts) in BROWSERS {
        if hkcu.open_subkey(vendor).is_err() {
            continue;
        }
        match hkcu.create_subkey(format!(r"{hosts}\{HOST_NAME}")).and_then(|(k, _)| k.set_value("", &manifest)) {
            Ok(()) => ok.push(name),
            Err(e) => util::log(&format!("Không đăng ký được native host cho {name}: {e}")),
        }
    }
    Ok(ok)
}

/// Định danh app cho thông báo Windows (toast).
pub const AUMID: &str = "MyDownloader.App";

/// App không cài qua MSIX: đăng ký AUMID trong HKCU để thông báo hiện tên + icon MyDownloader
/// (không đăng ký thì phải mượn AUMID của PowerShell và thông báo ghi "Windows PowerShell").
pub fn register_notifications() {
    let icon = util::data_dir().join("icon.png");
    if !icon.is_file() {
        let _ = std::fs::write(&icon, include_bytes!("../../resources/icon.png"));
    }
    let r = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(format!(r"Software\Classes\AppUserModelId\{AUMID}"))
        .and_then(|(k, _)| {
            k.set_value("DisplayName", &"MyDownloader")?;
            k.set_value("IconUri", &icon.to_string_lossy().into_owned())
        });
    if let Err(e) = r {
        util::log(&format!("Không đăng ký được tên app cho thông báo: {e}"));
    }
}

pub fn set_autostart(on: bool) {
    let r = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
        .and_then(|(run, _)| {
            if on {
                let exe = std::env::current_exe()?;
                run.set_value("MyDownloader", &format!("\"{}\" --background", exe.display()))
            } else {
                match run.delete_value("MyDownloader") {
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    r => r,
                }
            }
        });
    if let Err(e) = r {
        util::log(&format!("Không cập nhật được khởi động cùng Windows: {e}"));
    }
}

/// Thư mục extension: cạnh exe khi phát hành, hoặc ở gốc repo khi chạy từ target/.
pub fn extension_dir() -> Option<std::path::PathBuf> {
    let exe = util::exe_dir();
    exe.ancestors().take(5).map(|d| d.join("extension")).find(|d| d.join("manifest.json").is_file())
}

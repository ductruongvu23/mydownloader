// Cài đặt người dùng. Khóa JSON giữ dạng camelCase như bản Electron để đọc lại được settings.json cũ.
use serde::{Deserialize, Serialize};

use crate::util;

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub download_dir: String,
    /// "vi" | "en"
    pub language: String,
    /// "dark" | "light" | "system"
    pub theme: String,
    pub max_concurrent: usize,
    pub threads: usize,
    /// byte/giây, 0 = không giới hạn
    pub speed_limit: u64,
    pub notify_on_complete: bool,
    pub open_at_login: bool,
    pub auto_download_from_extension: bool,
    pub close_to_tray: bool,
}

impl Default for Settings {
    fn default() -> Self {
        let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
        Self {
            download_dir: format!(r"{home}\Downloads"),
            language: "vi".into(),
            theme: "dark".into(),
            max_concurrent: 5,
            threads: 8,
            speed_limit: 0,
            notify_on_complete: true,
            open_at_login: false,
            auto_download_from_extension: false,
            close_to_tray: true,
        }
    }
}

impl Settings {
    pub fn load() -> Self {
        let path = util::data_dir().join("settings.json");
        let mut s: Settings = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        s.max_concurrent = s.max_concurrent.clamp(1, 20);
        s.threads = s.threads.clamp(1, 32);
        if s.download_dir.trim().is_empty() {
            s.download_dir = Settings::default().download_dir;
        }
        s
    }

    pub fn save(&self) {
        let path = util::data_dir().join("settings.json");
        let tmp = path.with_extension("json.tmp");
        let r = serde_json::to_vec_pretty(self)
            .map_err(std::io::Error::other)
            .and_then(|b| std::fs::write(&tmp, b))
            .and_then(|_| std::fs::rename(&tmp, &path));
        if let Err(e) = r {
            util::log(&format!("Lưu cài đặt thất bại: {e}"));
        }
    }

    pub fn en(&self) -> bool {
        self.language == "en"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_electron_settings_and_ignores_unknown_keys() {
        let old = r#"{"downloadDir":"D:\\Tai","language":"en","theme":"light","maxConcurrent":3,
            "threads":16,"speedLimit":1024,"notifyOnComplete":false,"bridgeEnabled":true,
            "bridgePort":6801,"extensionToken":"abc","openAtLogin":true,"autoDownloadFromExtension":true}"#;
        let s: Settings = serde_json::from_str(old).unwrap();
        assert_eq!(s.download_dir, r"D:\Tai");
        assert_eq!((s.max_concurrent, s.threads, s.speed_limit), (3, 16, 1024));
        assert!(s.open_at_login && s.auto_download_from_extension && !s.notify_on_complete);
        assert!(s.close_to_tray, "khóa mới thiếu thì lấy mặc định");
    }
}

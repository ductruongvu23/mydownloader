// Tiện ích dùng chung: đường dẫn dữ liệu, ghi log, gọi shell và điều khiển cửa sổ Win32.
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicIsize, Ordering};

use windows_sys::Win32::System::SystemInformation::GetLocalTime;
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    IsIconic, SetForegroundWindow, SetWindowPos, ShowWindow, HWND_NOTOPMOST,
    HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_RESTORE, SW_SHOW, SW_SHOWNORMAL,
};

/// Cùng thư mục dữ liệu với bản Electron cũ (%APPDATA%\mydownloader) để giữ cài đặt và danh sách tải.
pub fn data_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("mydownloader");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_default()
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn log(msg: &str) {
    // Khóa + ghi cả dòng một lần: nhiều luồng tải ghi log cùng lúc không bị trộn chữ
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let st = unsafe {
        let mut st = std::mem::zeroed();
        GetLocalTime(&mut st);
        st
    };
    let line = format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02} {msg}\n",
        st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond
    );
    let _guard = LOCK.lock();
    let path = data_dir().join("mydownloader.log");
    if std::fs::metadata(&path).map(|m| m.len() > 2_000_000).unwrap_or(false) {
        let _ = std::fs::rename(&path, path.with_extension("log.old"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(line.as_bytes());
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

/// Mở tệp/URL bằng chương trình mặc định của Windows.
pub fn open_path(target: &str) {
    let (op, file) = (wide("open"), wide(target));
    unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        );
    }
}

/// Mở Explorer và chọn sẵn tệp; nếu tệp chưa có thì mở thư mục chứa nó.
pub fn show_in_folder(path: &Path) {
    let r = if path.exists() {
        std::process::Command::new("explorer").raw_arg(format!("/select,\"{}\"", path.display())).spawn()
    } else {
        std::process::Command::new("explorer").arg(path.parent().unwrap_or(path)).spawn()
    };
    if let Err(e) = r {
        log(&format!("Không mở được Explorer: {e}"));
    }
}

/// Thông báo Windows (toast). Chạy trên luồng riêng vì WinRT có thể chậm lần đầu.
pub fn toast(title: &str, body: &str) {
    let (title, body) = (title.to_string(), body.to_string());
    std::thread::spawn(move || {
        use tauri_winrt_notification::Toast;
        if let Err(e) = Toast::new(crate::native::AUMID).title(&title).text1(&body).show() {
            log(&format!("Không hiện được thông báo: {e:?}"));
        }
    });
}

// HWND cửa sổ chính, để tray và IPC (chạy ngoài vòng lặp UI) hiện/ẩn được cửa sổ.
static MAIN_HWND: AtomicIsize = AtomicIsize::new(0);

pub fn set_main_hwnd(hwnd: isize) {
    MAIN_HWND.store(hwnd, Ordering::Relaxed);
}

fn hwnd() -> Option<*mut core::ffi::c_void> {
    match MAIN_HWND.load(Ordering::Relaxed) {
        0 => None,
        h => Some(h as *mut core::ffi::c_void),
    }
}

pub fn show_main_window() {
    let Some(h) = hwnd() else { return };
    unsafe {
        ShowWindow(h, if IsIconic(h) != 0 { SW_RESTORE } else { SW_SHOW });
        // Đưa lên trên cùng rồi bỏ "topmost": Windows chặn SetForegroundWindow từ tiến trình nền.
        SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
        SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
        SetForegroundWindow(h);
    }
}

pub fn hide_main_window() {
    if let Some(h) = hwnd() {
        unsafe { ShowWindow(h, SW_HIDE) };
    }
}

pub fn format_bytes(n: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = n as f64;
    let mut i = 0;
    while v >= 1024.0 && i < UNITS.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{n} B")
    } else {
        format!("{v:.1} {}", UNITS[i])
    }
}

pub fn format_eta(secs: u64) -> String {
    match secs {
        0..=59 => format!("{secs}s"),
        60..=3599 => format!("{}m {:02}s", secs / 60, secs % 60),
        _ => format!("{}h {:02}m", secs / 3600, secs % 3600 / 60),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats() {
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(1536), "1.5 KB");
        assert_eq!(format_bytes(5 * 1024 * 1024), "5.0 MB");
        assert_eq!(format_eta(42), "42s");
        assert_eq!(format_eta(125), "2m 05s");
        assert_eq!(format_eta(7260), "2h 01m");
    }
}

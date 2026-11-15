// MyDownloader: trình quản lý tải xuống đa luồng cho Windows (Rust + egui).
#![windows_subsystem = "windows"]

#[macro_export]
macro_rules! logln {
    ($($t:tt)*) => { $crate::util::log(&format!($($t)*)) };
}

mod app;
mod engine;
mod ipc;
mod native;
mod settings;
mod ui;
mod update;
mod util;

/// Bản vừa cập nhật chờ bản cũ thoát hẳn (nhả kênh IPC, nhả exe) rồi mới chạy tiếp.
fn wait_for_exit(pid: u32) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};
    const SYNCHRONIZE: u32 = 0x0010_0000;
    unsafe {
        let h = OpenProcess(SYNCHRONIZE, 0, pid);
        if !h.is_null() {
            WaitForSingleObject(h, 15_000);
            CloseHandle(h);
        }
    }
}

fn main() {
    std::panic::set_hook(Box::new(|info| util::log(&format!("PANIC: {info}"))));
    // --background: khởi động cùng Windows hoặc do extension gọi khi app đang tắt -> chỉ hiện ở khay
    let background = std::env::args().any(|a| a == "--background");
    if let Some(pid) = std::env::args().find_map(|a| a.strip_prefix("--wait-pid=").and_then(|p| p.parse().ok())) {
        wait_for_exit(pid);
    }
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()
        .expect("không tạo được tokio runtime");

    let pipe = {
        let _guard = rt.enter();
        ipc::claim()
    };
    let pipe = match pipe {
        Ok(p) => Some(p),
        Err(e) => {
            // Đã có MyDownloader đang chạy: nhờ nó hiện cửa sổ rồi thoát
            if !background && rt.block_on(ipc::send(serde_json::json!({"cmd": "show"}))).is_ok() {
                return;
            }
            if background && rt.block_on(ipc::send(serde_json::json!({"cmd": "ping"}))).is_ok() {
                return;
            }
            util::log(&format!("Không mở được kênh IPC, extension sẽ không gửi link được: {e}"));
            None
        }
    };

    update::cleanup_old();
    let settings = settings::Settings::load();
    util::log(&format!("Khởi động MyDownloader {} (background={background})", env!("CARGO_PKG_VERSION")));
    let core = app::Core::init(rt.handle().clone(), settings.clone());
    let hosts = native::register_host();
    match &hosts {
        Ok(list) => util::log(&format!("Native host đã đăng ký cho: {list:?}")),
        Err(e) => util::log(&format!("Không đăng ký được native host: {e}")),
    }
    *core.hosts.lock().unwrap() = hosts;
    native::register_notifications();
    native::set_autostart(settings.open_at_login);
    if let Some(pipe) = pipe {
        rt.spawn(ipc::serve(pipe, core.clone()));
    }

    if let Err(e) = ui::run(core.clone(), rt.handle().clone(), background) {
        util::log(&format!("Lỗi giao diện: {e}"));
    }
    core.quit();
}

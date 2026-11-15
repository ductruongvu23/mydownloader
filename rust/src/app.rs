// Trạng thái dùng chung giữa engine, IPC, khay hệ thống và giao diện.
use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering::Relaxed};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use eframe::egui;
use tokio::sync::oneshot;
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};

use crate::engine::{Event, Manager};
use crate::settings::Settings;
use crate::{native, util};

/// Link trình duyệt gửi sang đang chờ người dùng xác nhận.
pub struct Prompt {
    pub url: String,
    pub filename: Option<String>,
    pub headers: HashMap<String, String>,
    /// Có khi extension đang giữ download của trình duyệt và chờ trả lời
    pub reply: Option<oneshot::Sender<&'static str>>,
}

pub struct Core {
    pub mgr: Arc<Manager>,
    settings: Mutex<Settings>,
    prompts: Mutex<VecDeque<Prompt>>,
    notices: Mutex<Vec<(String, Instant)>>,
    pub hosts: Mutex<Result<Vec<&'static str>, String>>,
    pub total_speed: AtomicU64,
    pub active: AtomicUsize,
}

static CORE: OnceLock<Arc<Core>> = OnceLock::new();
static CTX: OnceLock<egui::Context> = OnceLock::new();

thread_local! {
    // TrayIcon không Send: chỉ sống trên luồng UI (luồng chạy vòng lặp Win32)
    static TRAY: RefCell<Option<TrayIcon>> = const { RefCell::new(None) };
}

pub fn tr(en: bool, vi: &'static str, english: &'static str) -> &'static str {
    if en {
        english
    } else {
        vi
    }
}

impl Core {
    pub fn init(rt: tokio::runtime::Handle, settings: Settings) -> Arc<Core> {
        let mgr = Manager::new(
            rt.clone(),
            util::data_dir().join("tasks.json"),
            settings.max_concurrent,
            settings.speed_limit,
            Box::new(|ev| {
                if let Some(core) = CORE.get() {
                    core.on_event(ev);
                }
            }),
        );
        let core = Arc::new(Core {
            mgr,
            settings: Mutex::new(settings),
            prompts: Mutex::new(VecDeque::new()),
            notices: Mutex::new(Vec::new()),
            hosts: Mutex::new(Ok(Vec::new())),
            total_speed: AtomicU64::new(0),
            active: AtomicUsize::new(0),
        });
        let _ = CORE.set(core.clone());
        let ticker = core.clone();
        rt.spawn(async move {
            let mut last = Instant::now();
            loop {
                tokio::time::sleep(Duration::from_millis(500)).await;
                let (speed, active) = ticker.mgr.tick(last.elapsed());
                last = Instant::now();
                ticker.total_speed.store(speed, Relaxed);
                ticker.active.store(active, Relaxed);
                if active > 0 {
                    ticker.repaint();
                }
            }
        });
        core
    }

    pub fn set_ctx(ctx: &egui::Context) {
        let _ = CTX.set(ctx.clone());
    }

    pub fn repaint(&self) {
        if let Some(c) = CTX.get() {
            c.request_repaint();
        }
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    /// Lưu và áp dụng ngay những gì đổi (giới hạn tốc độ, số tác vụ, khởi động cùng Windows).
    pub fn set_settings(&self, new: Settings) {
        let old = std::mem::replace(&mut *self.settings.lock().unwrap(), new.clone());
        if old.speed_limit != new.speed_limit {
            self.mgr.set_speed_limit(new.speed_limit);
        }
        if old.max_concurrent != new.max_concurrent {
            self.mgr.set_max_concurrent(new.max_concurrent);
        }
        if old.open_at_login != new.open_at_login {
            native::set_autostart(new.open_at_login);
        }
        new.save();
    }

    fn on_event(&self, ev: Event) {
        // Changed đến khi engine còn giữ khóa: chỉ báo vẽ lại, không đụng khóa khác
        if matches!(ev, Event::Changed) {
            self.repaint();
            return;
        }
        let s = self.settings();
        let en = s.en();
        match ev {
            Event::Done(t) if s.notify_on_complete => util::toast(tr(en, "Tải xong", "Download complete"), &t.name),
            Event::Failed(t) if s.notify_on_complete => util::toast(
                tr(en, "Tải thất bại", "Download failed"),
                &format!("{}: {}", t.name, t.error.unwrap_or_default()),
            ),
            _ => {}
        }
        self.repaint();
    }

    pub fn push_prompt(&self, p: Prompt) {
        self.prompts.lock().unwrap().push_back(p);
        util::show_main_window();
        self.repaint();
    }

    /// Lấy hộp thoại kế tiếp, bỏ qua những cái extension đã thôi chờ.
    pub fn take_prompt(&self) -> Option<Prompt> {
        let mut q = self.prompts.lock().unwrap();
        while let Some(p) = q.pop_front() {
            if p.reply.as_ref().is_none_or(|r| !r.is_closed()) {
                return Some(p);
            }
        }
        None
    }

    pub fn notice(&self, msg: String) {
        self.notices.lock().unwrap().push((msg, Instant::now()));
        self.repaint();
    }

    /// Thông báo còn hiệu lực (4 giây).
    pub fn notices(&self) -> Vec<String> {
        let mut n = self.notices.lock().unwrap();
        n.retain(|(_, at)| at.elapsed() < Duration::from_secs(4));
        n.iter().map(|(m, _)| m.clone()).collect()
    }

    pub fn tray_text(&self) -> String {
        let en = self.settings().en();
        match self.active.load(Relaxed) {
            0 => format!("MyDownloader — {}", tr(en, "Sẵn sàng", "Ready")),
            n => format!(
                "MyDownloader — {n} {} · {}/s",
                tr(en, "đang tải", "downloading"),
                util::format_bytes(self.total_speed.load(Relaxed))
            ),
        }
    }

    /// Thoát hẳn: dừng tác vụ, lưu tiến độ, gỡ icon khay.
    pub fn quit(&self) -> ! {
        self.mgr.shutdown();
        TRAY.with(|t| t.borrow_mut().take());
        std::process::exit(0)
    }
}

pub fn refresh_tray() {
    let Some(core) = CORE.get() else { return };
    let text = core.tray_text();
    TRAY.with(|t| {
        if let Some(t) = t.borrow().as_ref() {
            let _ = t.set_tooltip(Some(text));
        }
    });
}

/// Gọi trên luồng UI (trong vòng lặp sự kiện). Handler của tray chạy ngay cả khi cửa sổ đang ẩn.
pub fn create_tray(en: bool, icon: &egui::IconData) {
    let menu = Menu::new();
    let items = [
        MenuItem::with_id("show", tr(en, "Mở MyDownloader", "Open MyDownloader"), true, None),
        MenuItem::with_id("pause", tr(en, "Tạm dừng tất cả", "Pause all"), true, None),
        MenuItem::with_id("resume", tr(en, "Tiếp tục tất cả", "Resume all"), true, None),
    ];
    let quit = MenuItem::with_id("quit", tr(en, "Thoát", "Exit"), true, None);
    let _ = menu.append_items(&[&items[0], &items[1], &items[2], &PredefinedMenuItem::separator(), &quit]);
    let tray_icon = tray_icon::Icon::from_rgba(icon.rgba.clone(), icon.width, icon.height);
    let built = tray_icon.map_err(|e| e.to_string()).and_then(|icon| {
        TrayIconBuilder::new()
            .with_menu(Box::new(menu))
            .with_menu_on_left_click(false)
            .with_tooltip("MyDownloader")
            .with_icon(icon)
            .build()
            .map_err(|e| e.to_string())
    });
    match built {
        Ok(t) => TRAY.with(|slot| *slot.borrow_mut() = Some(t)),
        Err(e) => util::log(&format!("Không tạo được icon khay: {e}")),
    }
    MenuEvent::set_event_handler(Some(|ev: MenuEvent| {
        let Some(core) = CORE.get() else { return };
        match ev.id.0.as_str() {
            "show" => {
                util::show_main_window();
                core.repaint();
            }
            "pause" => core.mgr.pause_all(),
            "resume" => core.mgr.resume_all(),
            "quit" => core.quit(),
            _ => {}
        }
    }));
    TrayIconEvent::set_event_handler(Some(|ev: TrayIconEvent| match ev {
        TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }
        | TrayIconEvent::DoubleClick { .. } => {
            util::show_main_window();
            if let Some(core) = CORE.get() {
                core.repaint();
            }
        }
        TrayIconEvent::Enter { .. } => refresh_tray(),
        _ => {}
    }));
}

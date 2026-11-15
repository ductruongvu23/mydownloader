// Giao diện egui: thanh bên, danh sách tác vụ, hộp thoại thêm link, trang cài đặt.
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use eframe::egui::{
    self, Align, Align2, Color32, CornerRadius, FontFamily, FontId, Frame, Layout, Margin, RichText, Sense,
    Stroke, TextStyle,
};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tokio::runtime::Handle;
use tokio::sync::oneshot;

use crate::app::{self, tr, Core, Prompt};
use crate::engine::{aria2, batch, AddOptions, Status, Task};
use crate::settings::Settings;
use crate::{native, update, util};

const CARD_INNER_H: f32 = 52.0;
const CARD_H: f32 = CARD_INNER_H + 22.0;

#[derive(Clone, Copy, PartialEq, Eq)]
enum View {
    All,
    Active,
    Waiting,
    Stopped,
    Done,
    Settings,
}

#[derive(Clone, Copy)]
struct Pal {
    bg: Color32,
    panel: Color32,
    card: Color32,
    card_sel: Color32,
    border: Color32,
    text: Color32,
    weak: Color32,
    accent: Color32,
    accent_soft: Color32,
    ok: Color32,
    warn: Color32,
    err: Color32,
}

fn pal(dark: bool) -> Pal {
    let accent = Color32::from_rgb(59, 130, 246);
    if dark {
        Pal {
            bg: Color32::from_rgb(18, 19, 23),
            panel: Color32::from_rgb(23, 24, 29),
            card: Color32::from_rgb(28, 29, 35),
            card_sel: Color32::from_rgb(30, 37, 52),
            border: Color32::from_rgb(42, 44, 52),
            text: Color32::from_rgb(231, 232, 234),
            weak: Color32::from_rgb(139, 145, 154),
            accent,
            accent_soft: Color32::from_rgba_unmultiplied(59, 130, 246, 40),
            ok: Color32::from_rgb(34, 197, 94),
            warn: Color32::from_rgb(234, 179, 8),
            err: Color32::from_rgb(239, 68, 68),
        }
    } else {
        Pal {
            bg: Color32::from_rgb(244, 245, 247),
            panel: Color32::WHITE,
            card: Color32::WHITE,
            card_sel: Color32::from_rgb(238, 244, 255),
            border: Color32::from_rgb(227, 229, 234),
            text: Color32::from_rgb(31, 35, 40),
            weak: Color32::from_rgb(107, 114, 128),
            accent,
            accent_soft: Color32::from_rgba_unmultiplied(59, 130, 246, 30),
            ok: Color32::from_rgb(22, 163, 74),
            warn: Color32::from_rgb(202, 138, 4),
            err: Color32::from_rgb(220, 38, 38),
        }
    }
}

fn visuals(dark: bool) -> egui::Visuals {
    let p = pal(dark);
    let mut v = if dark { egui::Visuals::dark() } else { egui::Visuals::light() };
    v.panel_fill = p.bg;
    v.window_fill = p.panel;
    v.faint_bg_color = p.card;
    v.extreme_bg_color = if dark { Color32::from_rgb(14, 15, 19) } else { Color32::from_rgb(248, 249, 251) };
    v.window_stroke = Stroke::new(1.0_f32, p.border);
    v.window_corner_radius = CornerRadius::same(12);
    v.menu_corner_radius = CornerRadius::same(8);
    v.selection.bg_fill = p.accent;
    v.hyperlink_color = p.accent;
    let (btn, hover) = if dark {
        (Color32::from_rgb(38, 40, 48), Color32::from_rgb(50, 53, 63))
    } else {
        (Color32::from_rgb(234, 236, 240), Color32::from_rgb(222, 225, 231))
    };
    for w in [&mut v.widgets.noninteractive, &mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open] {
        w.corner_radius = CornerRadius::same(6);
    }
    v.widgets.noninteractive.bg_stroke = Stroke::new(1.0_f32, p.border);
    v.widgets.inactive.weak_bg_fill = btn;
    v.widgets.inactive.bg_fill = btn;
    v.widgets.hovered.weak_bg_fill = hover;
    v.widgets.hovered.bg_fill = hover;
    v
}

fn setup_style(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();
    // Segoe UI hiển thị tiếng Việt đẹp; Segoe UI Symbol bù các ký hiệu ▶ ⏸ ⚙...
    for (name, file, first) in [("segoe", "segoeui.ttf", true), ("segoe-symbol", "seguisym.ttf", false)] {
        if let Ok(bytes) = std::fs::read(format!(r"C:\Windows\Fonts\{file}")) {
            fonts.font_data.insert(name.into(), Arc::new(egui::FontData::from_owned(bytes)));
            let family = fonts.families.entry(FontFamily::Proportional).or_default();
            if first {
                family.insert(0, name.into());
            } else {
                family.push(name.into());
            }
        }
    }
    ctx.set_fonts(fonts);
    ctx.set_visuals_of(egui::Theme::Dark, visuals(true));
    ctx.set_visuals_of(egui::Theme::Light, visuals(false));
    ctx.all_styles_mut(|s| {
        s.spacing.item_spacing = egui::vec2(8.0, 6.0);
        s.spacing.button_padding = egui::vec2(10.0, 5.0);
        s.spacing.interact_size.y = 28.0;
        s.text_styles.insert(TextStyle::Body, FontId::proportional(14.0));
        s.text_styles.insert(TextStyle::Button, FontId::proportional(14.0));
        s.text_styles.insert(TextStyle::Small, FontId::proportional(12.0));
        s.text_styles.insert(TextStyle::Heading, FontId::proportional(20.0));
    });
}

struct AddForm {
    torrent: bool,
    urls: String,
    dir: String,
    filename: String,
    threads: usize,
    cookie: String,
    referer: String,
    user_agent: String,
    error: Option<String>,
    reply: Option<oneshot::Sender<&'static str>>,
    from_browser: bool,
}

impl AddForm {
    fn new(s: &Settings, urls: String) -> Self {
        Self {
            torrent: urls.trim().to_ascii_lowercase().starts_with("magnet:"),
            urls,
            dir: s.download_dir.clone(),
            filename: String::new(),
            threads: s.threads,
            cookie: String::new(),
            referer: String::new(),
            user_agent: String::new(),
            error: None,
            reply: None,
            from_browser: false,
        }
    }

    fn from_prompt(p: Prompt, s: &Settings) -> Self {
        let mut f = Self::new(s, p.url);
        let h = |k: &str| p.headers.get(k).cloned().unwrap_or_default();
        f.torrent = aria2::handles(&f.urls) && !f.urls.starts_with("http");
        f.filename = p.filename.unwrap_or_default();
        f.cookie = h("Cookie");
        f.referer = h("Referer");
        f.user_agent = h("User-Agent");
        f.reply = p.reply;
        f.from_browser = true;
        f
    }
}

struct Confirm {
    ids: Vec<String>,
    delete_files: bool,
}

enum UpdateCheck {
    Idle,
    Checking(mpsc::Receiver<Result<Option<update::Release>, String>>),
    UpToDate,
    Available(update::Release),
    Installing { done: Arc<AtomicU64>, total: Arc<AtomicU64>, rx: mpsc::Receiver<Result<(), String>> },
    Failed(String),
}

pub struct App {
    core: Arc<Core>,
    rt: Handle,
    view: View,
    search: String,
    selected: HashSet<String>,
    add: Option<AddForm>,
    confirm: Option<Confirm>,
    update: UpdateCheck,
    p: Pal,
    theme: String,
    /// Khởi động ẩn: đếm khung hình rồi ẩn cửa sổ (eframe luôn hiện cửa sổ sau khung đầu)
    hide_frames: u8,
    last_tray: Instant,
}

pub fn run(core: Arc<Core>, rt: Handle, background: bool) -> eframe::Result {
    let icon = eframe::icon_data::from_png_bytes(include_bytes!("../../resources/icon.png")).unwrap_or_default();
    let tray_icon = eframe::icon_data::from_png_bytes(include_bytes!("../../resources/tray.png")).unwrap_or_else(|_| icon.clone());
    let mut viewport = egui::ViewportBuilder::default()
        .with_title("MyDownloader")
        .with_inner_size([1060.0, 700.0])
        .with_min_inner_size([860.0, 560.0])
        .with_icon(Arc::new(icon));
    if background {
        viewport = viewport.with_position([-20000.0, -20000.0]);
    }
    let options = eframe::NativeOptions { viewport, centered: !background, ..Default::default() };
    eframe::run_native(
        "MyDownloader",
        options,
        Box::new(move |cc| {
            Core::set_ctx(&cc.egui_ctx);
            if let Ok(h) = cc.window_handle() {
                if let RawWindowHandle::Win32(w) = h.as_raw() {
                    util::set_main_hwnd(w.hwnd.get());
                }
            }
            setup_style(&cc.egui_ctx);
            app::create_tray(core.settings().en(), &tray_icon);
            Ok(Box::new(App {
                core,
                rt,
                view: View::All,
                search: String::new(),
                selected: HashSet::new(),
                add: None,
                confirm: None,
                update: UpdateCheck::Idle,
                p: pal(true),
                theme: String::new(),
                hide_frames: if background { 2 } else { 0 },
                last_tray: Instant::now(),
            }))
        }),
    )
}

fn status_color(s: Status, p: Pal) -> Color32 {
    match s {
        Status::Active => p.accent,
        Status::Waiting => p.warn,
        Status::Paused => p.weak,
        Status::Done => p.ok,
        Status::Error => p.err,
    }
}

fn status_text(s: Status, en: bool) -> &'static str {
    match s {
        Status::Active => tr(en, "Đang tải", "Downloading"),
        Status::Waiting => tr(en, "Đang chờ", "Queued"),
        Status::Paused => tr(en, "Tạm dừng", "Paused"),
        Status::Done => tr(en, "Hoàn tất", "Done"),
        Status::Error => tr(en, "Lỗi", "Error"),
    }
}

fn ext_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .filter(|e| e.len() <= 5)
        .unwrap_or_default()
}

fn ext_color(ext: &str) -> Color32 {
    match ext {
        "mp4" | "mkv" | "webm" | "mov" | "avi" | "flv" | "m4v" | "ts" | "m3u8" | "wmv" => Color32::from_rgb(139, 92, 246),
        "mp3" | "m4a" | "aac" | "ogg" | "wav" | "flac" | "opus" => Color32::from_rgb(236, 72, 153),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "svg" | "bmp" => Color32::from_rgb(20, 184, 166),
        "zip" | "rar" | "7z" | "tar" | "gz" | "iso" | "xz" => Color32::from_rgb(245, 158, 11),
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "epub" => Color32::from_rgb(59, 130, 246),
        "exe" | "msi" | "apk" | "dmg" | "torrent" => Color32::from_rgb(239, 68, 68),
        _ => Color32::from_rgb(100, 116, 139),
    }
}

fn looks_like_link(text: &str) -> bool {
    text.lines().any(|l| {
        let l = l.trim().to_ascii_lowercase();
        l.starts_with("http://") || l.starts_with("https://") || l.starts_with("magnet:")
    })
}

fn primary(text: &str, p: Pal) -> egui::Button<'static> {
    egui::Button::new(RichText::new(text).color(Color32::WHITE).strong())
        .fill(p.accent)
        .corner_radius(8)
        .min_size(egui::vec2(0.0, 32.0))
}

fn danger(text: &str, p: Pal) -> egui::Button<'static> {
    egui::Button::new(RichText::new(text).color(Color32::WHITE)).fill(p.err).corner_radius(8).min_size(egui::vec2(0.0, 30.0))
}

fn icon_btn(ui: &mut egui::Ui, icon: &str, tip: &str) -> egui::Response {
    ui.add(egui::Button::new(RichText::new(icon).size(15.0)).min_size(egui::vec2(32.0, 32.0)).corner_radius(8))
        .on_hover_text(tip)
}

fn chip(ui: &mut egui::Ui, text: &str, color: Color32) {
    Frame::new()
        .fill(color.gamma_multiply(0.16))
        .corner_radius(10)
        .inner_margin(Margin::symmetric(8, 1))
        .show(ui, |ui| ui.label(RichText::new(text).size(11.5).color(color)));
}

fn section(ui: &mut egui::Ui, p: Pal, title: &str, add: impl FnOnce(&mut egui::Ui)) {
    Frame::new()
        .fill(p.card)
        .stroke(Stroke::new(1.0_f32, p.border))
        .corner_radius(12)
        .inner_margin(Margin::same(16))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.label(RichText::new(title).size(15.0).strong().color(p.text));
            ui.add_space(10.0);
            add(ui);
        });
    ui.add_space(12.0);
}

fn pick_folder(current: &str) -> Option<String> {
    let mut d = rfd::FileDialog::new();
    if Path::new(current).is_dir() {
        d = d.set_directory(current);
    }
    d.pick_folder().map(|p| p.display().to_string())
}

fn check_update(rt: &Handle, ctx: egui::Context) -> UpdateCheck {
    let (tx, rx) = mpsc::channel();
    rt.spawn(async move {
        let _ = tx.send(update::latest().await);
        ctx.request_repaint();
    });
    UpdateCheck::Checking(rx)
}

fn install_update(rt: &Handle, ctx: egui::Context, zip_url: String) -> UpdateCheck {
    let (done, total) = (Arc::new(AtomicU64::new(0)), Arc::new(AtomicU64::new(0)));
    let (d, t) = (done.clone(), total.clone());
    let (tx, rx) = mpsc::channel();
    rt.spawn(async move {
        let r = update::install(&zip_url, |a, b| {
            d.store(a, Relaxed);
            t.store(b, Relaxed);
        })
        .await;
        let _ = tx.send(r);
        ctx.request_repaint();
    });
    UpdateCheck::Installing { done, total, rx }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let s = self.core.settings();
        let en = s.en();
        if self.theme != s.theme {
            self.theme = s.theme.clone();
            ctx.set_theme(match s.theme.as_str() {
                "light" => egui::ThemePreference::Light,
                "system" => egui::ThemePreference::System,
                _ => egui::ThemePreference::Dark,
            });
        }
        self.p = pal(ctx.style().visuals.dark_mode);

        if ctx.input(|i| i.viewport().close_requested()) && s.close_to_tray {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            util::hide_main_window();
        }

        let next = match &self.update {
            UpdateCheck::Checking(rx) => rx.try_recv().ok().map(|r| match r {
                Ok(Some(rel)) => UpdateCheck::Available(rel),
                Ok(None) => UpdateCheck::UpToDate,
                Err(e) => UpdateCheck::Failed(e),
            }),
            UpdateCheck::Installing { rx, .. } => match rx.try_recv() {
                // Đã thay tệp: mở bản mới và thoát bản này
                Ok(Ok(())) => update::restart(&self.core),
                Ok(Err(e)) => Some(UpdateCheck::Failed(e)),
                Err(_) => {
                    ctx.request_repaint_after(Duration::from_millis(200));
                    None
                }
            },
            _ => None,
        };
        if let Some(n) = next {
            self.update = n;
        }

        // Extension đã thôi chờ (quá thời gian) thì đóng hộp thoại để không tải trùng với trình duyệt
        if self.add.as_ref().is_some_and(|f| f.reply.as_ref().is_some_and(|r| r.is_closed())) {
            self.add = None;
        }
        if self.add.is_none() {
            if let Some(p) = self.core.take_prompt() {
                self.add = Some(AddForm::from_prompt(p, &s));
            }
        }
        // Dán link (Ctrl+V) ở bất kỳ đâu ngoài ô nhập để mở hộp thoại thêm
        if self.add.is_none() && self.confirm.is_none() && ctx.memory(|m| m.focused().is_none()) {
            let pasted = ctx.input(|i| {
                i.events.iter().find_map(|e| match e {
                    egui::Event::Paste(t) => Some(t.clone()),
                    _ => None,
                })
            });
            if let Some(t) = pasted.filter(|t| looks_like_link(t)) {
                self.add = Some(AddForm::new(&s, t.trim().to_string()));
            }
        }

        if self.hide_frames > 0 {
            self.hide_frames -= 1;
            if self.hide_frames == 0 {
                // Đã vẽ xong ngoài màn hình: đưa cửa sổ về giữa
                if let Some(screen) = ctx.input(|i| i.viewport().monitor_size) {
                    let size = ctx.input(|i| i.viewport().outer_rect).map_or(egui::vec2(1060.0, 700.0), |r| r.size());
                    let pos = ((screen - size) / 2.0).max(egui::Vec2::ZERO);
                    ctx.send_viewport_cmd(egui::ViewportCommand::OuterPosition(pos.to_pos2()));
                }
                // Extension mở app để gửi link: link đã chờ sẵn thì hiện hộp thoại, không ẩn xuống khay
                if self.add.is_some() {
                    util::show_main_window();
                } else {
                    util::hide_main_window();
                }
            } else {
                ctx.request_repaint();
            }
        }

        let tasks = self.core.mgr.snapshot();
        self.selected.retain(|id| tasks.iter().any(|t| &t.id == id));

        self.sidebar(ctx, &tasks, en);
        self.status_bar(ctx, &tasks, &s, en);
        if self.view != View::Settings {
            self.toolbar(ctx, en);
        }
        egui::CentralPanel::default().frame(Frame::new().fill(self.p.bg).inner_margin(Margin::same(16))).show(ctx, |ui| {
            if self.view == View::Settings {
                self.settings_page(ui, en);
            } else {
                self.task_list(ui, &tasks, en);
            }
        });
        self.add_dialog(ctx, en);
        self.confirm_dialog(ctx, en);
        self.notices(ctx);

        if self.core.active.load(Relaxed) > 0 {
            ctx.request_repaint_after(Duration::from_millis(500));
        }
        if self.last_tray.elapsed() > Duration::from_secs(1) {
            self.last_tray = Instant::now();
            app::refresh_tray();
        }
    }
}

impl App {
    fn nav_button(&self, ui: &mut egui::Ui, view: View, icon: &str, label: &str, n: usize) -> bool {
        let p = self.p;
        let on = self.view == view;
        let text = RichText::new(format!("{icon}   {label}")).size(14.0).color(if on { p.accent } else { p.text });
        let badge = RichText::new(if n > 0 { n.to_string() } else { String::new() }).size(12.0).color(p.weak);
        let b = egui::Button::new(text)
            .right_text(badge)
            .corner_radius(8)
            .min_size(egui::vec2(ui.available_width(), 36.0));
        let b = if on { b.fill(p.accent_soft) } else { b.frame_when_inactive(false) };
        ui.add(b).clicked()
    }

    fn sidebar(&mut self, ctx: &egui::Context, tasks: &[Task], en: bool) {
        let p = self.p;
        let count = |f: fn(&Task) -> bool| tasks.iter().filter(|t| f(t)).count();
        let items = [
            (View::All, "☰", tr(en, "Tất cả", "All"), tasks.len()),
            (View::Active, "⬇", tr(en, "Đang tải", "Downloading"), count(|t| t.status == Status::Active)),
            (View::Waiting, "⏳", tr(en, "Đang chờ", "Queued"), count(|t| t.status == Status::Waiting)),
            (View::Stopped, "⏸", tr(en, "Đã dừng / lỗi", "Stopped / failed"), count(|t| matches!(t.status, Status::Paused | Status::Error))),
            (View::Done, "✔", tr(en, "Hoàn tất", "Completed"), count(|t| t.status == Status::Done)),
        ];
        egui::SidePanel::left("nav")
            .resizable(false)
            .exact_width(212.0)
            .frame(Frame::new().fill(p.panel).inner_margin(Margin::symmetric(12, 16)))
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    let (r, _) = ui.allocate_exact_size(egui::vec2(38.0, 38.0), Sense::hover());
                    ui.painter().rect_filled(r, 10, p.accent);
                    ui.painter().text(r.center(), Align2::CENTER_CENTER, "⬇", FontId::proportional(19.0), Color32::WHITE);
                    ui.vertical(|ui| {
                        ui.label(RichText::new("MyDownloader").strong().size(15.0).color(p.text));
                        ui.label(RichText::new(format!("v{}", env!("CARGO_PKG_VERSION"))).size(11.0).color(p.weak));
                    });
                });
                ui.add_space(18.0);
                for (view, icon, label, n) in items {
                    if self.nav_button(ui, view, icon, label, n) {
                        self.view = view;
                    }
                }
                ui.with_layout(Layout::bottom_up(Align::LEFT), |ui| {
                    if self.nav_button(ui, View::Settings, "⚙", tr(en, "Cài đặt", "Settings"), 0) {
                        self.view = View::Settings;
                    }
                    let speed = self.core.total_speed.load(Relaxed);
                    if speed > 0 {
                        ui.label(RichText::new(format!("⬇ {}/s", util::format_bytes(speed))).size(13.0).color(p.accent));
                    }
                });
            });
    }

    fn toolbar(&mut self, ctx: &egui::Context, en: bool) {
        let p = self.p;
        egui::TopBottomPanel::top("toolbar")
            .show_separator_line(false)
            .frame(Frame::new().fill(p.bg).inner_margin(Margin { left: 16, right: 16, top: 14, bottom: 2 }))
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    if ui.add(primary(tr(en, "＋  Thêm nhiệm vụ", "＋  Add download"), p)).clicked() {
                        self.add = Some(AddForm::new(&self.core.settings(), String::new()));
                    }
                    ui.add_space(6.0);
                    if icon_btn(ui, "▶", tr(en, "Tiếp tục tất cả", "Resume all")).clicked() {
                        self.core.mgr.resume_all();
                    }
                    if icon_btn(ui, "⏸", tr(en, "Tạm dừng tất cả", "Pause all")).clicked() {
                        self.core.mgr.pause_all();
                    }
                    if icon_btn(ui, "✔", tr(en, "Dọn các tác vụ đã xong", "Clear completed")).clicked() {
                        self.core.mgr.clear_done();
                    }
                    if icon_btn(ui, "🗑", tr(en, "Xóa tất cả tác vụ", "Remove all")).clicked() {
                        let ids: Vec<String> = self.core.mgr.snapshot().into_iter().map(|t| t.id).collect();
                        if !ids.is_empty() {
                            self.confirm = Some(Confirm { ids, delete_files: false });
                        }
                    }
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        ui.add(
                            egui::TextEdit::singleline(&mut self.search)
                                .hint_text(tr(en, "🔍  Tìm kiếm tệp...", "🔍  Search files..."))
                                .desired_width(240.0),
                        );
                    });
                });
            });
    }

    fn status_bar(&self, ctx: &egui::Context, tasks: &[Task], s: &Settings, en: bool) {
        let p = self.p;
        let n = |st: Status| tasks.iter().filter(|t| t.status == st).count();
        egui::TopBottomPanel::bottom("status")
            .exact_height(30.0)
            .frame(Frame::new().fill(p.panel).inner_margin(Margin::symmetric(16, 4)))
            .show(ctx, |ui| {
                ui.horizontal_centered(|ui| {
                    let speed = self.core.total_speed.load(Relaxed);
                    ui.label(RichText::new("●").size(10.0).color(if speed > 0 { p.ok } else { p.weak }));
                    ui.label(
                        RichText::new(format!("{}: {}/s", tr(en, "Tổng tốc độ", "Total speed"), util::format_bytes(speed)))
                            .size(12.5)
                            .color(p.text),
                    );
                    ui.add_space(12.0);
                    for (count, label, color) in [
                        (n(Status::Active), tr(en, "đang tải", "downloading"), p.accent),
                        (n(Status::Waiting), tr(en, "chờ", "queued"), p.warn),
                        (n(Status::Done), tr(en, "xong", "done"), p.ok),
                        (n(Status::Error), tr(en, "lỗi", "failed"), p.err),
                    ] {
                        if count > 0 {
                            chip(ui, &format!("{count} {label}"), color);
                        }
                    }
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        let limit = if s.speed_limit > 0 { format!("{}/s", util::format_bytes(s.speed_limit)) } else { "∞".into() };
                        ui.label(RichText::new(format!("{}: {limit}", tr(en, "Giới hạn", "Limit"))).size(12.0).color(p.weak));
                    });
                });
            });
    }

    fn task_list(&mut self, ui: &mut egui::Ui, tasks: &[Task], en: bool) {
        let p = self.p;
        let q = self.search.trim().to_lowercase();
        let view = self.view;
        let mut list: Vec<&Task> = tasks
            .iter()
            .filter(|t| match view {
                View::All | View::Settings => true,
                View::Active => t.status == Status::Active,
                View::Waiting => t.status == Status::Waiting,
                View::Stopped => matches!(t.status, Status::Paused | Status::Error),
                View::Done => t.status == Status::Done,
            })
            .filter(|t| q.is_empty() || t.name.to_lowercase().contains(&q) || t.url.to_lowercase().contains(&q))
            .collect();
        list.reverse(); // mới thêm lên đầu

        if list.is_empty() {
            ui.vertical_centered(|ui| {
                ui.add_space((ui.available_height() * 0.26).max(20.0));
                ui.label(RichText::new("📭").size(52.0).color(p.weak));
                ui.add_space(8.0);
                ui.label(RichText::new(tr(en, "Không có nhiệm vụ nào", "No downloads")).size(18.0).strong().color(p.text));
                ui.label(
                    RichText::new(tr(
                        en,
                        "Bấm \"Thêm nhiệm vụ\" hoặc dán liên kết (Ctrl+V) để bắt đầu tải.",
                        "Click \"Add download\" or paste a link (Ctrl+V) to start.",
                    ))
                    .color(p.weak),
                );
                ui.add_space(12.0);
                if ui.add(primary(tr(en, "＋  Thêm nhiệm vụ", "＋  Add download"), p)).clicked() {
                    self.add = Some(AddForm::new(&self.core.settings(), String::new()));
                }
            });
            return;
        }

        ui.horizontal(|ui| {
            let ids: Vec<String> = list.iter().map(|t| t.id.clone()).collect();
            let mut all = ids.iter().all(|id| self.selected.contains(id));
            let label = format!("{} ({})", tr(en, "Chọn tất cả", "Select all"), ids.len());
            if ui.checkbox(&mut all, RichText::new(label).color(p.weak)).changed() {
                if all {
                    self.selected.extend(ids.iter().cloned());
                } else {
                    for id in &ids {
                        self.selected.remove(id);
                    }
                }
            }
            let sel: Vec<String> = ids.into_iter().filter(|id| self.selected.contains(id)).collect();
            if !sel.is_empty() {
                chip(ui, &format!("{} {}", tr(en, "Đã chọn", "Selected"), sel.len()), p.accent);
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if ui.add(danger(tr(en, "🗑 Xóa đã chọn", "🗑 Remove selected"), p)).clicked() {
                        self.confirm = Some(Confirm { ids: sel.clone(), delete_files: false });
                    }
                    if ui.button(tr(en, "▶ Tiếp tục", "▶ Resume")).clicked() {
                        self.core.mgr.resume(&sel);
                    }
                    if ui.button(tr(en, "⏸ Tạm dừng", "⏸ Pause")).clicked() {
                        self.core.mgr.pause(&sel);
                    }
                });
            }
        });
        ui.add_space(6.0);
        egui::ScrollArea::vertical().auto_shrink([false, false]).show_rows(ui, CARD_H, list.len(), |ui, range| {
            for t in &list[range] {
                self.task_card(ui, t, en);
            }
        });
    }

    fn task_card(&mut self, ui: &mut egui::Ui, t: &Task, en: bool) {
        let p = self.p;
        let selected = self.selected.contains(&t.id);
        let color = status_color(t.status, p);
        Frame::new()
            .fill(if selected { p.card_sel } else { p.card })
            .stroke(Stroke::new(1.0_f32, if selected { p.accent.gamma_multiply(0.6) } else { p.border }))
            .corner_radius(10)
            .inner_margin(Margin::symmetric(12, 10))
            .show(ui, |ui| {
                ui.set_height(CARD_INNER_H);
                ui.horizontal(|ui| {
                    let mut sel = selected;
                    if ui.checkbox(&mut sel, "").changed() {
                        if sel {
                            self.selected.insert(t.id.clone());
                        } else {
                            self.selected.remove(&t.id);
                        }
                    }
                    let ext = ext_of(&t.name);
                    let (r, _) = ui.allocate_exact_size(egui::vec2(44.0, 44.0), Sense::hover());
                    ui.painter().rect_filled(r, 10, ext_color(&ext));
                    let label = if ext.is_empty() { "FILE".to_string() } else { ext.to_uppercase() };
                    ui.painter().text(r.center(), Align2::CENTER_CENTER, label, FontId::proportional(11.0), Color32::WHITE);
                    ui.add_space(6.0);

                    let body_w = (ui.available_width() - 160.0).max(180.0);
                    let done = t.status == Status::Done;
                    let frac = if done {
                        1.0
                    } else if t.size > 0 {
                        (t.downloaded as f32 / t.size as f32).clamp(0.0, 1.0)
                    } else {
                        0.0
                    };
                    ui.vertical(|ui| {
                        ui.set_width(body_w);
                        ui.horizontal(|ui| {
                            let name = if t.name.is_empty() { &t.url } else { &t.name };
                            ui.allocate_ui_with_layout(egui::vec2(body_w - 110.0, 20.0), Layout::left_to_right(Align::Center), |ui| {
                                ui.add(egui::Label::new(RichText::new(name).size(14.0).strong().color(p.text)).truncate())
                                    .on_hover_text(&t.url);
                            });
                            chip(ui, status_text(t.status, en), color);
                        });
                        ui.add(egui::ProgressBar::new(frac).desired_height(6.0).desired_width(body_w).fill(color).corner_radius(3));
                        ui.horizontal(|ui| {
                            let small = |s: String, c: Color32| RichText::new(s).size(12.0).color(c);
                            if t.status == Status::Error {
                                let err = t.error.clone().unwrap_or_else(|| tr(en, "Lỗi tải xuống", "Download failed").into());
                                ui.add(egui::Label::new(small(format!("⚠ {err}"), p.err)).truncate()).on_hover_text(err);
                                return;
                            }
                            let size = if done {
                                util::format_bytes(t.size.max(t.downloaded))
                            } else if t.size > 0 {
                                format!("{} / {}", util::format_bytes(t.downloaded), util::format_bytes(t.size))
                            } else {
                                util::format_bytes(t.downloaded)
                            };
                            ui.label(small(size, p.weak));
                            if t.size > 0 && t.status != Status::Done {
                                ui.label(small(format!("{:.0}%", frac * 100.0), p.weak));
                            }
                            if t.status == Status::Active {
                                ui.label(small(format!("⬇ {}/s", util::format_bytes(t.speed)), p.accent));
                                if let Some(eta) = t.eta_secs() {
                                    ui.label(small(format!("⏱ {}", util::format_eta(eta)), p.weak));
                                }
                                if t.connections > 0 {
                                    ui.label(small(format!("{} {}", t.connections, tr(en, "luồng", "conn.")), p.weak));
                                }
                            }
                        });
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| self.task_actions(ui, t, en));
                });
            });
    }

    fn task_actions(&mut self, ui: &mut egui::Ui, t: &Task, en: bool) {
        let p = self.p;
        let ids = vec![t.id.clone()];
        ui.menu_button(RichText::new("⋯").size(16.0), |ui| {
            if ui.button(tr(en, "📋  Sao chép liên kết", "📋  Copy link")).clicked() {
                ui.ctx().copy_text(t.url.clone());
                ui.close();
            }
            if let Some(dest) = &t.dest {
                if ui.button(tr(en, "📂  Mở thư mục", "📂  Show in folder")).clicked() {
                    util::show_in_folder(Path::new(dest));
                    ui.close();
                }
            }
            ui.separator();
            if ui.button(RichText::new(tr(en, "🗑  Xóa tác vụ", "🗑  Remove")).color(p.err)).clicked() {
                self.confirm = Some(Confirm { ids: ids.clone(), delete_files: false });
                ui.close();
            }
        });
        if let Some(dest) = &t.dest {
            if icon_btn(ui, "📂", tr(en, "Mở thư mục", "Show in folder")).clicked() {
                util::show_in_folder(Path::new(dest));
            }
            if t.status == Status::Done && icon_btn(ui, "📄", tr(en, "Mở tệp", "Open file")).clicked() {
                util::open_path(dest);
            }
        }
        match t.status {
            Status::Active | Status::Waiting => {
                if icon_btn(ui, "⏸", tr(en, "Tạm dừng", "Pause")).clicked() {
                    self.core.mgr.pause(&ids);
                }
            }
            Status::Paused | Status::Error => {
                if icon_btn(ui, "▶", tr(en, "Tiếp tục", "Resume")).clicked() {
                    self.core.mgr.resume(&ids);
                }
            }
            Status::Done => {}
        }
    }

    fn settings_page(&mut self, ui: &mut egui::Ui, en: bool) {
        let p = self.p;
        let before = self.core.settings();
        let mut f = before.clone();
        egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
            ui.label(RichText::new(tr(en, "Cài đặt", "Settings")).size(22.0).strong().color(p.text));
            ui.add_space(12.0);
            section(ui, p, tr(en, "Cơ bản", "General"), |ui| {
                egui::Grid::new("g-basic").num_columns(2).spacing([24.0, 12.0]).show(ui, |ui| {
                    ui.label(tr(en, "Thư mục tải xuống", "Download folder"));
                    ui.horizontal(|ui| {
                        ui.add(egui::TextEdit::singleline(&mut f.download_dir).desired_width(380.0));
                        if ui.button(tr(en, "Duyệt...", "Browse...")).clicked() {
                            if let Some(d) = pick_folder(&f.download_dir) {
                                f.download_dir = d;
                            }
                        }
                    });
                    ui.end_row();
                    ui.label(tr(en, "Ngôn ngữ", "Language"));
                    egui::ComboBox::from_id_salt("lang")
                        .selected_text(if f.language == "en" { "English" } else { "Tiếng Việt" })
                        .show_ui(ui, |ui| {
                            ui.selectable_value(&mut f.language, "vi".to_string(), "Tiếng Việt");
                            ui.selectable_value(&mut f.language, "en".to_string(), "English");
                        });
                    ui.end_row();
                    ui.label(tr(en, "Giao diện", "Theme"));
                    ui.horizontal(|ui| {
                        for (v, vi, english) in [("dark", "Tối", "Dark"), ("light", "Sáng", "Light"), ("system", "Theo hệ thống", "System")] {
                            ui.radio_value(&mut f.theme, v.to_string(), tr(en, vi, english));
                        }
                    });
                    ui.end_row();
                });
                ui.add_space(8.0);
                ui.checkbox(&mut f.notify_on_complete, tr(en, "Thông báo khi tải xong hoặc bị lỗi", "Notify when a download finishes or fails"));
                ui.checkbox(&mut f.open_at_login, tr(en, "Khởi động cùng Windows (chạy ẩn ở khay hệ thống)", "Start with Windows (hidden in the tray)"));
                ui.checkbox(
                    &mut f.close_to_tray,
                    tr(en, "Bấm ✕ thì thu xuống khay hệ thống và vẫn tải tiếp", "Closing the window keeps downloading in the tray"),
                );
            });
            section(ui, p, tr(en, "Tải xuống", "Downloads"), |ui| {
                egui::Grid::new("g-dl").num_columns(2).spacing([24.0, 12.0]).show(ui, |ui| {
                    ui.label(tr(en, "Số tác vụ tải cùng lúc", "Simultaneous downloads"));
                    ui.add(egui::Slider::new(&mut f.max_concurrent, 1..=20));
                    ui.end_row();
                    ui.label(tr(en, "Số luồng mặc định mỗi tác vụ", "Connections per download"));
                    ui.add(egui::Slider::new(&mut f.threads, 1..=32));
                    ui.end_row();
                    ui.label(tr(en, "Giới hạn tốc độ tổng", "Total speed limit"));
                    let mut kb = f.speed_limit / 1024;
                    ui.horizontal(|ui| {
                        ui.add(egui::DragValue::new(&mut kb).range(0..=10_000_000).speed(64).suffix(" KB/s"));
                        ui.label(RichText::new(tr(en, "0 = không giới hạn", "0 = unlimited")).color(p.weak).size(12.0));
                    });
                    f.speed_limit = kb * 1024;
                    ui.end_row();
                });
            });
            section(ui, p, tr(en, "Tích hợp trình duyệt", "Browser integration"), |ui| {
                match &*self.core.hosts.lock().unwrap() {
                    Ok(list) if !list.is_empty() => {
                        ui.colored_label(p.ok, format!("✔ {} {}", tr(en, "Đã kết nối với", "Connected to"), list.join(", ")));
                    }
                    Ok(_) => {
                        ui.colored_label(p.warn, tr(en, "Không thấy Chrome / Edge / Brave / Cốc Cốc trên máy.", "No supported browser found."));
                    }
                    Err(e) => {
                        ui.colored_label(p.err, format!("✖ {e}"));
                    }
                }
                ui.label(RichText::new(format!("Extension ID: {}", native::EXTENSION_ID)).size(12.0).color(p.weak));
                ui.add_space(4.0);
                ui.checkbox(
                    &mut f.auto_download_from_extension,
                    tr(en, "Tự tải link bắt được từ trình duyệt, không hỏi lại", "Download links from the browser without asking"),
                );
                ui.horizontal(|ui| {
                    if ui.button(tr(en, "📂 Mở thư mục Extension", "📂 Open extension folder")).clicked() {
                        match native::extension_dir() {
                            Some(d) => util::open_path(&d.display().to_string()),
                            None => self.core.notice(tr(en, "Không tìm thấy thư mục extension", "Extension folder not found").into()),
                        }
                    }
                    if ui.button(tr(en, "⟳ Đăng ký lại với trình duyệt", "⟳ Register with browsers again")).clicked() {
                        *self.core.hosts.lock().unwrap() = native::register_host();
                    }
                });
                ui.add_space(6.0);
                let guide: [&str; 4] = if en {
                    [
                        "1. Open chrome://extensions (edge://extensions, coccoc://extensions).",
                        "2. Turn on Developer mode.",
                        "3. Click \"Load unpacked\" and choose the extension folder above.",
                        "4. MyDownloader starts by itself when the browser catches a download, even if it is closed.",
                    ]
                } else {
                    [
                        "1. Mở chrome://extensions (edge://extensions, coccoc://extensions).",
                        "2. Bật \"Chế độ dành cho nhà phát triển\".",
                        "3. Bấm \"Tải tiện ích đã giải nén\" và chọn thư mục Extension ở trên.",
                        "4. MyDownloader tự mở khi trình duyệt bắt được link tải, kể cả lúc app đang tắt.",
                    ]
                };
                for line in guide {
                    ui.label(RichText::new(line).size(12.5).color(p.weak));
                }
            });
            section(ui, p, tr(en, "Cập nhật", "Updates"), |ui| {
                ui.horizontal(|ui| {
                    ui.label(format!("{} {}", tr(en, "Phiên bản", "Version"), env!("CARGO_PKG_VERSION")));
                    let busy = matches!(self.update, UpdateCheck::Checking(_) | UpdateCheck::Installing { .. });
                    if ui.add_enabled(!busy, egui::Button::new(tr(en, "Kiểm tra cập nhật", "Check for updates"))).clicked() {
                        self.update = check_update(&self.rt, ui.ctx().clone());
                    }
                });
                let mut install: Option<String> = None;
                match &self.update {
                    UpdateCheck::Idle => {}
                    UpdateCheck::Checking(_) => {
                        ui.horizontal(|ui| {
                            ui.spinner();
                            ui.label(tr(en, "Đang kiểm tra...", "Checking..."));
                        });
                    }
                    UpdateCheck::UpToDate => {
                        ui.colored_label(p.ok, tr(en, "Bạn đang dùng bản mới nhất.", "You are up to date."));
                    }
                    UpdateCheck::Available(rel) => {
                        ui.horizontal(|ui| {
                            ui.colored_label(p.accent, format!("{} v{}", tr(en, "Có bản mới", "New version"), rel.version));
                            if let Some(zip) = &rel.zip {
                                if ui.add(primary(tr(en, "Cập nhật ngay", "Update now"), p)).clicked() {
                                    install = Some(zip.clone());
                                }
                            }
                            if ui.button(tr(en, "Mở trang tải", "Open download page")).clicked() {
                                util::open_path(&rel.page);
                            }
                        });
                    }
                    UpdateCheck::Installing { done, total, .. } => {
                        let (d, t) = (done.load(Relaxed), total.load(Relaxed));
                        let frac = if t > 0 { d as f32 / t as f32 } else { 0.0 };
                        ui.label(format!(
                            "{} {} / {}",
                            tr(en, "Đang tải bản cập nhật:", "Downloading update:"),
                            util::format_bytes(d),
                            util::format_bytes(t)
                        ));
                        ui.add(egui::ProgressBar::new(frac).desired_height(6.0).fill(p.accent).corner_radius(3));
                    }
                    UpdateCheck::Failed(e) => {
                        ui.colored_label(p.err, format!("{}: {e}", tr(en, "Cập nhật lỗi", "Update failed")));
                    }
                }
                if let Some(zip) = install {
                    self.update = install_update(&self.rt, ui.ctx().clone(), zip);
                }
            });
        });
        if f != before {
            self.core.set_settings(f);
        }
    }

    fn add_dialog(&mut self, ctx: &egui::Context, en: bool) {
        let p = self.p;
        let Some(f) = self.add.as_mut() else { return };
        let mut action: Option<bool> = None;
        let resp = egui::Modal::new(egui::Id::new("add-dialog")).show(ctx, |ui| {
            ui.set_width(600.0);
            let title = if f.from_browser {
                tr(en, "Link tải từ trình duyệt", "Download from the browser")
            } else {
                tr(en, "Thêm nhiệm vụ tải xuống", "Add download")
            };
            ui.label(RichText::new(title).size(18.0).strong());
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                if ui.add(egui::Button::selectable(!f.torrent, tr(en, "Liên kết HTTP / HTTPS", "HTTP / HTTPS links"))).clicked() {
                    f.torrent = false;
                }
                if ui.add(egui::Button::selectable(f.torrent, "Torrent / Magnet / FTP")).clicked() {
                    f.torrent = true;
                }
            });
            ui.add_space(6.0);
            if f.torrent {
                ui.horizontal(|ui| {
                    ui.add(egui::TextEdit::singleline(&mut f.urls).hint_text("magnet:?xt=urn:btih:...").desired_width(430.0));
                    if ui.button(tr(en, "Chọn tệp .torrent", "Choose .torrent")).clicked() {
                        if let Some(path) = rfd::FileDialog::new().add_filter("Torrent", &["torrent"]).pick_file() {
                            f.urls = path.display().to_string();
                        }
                    }
                });
            } else {
                ui.add(
                    egui::TextEdit::multiline(&mut f.urls)
                        .hint_text(tr(
                            en,
                            "Dán một hoặc nhiều liên kết, mỗi dòng một link.\nHỗ trợ mẫu: https://example.com/file[001-020].zip",
                            "Paste one or more links, one per line.\nPatterns work too: https://example.com/file[001-020].zip",
                        ))
                        .desired_rows(4)
                        .desired_width(f32::INFINITY),
                );
            }
            ui.add_space(6.0);
            egui::Grid::new("add-grid").num_columns(2).spacing([12.0, 8.0]).show(ui, |ui| {
                ui.label(tr(en, "Lưu vào", "Save to"));
                ui.horizontal(|ui| {
                    ui.add(egui::TextEdit::singleline(&mut f.dir).desired_width(400.0));
                    if ui.button(tr(en, "Duyệt...", "Browse...")).clicked() {
                        if let Some(d) = pick_folder(&f.dir) {
                            f.dir = d;
                        }
                    }
                });
                ui.end_row();
                ui.label(tr(en, "Tên tệp", "File name"));
                ui.add(
                    egui::TextEdit::singleline(&mut f.filename)
                        .hint_text(tr(en, "Tùy chọn — để trống sẽ lấy tên từ máy chủ", "Optional — empty uses the server's name"))
                        .desired_width(480.0),
                );
                ui.end_row();
                if !f.torrent {
                    ui.label(tr(en, "Số luồng", "Connections"));
                    ui.add(egui::Slider::new(&mut f.threads, 1..=32));
                    ui.end_row();
                }
            });
            if !f.torrent {
                egui::CollapsingHeader::new(tr(en, "Nâng cao (Cookie, Referer, User-Agent)", "Advanced (Cookie, Referer, User-Agent)"))
                    .default_open(false)
                    .show(ui, |ui| {
                        egui::Grid::new("add-adv").num_columns(2).spacing([12.0, 6.0]).show(ui, |ui| {
                            for (label, value) in [("Cookie", &mut f.cookie), ("Referer", &mut f.referer), ("User-Agent", &mut f.user_agent)] {
                                ui.label(label);
                                ui.add(egui::TextEdit::singleline(value).desired_width(460.0));
                                ui.end_row();
                            }
                        });
                    });
            }
            if let Some(e) = &f.error {
                ui.colored_label(p.err, e);
            }
            ui.add_space(10.0);
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if ui.add(primary(tr(en, "Bắt đầu tải", "Start download"), p)).clicked() {
                    action = Some(true);
                }
                if ui.button(tr(en, "Hủy bỏ", "Cancel")).clicked() {
                    action = Some(false);
                }
            });
        });
        if action.is_none() && resp.should_close() {
            action = Some(false);
        }
        match action {
            Some(true) => self.submit_add(en),
            Some(false) => {
                if let Some(r) = self.add.take().and_then(|f| f.reply) {
                    let _ = r.send("cancelled");
                }
            }
            None => {}
        }
    }

    fn submit_add(&mut self, en: bool) {
        let Some(f) = self.add.as_mut() else { return };
        let urls: Vec<String> = f
            .urls
            .lines()
            .map(|l| l.trim().trim_matches(['"', '\'', '`']).trim())
            .filter(|l| !l.is_empty())
            .flat_map(batch::expand)
            .filter(|u| {
                let l = u.to_ascii_lowercase();
                l.starts_with("http://") || l.starts_with("https://") || aria2::handles(u)
            })
            .collect();
        if urls.is_empty() {
            f.error = Some(
                tr(en, "Không có liên kết hợp lệ (http, https, magnet, ftp hoặc tệp .torrent).", "No valid link (http, https, magnet, ftp or .torrent).")
                    .into(),
            );
            return;
        }
        let mut headers = HashMap::new();
        for (k, v) in [("Cookie", &f.cookie), ("Referer", &f.referer), ("User-Agent", &f.user_agent)] {
            if !v.trim().is_empty() {
                headers.insert(k.to_string(), v.trim().to_string());
            }
        }
        let filename = (urls.len() == 1).then(|| f.filename.trim().to_string()).filter(|n| !n.is_empty());
        let opts = AddOptions { dir: f.dir.trim().to_string(), filename, headers, threads: f.threads };
        let (mut added, mut dup) = (0usize, 0usize);
        for u in &urls {
            if self.core.mgr.active_url(u).is_some() {
                dup += 1;
            } else {
                self.core.mgr.add(u, &opts);
                added += 1;
            }
        }
        if let Some(r) = self.add.take().and_then(|f| f.reply) {
            let _ = r.send(if added > 0 { "started" } else { "duplicate" });
        }
        // Như bản cũ: thư mục vừa chọn thành thư mục mặc định
        let mut s = self.core.settings();
        if !opts.dir.is_empty() && s.download_dir != opts.dir {
            s.download_dir = opts.dir.clone();
            self.core.set_settings(s);
        }
        self.core.notice(match (added, dup, en) {
            (a, 0, false) => format!("Đã thêm {a} nhiệm vụ"),
            (a, 0, true) => format!("Added {a} download(s)"),
            (0, d, false) => format!("{d} liên kết đang được tải sẵn"),
            (0, d, true) => format!("{d} link(s) already downloading"),
            (a, d, false) => format!("Đã thêm {a} nhiệm vụ, bỏ qua {d} link trùng"),
            (a, d, true) => format!("Added {a}, skipped {d} duplicate(s)"),
        });
        self.view = if self.view == View::Settings { View::All } else { self.view };
    }

    fn confirm_dialog(&mut self, ctx: &egui::Context, en: bool) {
        let p = self.p;
        let Some(c) = self.confirm.as_mut() else { return };
        let mut result: Option<bool> = None;
        let resp = egui::Modal::new(egui::Id::new("confirm-dialog")).show(ctx, |ui| {
            ui.set_width(400.0);
            ui.label(RichText::new(tr(en, "Xóa nhiệm vụ", "Remove downloads")).size(17.0).strong());
            ui.add_space(6.0);
            ui.label(if en {
                format!("Remove {} download(s) from the list?", c.ids.len())
            } else {
                format!("Xóa {} nhiệm vụ khỏi danh sách?", c.ids.len())
            });
            ui.checkbox(&mut c.delete_files, tr(en, "Xóa cả tệp đã tải trên ổ đĩa", "Also delete the files from disk"));
            ui.add_space(10.0);
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if ui.add(danger(tr(en, "Xóa", "Remove"), p)).clicked() {
                    result = Some(true);
                }
                if ui.button(tr(en, "Hủy", "Cancel")).clicked() {
                    result = Some(false);
                }
            });
        });
        if result.is_none() && resp.should_close() {
            result = Some(false);
        }
        match result {
            Some(true) => {
                if let Some(c) = self.confirm.take() {
                    self.core.mgr.remove(&c.ids, c.delete_files);
                    for id in &c.ids {
                        self.selected.remove(id);
                    }
                }
            }
            Some(false) => self.confirm = None,
            None => {}
        }
    }

    fn notices(&self, ctx: &egui::Context) {
        let list = self.core.notices();
        if list.is_empty() {
            return;
        }
        let p = self.p;
        egui::Area::new(egui::Id::new("notices"))
            .anchor(Align2::RIGHT_BOTTOM, egui::vec2(-16.0, -42.0))
            .interactable(false)
            .show(ctx, |ui| {
                for n in list {
                    Frame::new()
                        .fill(p.panel)
                        .stroke(Stroke::new(1.0_f32, p.accent.gamma_multiply(0.7)))
                        .corner_radius(8)
                        .inner_margin(Margin::symmetric(12, 8))
                        .show(ui, |ui| ui.label(RichText::new(n).color(p.text)));
                    ui.add_space(6.0);
                }
            });
        ctx.request_repaint_after(Duration::from_millis(500));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_detection() {
        assert!(looks_like_link("  https://x/a.zip\n"));
        assert!(looks_like_link("magnet:?xt=urn:btih:abc"));
        assert!(!looks_like_link("hello world"));
    }
}

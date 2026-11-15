// Kênh nội bộ qua named pipe: extension (qua mydownloader-host.exe) và lần mở app thứ hai
// gửi lệnh vào app đang chạy. Named pipe không mở ra mạng nên trang web không gọi vào được.
// Giao thức: một dòng JSON yêu cầu -> một dòng JSON trả lời.
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeServer, ServerOptions};
use tokio::sync::oneshot;

use crate::app::{Core, Prompt};
use crate::engine::{aria2, http, AddOptions};
use crate::util;

/// Phải trùng với tên trong src/bin/host.rs.
pub fn pipe_name() -> String {
    format!(r"\\.\pipe\mydownloader-{}", std::env::var("USERNAME").unwrap_or_default())
}

/// Tạo pipe đầu tiên; lỗi nghĩa là đã có một MyDownloader khác đang chạy.
pub fn claim() -> std::io::Result<NamedPipeServer> {
    ServerOptions::new().first_pipe_instance(true).create(pipe_name())
}

/// Lần mở thứ hai: nhờ bản đang chạy hiện cửa sổ.
pub async fn send(req: Value) -> std::io::Result<Value> {
    let pipe = loop {
        match ClientOptions::new().open(pipe_name()) {
            Ok(p) => break p,
            Err(e) if e.raw_os_error() == Some(231) => tokio::time::sleep(Duration::from_millis(50)).await,
            Err(e) => return Err(e),
        }
    };
    let (r, mut w) = tokio::io::split(pipe);
    w.write_all(format!("{req}\n").as_bytes()).await?;
    let mut line = String::new();
    BufReader::new(r).read_line(&mut line).await?;
    serde_json::from_str(&line).map_err(std::io::Error::other)
}

pub async fn serve(mut server: NamedPipeServer, core: Arc<Core>) {
    loop {
        let connected = server.connect().await;
        let conn = server;
        server = match ServerOptions::new().create(pipe_name()) {
            Ok(s) => s,
            Err(e) => {
                util::log(&format!("Không tạo được pipe mới, ngừng nhận lệnh từ extension: {e}"));
                return;
            }
        };
        if let Err(e) = connected {
            util::log(&format!("Pipe connect lỗi: {e}"));
            continue;
        }
        let core = core.clone();
        tokio::spawn(async move {
            if let Err(e) = handle(conn, core).await {
                util::log(&format!("Lỗi xử lý lệnh pipe: {e}"));
            }
        });
    }
}

async fn handle(conn: NamedPipeServer, core: Arc<Core>) -> std::io::Result<()> {
    let (r, mut w) = tokio::io::split(conn);
    let mut line = String::new();
    BufReader::new(r.take(4 << 20)).read_line(&mut line).await?;
    let req: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
    let resp = match req["cmd"].as_str().unwrap_or("") {
        "ping" => json!({"ok": true, "running": true, "version": env!("CARGO_PKG_VERSION")}),
        "show" => {
            util::show_main_window();
            core.repaint();
            json!({"ok": true})
        }
        "add" => add(&core, &req).await,
        other => json!({"ok": false, "error": format!("Lệnh không hỗ trợ: {other}")}),
    };
    w.write_all(format!("{resp}\n").as_bytes()).await?;
    w.flush().await
}

/// Link từ trình duyệt. `wait` = extension đang tạm dừng download của trình duyệt và chờ
/// người dùng quyết định: trả "started" (trình duyệt hủy bản của nó) hoặc "cancelled" (trình duyệt tải tiếp).
async fn add(core: &Arc<Core>, req: &Value) -> Value {
    let s = |k: &str| req[k].as_str().unwrap_or("").trim().to_string();
    let url = s("url");
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://") || aria2::handles(&url)) {
        return json!({"ok": false, "error": "Liên kết không hợp lệ"});
    }
    let mut headers = HashMap::new();
    for (key, name) in [("referrer", "Referer"), ("cookie", "Cookie"), ("userAgent", "User-Agent")] {
        let v = s(key);
        if !v.is_empty() {
            headers.insert(name.to_string(), v);
        }
    }
    // Tên từ trình duyệt có thể kèm đường dẫn: chỉ giữ tên tệp
    let filename = s("filename").rsplit(['\\', '/']).next().map(http::sanitize_filename).filter(|n| n != "download");
    let wait = req["wait"].as_bool().unwrap_or(false);
    let st = core.settings();
    let en = st.en();

    if let Some(name) = core.mgr.active_url(&url) {
        core.notice(if en { format!("Already downloading: {name}") } else { format!("Liên kết đang được tải: {name}") });
        return json!({"ok": true, "action": "duplicate"});
    }
    if st.auto_download_from_extension {
        let opts = AddOptions { dir: st.download_dir.clone(), filename, headers, threads: st.threads };
        core.mgr.add(&url, &opts);
        core.notice(if en { "Added a link from the browser".into() } else { "Đã nhận link từ trình duyệt".into() });
        return json!({"ok": true, "action": "started"});
    }

    let (tx, rx) = oneshot::channel();
    core.push_prompt(Prompt { url, filename, headers, reply: wait.then_some(tx) });
    if !wait {
        return json!({"ok": true, "action": "prompted"});
    }
    // Hết giờ thì UI tự bỏ hộp thoại này (kênh trả lời đã đóng) để không tải trùng với trình duyệt
    match tokio::time::timeout(Duration::from_secs(110), rx).await {
        Ok(Ok(action)) => json!({"ok": true, "action": action}),
        _ => json!({"ok": true, "action": "timeout"}),
    }
}

// Native messaging host: Chrome/Edge chạy tiến trình này khi extension gọi connectNative.
// Nhận tin nhắn (4 byte độ dài + JSON) từ stdin, chuyển sang MyDownloader qua named pipe,
// trả kết quả về stdout. App chưa chạy thì tự mở app (ẩn ở khay) rồi chuyển tiếp.
use std::fs::{File, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// Phải trùng với ipc::pipe_name() của app.
fn pipe_name() -> String {
    format!(r"\\.\pipe\mydownloader-{}", std::env::var("USERNAME").unwrap_or_default())
}

fn read_msg(r: &mut impl Read) -> io::Result<Option<Value>> {
    let mut len = [0u8; 4];
    match r.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let n = u32::from_le_bytes(len) as usize;
    if n > 8 << 20 {
        return Err(io::Error::other("tin nhắn quá lớn"));
    }
    let mut buf = vec![0; n];
    r.read_exact(&mut buf)?;
    Ok(Some(serde_json::from_slice(&buf).unwrap_or(Value::Null)))
}

fn write_msg(w: &mut impl Write, v: &Value) -> io::Result<()> {
    let body = serde_json::to_vec(v)?;
    w.write_all(&(body.len() as u32).to_le_bytes())?;
    w.write_all(&body)?;
    w.flush()
}

fn open_pipe() -> io::Result<File> {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match OpenOptions::new().read(true).write(true).open(pipe_name()) {
            Ok(f) => return Ok(f),
            // ERROR_PIPE_BUSY: app đang tạo pipe mới cho kết nối kế tiếp
            Err(e) if e.raw_os_error() == Some(231) && Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Err(e) => return Err(e),
        }
    }
}

fn ask(mut pipe: File, req: &Value) -> Value {
    let result = (|| {
        pipe.write_all(format!("{req}\n").as_bytes())?;
        let mut line = String::new();
        BufReader::new(pipe).read_line(&mut line)?;
        serde_json::from_str::<Value>(&line).map_err(io::Error::other)
    })();
    result.unwrap_or_else(|e| json!({"ok": false, "error": format!("MyDownloader không trả lời: {e}")}))
}

fn launch_app() -> io::Result<()> {
    let exe = std::env::current_exe()?.with_file_name("MyDownloader.exe");
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    // Không kế thừa stdin/stdout (là kênh nói chuyện với trình duyệt) và tách khỏi job của trình duyệt
    let spawn = |flags: u32| {
        Command::new(&exe)
            .arg("--background")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(flags)
            .spawn()
    };
    spawn(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB)
        .or_else(|_| spawn(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP))
        .map(drop)
}

fn handle(req: &Value) -> Value {
    if let Ok(pipe) = open_pipe() {
        return ask(pipe, req);
    }
    if req["cmd"] == "ping" {
        return json!({"ok": true, "running": false, "version": env!("CARGO_PKG_VERSION")});
    }
    if let Err(e) = launch_app() {
        return json!({"ok": false, "error": format!("Không mở được MyDownloader: {e}")});
    }
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(250));
        if let Ok(pipe) = open_pipe() {
            return ask(pipe, req);
        }
    }
    json!({"ok": false, "error": "MyDownloader không khởi động kịp"})
}

fn main() {
    // Trình duyệt (đang ở foreground) mở host: chuyển quyền đưa cửa sổ lên trước cho app,
    // để hộp thoại xác nhận hiện đè lên trình duyệt thay vì chỉ nháy trên thanh tác vụ
    unsafe { windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(u32::MAX) };
    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();
    while let Ok(Some(req)) = read_msg(&mut stdin) {
        if write_msg(&mut stdout, &handle(&req)).is_err() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framing_roundtrip() {
        let mut buf = Vec::new();
        write_msg(&mut buf, &json!({"cmd": "ping"})).unwrap();
        assert_eq!(&buf[..4], &(buf.len() as u32 - 4).to_le_bytes());
        let mut r = io::Cursor::new(buf);
        assert_eq!(read_msg(&mut r).unwrap().unwrap()["cmd"], "ping");
        assert!(read_msg(&mut r).unwrap().is_none());
    }
}

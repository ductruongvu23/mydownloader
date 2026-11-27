// Tải Torrent / Magnet / FTP qua aria2c (JSON-RPC). aria2c.exe tìm cạnh MyDownloader.exe
// hoặc trong PATH (cả PATH lưu trong registry), chỉ khởi động khi có tác vụ cần.
use std::ffi::OsString;
use std::hash::{BuildHasher, Hasher};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::Ordering::Relaxed;
use std::time::Duration;

use reqwest::Client;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::http::{DlError, Info, Outcome, Params, Progress};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn handles(url: &str) -> bool {
    let l = url.trim().to_ascii_lowercase();
    l.starts_with("magnet:") || l.starts_with("ftp://") || l.ends_with(".torrent") || l.contains(".torrent?")
}

/// Thay %TEN% bằng biến môi trường (PATH trong registry có thể dạng REG_EXPAND_SZ).
fn expand_env(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        match after.find('%') {
            Some(j) => {
                let name = &after[..j];
                out.push_str(&std::env::var(name).unwrap_or_else(|_| format!("%{name}%")));
                rest = &after[j + 1..];
            }
            None => {
                out.push_str(&rest[i..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

pub(crate) fn find_aria2() -> Option<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    // PATH của tiến trình có thể cũ (trình duyệt mở app trước khi cài aria2): đọc thêm PATH trong registry
    let mut paths: Vec<OsString> = std::env::var_os("PATH").into_iter().collect();
    for (root, key) in [
        (HKEY_CURRENT_USER, "Environment"),
        (HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
    ] {
        if let Ok(p) = RegKey::predef(root).open_subkey(key).and_then(|k| k.get_value::<String, _>("Path")) {
            paths.push(expand_env(&p).into());
        }
    }
    std::iter::once(crate::util::exe_dir())
        .chain(paths.iter().flat_map(std::env::split_paths))
        .map(|d| d.join("aria2c.exe"))
        .find(|p| p.is_file())
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= c.len() {
                out.push(T[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

struct Rpc {
    port: u16,
    secret: String,
    child: Child,
}

#[derive(Default)]
pub struct Aria2 {
    rpc: tokio::sync::Mutex<Option<Rpc>>,
}

impl Aria2 {
    async fn endpoint(&self) -> Result<(u16, String), DlError> {
        let mut guard = self.rpc.lock().await;
        if let Some(r) = guard.as_mut() {
            if matches!(r.child.try_wait(), Ok(None)) {
                return Ok((r.port, r.secret.clone()));
            }
        }
        let exe = find_aria2().ok_or_else(|| {
            DlError::fatal("Cần aria2c.exe để tải Torrent/Magnet/FTP: đặt aria2c.exe cạnh MyDownloader.exe hoặc thêm vào PATH.")
        })?;
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .and_then(|l| l.local_addr())
            .map(|a| a.port())
            .map_err(|e| DlError::fatal(format!("Không mở được cổng cho aria2: {e}")))?;
        let secret = format!("{:x}", std::collections::hash_map::RandomState::new().build_hasher().finish());
        let child = Command::new(exe)
            .args([
                "--enable-rpc",
                &format!("--rpc-listen-port={port}"),
                &format!("--rpc-secret={secret}"),
                "--rpc-listen-all=false",
                "--continue=true",
                "--seed-time=0",
                "--file-allocation=none",
                "--max-connection-per-server=16",
                "--split=16",
                &format!("--stop-with-process={}", std::process::id()),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| DlError::fatal(format!("Không chạy được aria2c: {e}")))?;
        for _ in 0..50 {
            if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        *guard = Some(Rpc { port, secret: secret.clone(), child });
        Ok((port, secret))
    }

    async fn call(&self, client: &Client, method: &str, params: Vec<Value>) -> Result<Value, DlError> {
        let (port, secret) = self.endpoint().await?;
        let mut all = vec![json!(format!("token:{secret}"))];
        all.extend(params);
        let body = json!({"jsonrpc": "2.0", "id": "1", "method": method, "params": all});
        let resp: Value = client
            .post(format!("http://127.0.0.1:{port}/jsonrpc"))
            .json(&body)
            // aria2 có thể treo (ổ đĩa nghẽn): không chờ mãi
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| DlError::retry(format!("aria2 không phản hồi: {e}")))?
            .json()
            .await
            .map_err(|e| DlError::retry(format!("aria2 trả dữ liệu lỗi: {e}")))?;
        if let Some(err) = resp.get("error") {
            return Err(DlError::fatal(format!("aria2: {}", err["message"].as_str().unwrap_or("lỗi"))));
        }
        Ok(resp["result"].clone())
    }

    pub async fn download(
        &self,
        client: &Client,
        p: &Params,
        progress: &Progress,
        cancel: &CancellationToken,
        on_info: impl Fn(Info),
    ) -> Result<Outcome, DlError> {
        let mut opts = json!({ "dir": p.dir.to_string_lossy() });
        if let Some(name) = p.filename.as_deref().filter(|n| !n.is_empty()) {
            opts["out"] = json!(name);
        }
        let local = Path::new(p.url.trim());
        let gid = if local.is_file() {
            let data = std::fs::read(local).map_err(|e| DlError::fatal(format!("Không đọc được tệp torrent: {e}")))?;
            self.call(client, "aria2.addTorrent", vec![json!(base64(&data)), json!([]), opts]).await?
        } else {
            self.call(client, "aria2.addUri", vec![json!([p.url.trim()]), opts]).await?
        };
        let mut gid = gid.as_str().unwrap_or_default().to_string();
        let result = self.watch(client, p, progress, cancel, &on_info, &mut gid).await;
        // Tạm dừng / xóa / lỗi: phải chắc chắn aria2 thôi tải, nếu không nó tải ngầm và chiếm băng thông
        if !matches!(result, Ok(Outcome::Completed { .. })) {
            self.stop(client, &gid).await;
        }
        result
    }

    /// Gỡ tác vụ khỏi aria2 (giữ tệp + .aria2 để lần sau tải tiếp); aria2 không trả lời thì tắt hẳn tiến trình.
    async fn stop(&self, client: &Client, gid: &str) {
        if self.call(client, "aria2.forceRemove", vec![json!(gid)]).await.is_err() {
            if let Some(mut rpc) = self.rpc.lock().await.take() {
                crate::util::log("aria2 không phản hồi khi dừng tác vụ: tắt tiến trình aria2");
                let _ = rpc.child.kill();
            }
        }
    }

    async fn watch(
        &self,
        client: &Client,
        p: &Params,
        progress: &Progress,
        cancel: &CancellationToken,
        on_info: &impl Fn(Info),
        gid: &mut String,
    ) -> Result<Outcome, DlError> {
        let mut last_info = (String::new(), 0u64);
        loop {
            tokio::select! {
                _ = cancel.cancelled() => return Ok(Outcome::Cancelled),
                _ = tokio::time::sleep(Duration::from_secs(1)) => {}
            }
            let s = self.call(client, "aria2.tellStatus", vec![json!(gid)]).await?;
            let num = |k: &str| s[k].as_str().and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
            let (done, total) = (num("completedLength"), num("totalLength"));
            progress.downloaded.store(done, Relaxed);
            progress.size.store(total, Relaxed);
            progress.connections.store(num("connections") as u32, Relaxed);
            let name = s["bittorrent"]["info"]["name"]
                .as_str()
                .map(str::to_string)
                .or_else(|| {
                    s["files"][0]["path"].as_str().and_then(|f| Path::new(f).file_name()).map(|n| n.to_string_lossy().into_owned())
                })
                .unwrap_or_default();
            // Chỉ báo khi tên/dung lượng đổi (mỗi lần báo là một lần ghi tasks.json)
            if !name.is_empty() && last_info != (name.clone(), total) {
                last_info = (name.clone(), total);
                on_info(Info { dest: p.dir.join(&name), name: name.clone(), size: total });
            }
            match s["status"].as_str() {
                // magnet: gid đầu chỉ tải metadata, tệp thật nằm ở gid "followedBy"
                Some("complete") => match s["followedBy"][0].as_str() {
                    Some(next) => *gid = next.to_string(),
                    None => return Ok(Outcome::Completed { dest: p.dir.join(name), size: total }),
                },
                Some("error") => {
                    return Err(DlError::fatal(format!("aria2: {}", s["errorMessage"].as_str().unwrap_or("lỗi tải"))))
                }
                Some("removed") => return Ok(Outcome::Cancelled),
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_reference() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn expands_env_vars() {
        std::env::set_var("MYDL_TEST_DIR", r"C:\x");
        assert_eq!(expand_env(r"%MYDL_TEST_DIR%\bin;D:\y"), r"C:\x\bin;D:\y");
        assert_eq!(expand_env("%NO_SUCH_VAR_MYDL%;a%"), "%NO_SUCH_VAR_MYDL%;a%");
    }

    #[test]
    fn detects_aria2_links() {
        assert!(handles("magnet:?xt=urn:btih:abc"));
        assert!(handles("https://x/a.torrent?t=1"));
        assert!(handles("ftp://host/file"));
        assert!(!handles("https://x/a.zip"));
    }
}

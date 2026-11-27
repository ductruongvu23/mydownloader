// Kiểm thử engine với máy chủ HTTP giả lập chạy cục bộ: Range, không Range, đứt kết nối,
// treo kết nối, tạm dừng rồi tiếp tục, tên tệp Unicode, 404 và giới hạn tốc độ.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;

use super::http::{download, meta_path, DlError, Outcome, Params, Progress, RateLimiter};

fn byte_at(i: u64) -> u8 {
    (i.wrapping_mul(31).wrapping_add(7) % 256) as u8
}

#[derive(Default)]
struct Server {
    served: AtomicU64,
    /// số yêu cầu tải dữ liệu đã nhận theo đường dẫn
    hits: Mutex<HashMap<String, u32>>,
}

async fn handle(mut s: TcpStream, st: Arc<Server>) {
    let mut req = Vec::new();
    let mut tmp = [0u8; 2048];
    while !req.windows(4).any(|w| w == b"\r\n\r\n") {
        match s.read(&mut tmp).await {
            Ok(0) | Err(_) => return,
            Ok(n) => req.extend_from_slice(&tmp[..n]),
        }
    }
    let text = String::from_utf8_lossy(&req).to_string();
    let target = text.split_whitespace().nth(1).unwrap_or("/").to_string();
    let (path, query) = target.split_once('?').unwrap_or((&target, ""));
    let q: HashMap<&str, &str> = query.split('&').filter_map(|kv| kv.split_once('=')).collect();
    let size: u64 = q.get("size").and_then(|v| v.parse().ok()).unwrap_or(1024 * 1024);
    let range = text
        .lines()
        .find_map(|l| l.to_ascii_lowercase().strip_prefix("range: bytes=").map(str::to_string))
        .and_then(|r| {
            let (a, b) = r.split_once('-')?;
            let a: u64 = a.trim().parse().ok()?;
            let b: u64 = b.trim().parse().unwrap_or(size - 1).min(size - 1);
            Some((a, b))
        });

    let mut head = String::new();
    let (start, end, mut stop_at) = match (path, range) {
        ("/404", _) => {
            let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
            return;
        }
        ("/norange", _) | (_, None) => {
            head.push_str(&format!("HTTP/1.1 200 OK\r\nContent-Length: {size}\r\n"));
            (0, size - 1, None)
        }
        (_, Some((a, b))) => {
            head.push_str(&format!(
                "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {a}-{b}/{size}\r\nContent-Length: {}\r\nETag: \"v1\"\r\n",
                b - a + 1
            ));
            (a, b, None)
        }
    };
    if path == "/cd" {
        head.push_str("Content-Disposition: attachment; filename*=UTF-8''t%E1%BB%87p%20m%E1%BA%ABu.bin\r\n");
    }
    // Hai yêu cầu dữ liệu đầu tiên: /flaky đứt giữa chừng, /stallonce treo giữa chừng
    let failing = (path == "/flaky" || path == "/stallonce") && end > start + 1 && {
        let mut hits = st.hits.lock().unwrap();
        let n = hits.entry(path.to_string()).or_insert(0);
        *n += 1;
        *n <= 2
    };
    if failing {
        stop_at = Some(start + (end - start) / 2);
    }
    head.push_str("Connection: close\r\n\r\n");
    if s.write_all(head.as_bytes()).await.is_err() {
        return;
    }
    let slow = path == "/slow";
    let mut pos = start;
    while pos <= end {
        if stop_at.is_some_and(|x| pos >= x) {
            if path == "/stallonce" {
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
            return;
        }
        let n = (16 * 1024).min(end - pos + 1);
        let chunk: Vec<u8> = (pos..pos + n).map(byte_at).collect();
        if s.write_all(&chunk).await.is_err() {
            return;
        }
        st.served.fetch_add(n, Relaxed);
        pos += n;
        if slow {
            tokio::time::sleep(Duration::from_millis(15)).await;
        }
    }
}

async fn start_server() -> (String, Arc<Server>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let st = Arc::new(Server::default());
    let st2 = st.clone();
    tokio::spawn(async move {
        loop {
            let Ok((s, _)) = listener.accept().await else { return };
            tokio::spawn(handle(s, st2.clone()));
        }
    });
    (base, st)
}

fn temp_dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("mydl-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn params(url: String, dir: &Path, threads: usize) -> Params {
    Params { url, dir: dir.to_path_buf(), dest: None, filename: None, headers: HashMap::new(), threads }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().http1_only().build().unwrap()
}

async fn run(p: Params, limiter: Arc<RateLimiter>, cancel: CancellationToken) -> Result<Outcome, DlError> {
    download(client(), p, Arc::new(Progress::default()), limiter, cancel, |_| {}).await
}

fn assert_content(path: &Path, size: u64) {
    let data = std::fs::read(path).unwrap();
    assert_eq!(data.len() as u64, size, "sai kích thước {}", path.display());
    if let Some(i) = data.iter().enumerate().position(|(i, &b)| b != byte_at(i as u64)) {
        panic!("sai dữ liệu tại byte {i} của {}", path.display());
    }
}

fn completed(r: Result<Outcome, DlError>) -> (PathBuf, u64) {
    match r {
        Ok(Outcome::Completed { dest, size }) => (dest, size),
        other => panic!("mong đợi tải xong, nhận {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn multi_segment_download_is_byte_exact() {
    let (base, _) = start_server().await;
    let dir = temp_dir("multi");
    let size = 6 * 1024 * 1024 + 123;
    let (dest, got) = completed(run(params(format!("{base}/data.bin?size={size}"), &dir, 8), Arc::new(RateLimiter::new(0)), CancellationToken::new()).await);
    assert_eq!(got, size);
    assert_eq!(dest.file_name().unwrap(), "data.bin");
    assert_content(&dest, size);
    assert!(!meta_path(&dest).exists(), "xong rồi phải xóa .part.json");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn server_without_range_falls_back_to_single_stream() {
    let (base, _) = start_server().await;
    let dir = temp_dir("norange");
    let size = 3 * 1024 * 1024;
    let (dest, _) = completed(run(params(format!("{base}/norange?size={size}"), &dir, 8), Arc::new(RateLimiter::new(0)), CancellationToken::new()).await);
    assert_content(&dest, size);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn dropped_and_stalled_connections_are_retried() {
    let (base, _) = start_server().await;
    let dir = temp_dir("flaky");
    let size = 2 * 1024 * 1024;
    let (dest, _) = completed(run(params(format!("{base}/flaky?size={size}"), &dir, 4), Arc::new(RateLimiter::new(0)), CancellationToken::new()).await);
    assert_content(&dest, size);
    let started = Instant::now();
    let (dest, _) = completed(run(params(format!("{base}/stallonce?size={size}"), &dir, 1), Arc::new(RateLimiter::new(0)), CancellationToken::new()).await);
    assert_content(&dest, size);
    assert!(started.elapsed() >= Duration::from_secs(2), "phải chờ hết thời gian treo rồi mới thử lại");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pause_then_resume_continues_from_saved_progress() {
    let (base, st) = start_server().await;
    let dir = temp_dir("resume");
    let size: u64 = 6 * 1024 * 1024;
    let url = format!("{base}/slow?size={size}");
    let cancel = CancellationToken::new();
    let c2 = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1500)).await;
        c2.cancel();
    });
    let dest_seen = Arc::new(Mutex::new(None));
    let d2 = dest_seen.clone();
    let r = download(client(), params(url.clone(), &dir, 4), Arc::new(Progress::default()), Arc::new(RateLimiter::new(0)), cancel, move |i| {
        *d2.lock().unwrap() = Some(i.dest)
    })
    .await;
    assert!(matches!(r, Ok(Outcome::Cancelled)), "{r:?}");
    let dest = dest_seen.lock().unwrap().clone().unwrap();
    assert!(meta_path(&dest).exists(), "tạm dừng phải lưu tiến độ");
    let first_run = st.served.load(Relaxed);
    assert!(first_run > 0 && first_run < size, "lần đầu tải được {first_run} byte");

    let mut p = params(url, &dir, 4);
    p.dest = Some(dest.clone());
    let (dest, _) = completed(run(p, Arc::new(RateLimiter::new(0)), CancellationToken::new()).await);
    assert_content(&dest, size);
    let total = st.served.load(Relaxed);
    assert!(total < size + size / 4, "tải tiếp không được tải lại từ đầu: tổng {total} / {size}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn unicode_name_and_no_overwrite() {
    let (base, _) = start_server().await;
    let dir = temp_dir("unicode");
    let url = format!("{base}/cd?size=70000");
    let (a, _) = completed(run(params(url.clone(), &dir, 2), Arc::new(RateLimiter::new(0)), CancellationToken::new()).await);
    let (b, _) = completed(run(params(url, &dir, 2), Arc::new(RateLimiter::new(0)), CancellationToken::new()).await);
    assert_eq!(a.file_name().unwrap(), "tệp mẫu.bin");
    assert_eq!(b.file_name().unwrap(), "tệp mẫu (1).bin");
    assert_content(&a, 70000);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn not_found_is_a_clear_fatal_error() {
    let (base, _) = start_server().await;
    let dir = temp_dir("404");
    let err = run(params(format!("{base}/404"), &dir, 4), Arc::new(RateLimiter::new(0)), CancellationToken::new()).await.unwrap_err();
    assert!(err.fatal && err.msg.contains("404"), "{err}");
    assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0, "lỗi thì không để lại tệp rác");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn speed_limit_is_respected() {
    let (base, _) = start_server().await;
    let dir = temp_dir("limit");
    let size = 1024 * 1024;
    let started = Instant::now();
    let (dest, _) = completed(run(params(format!("{base}/x.bin?size={size}"), &dir, 4), Arc::new(RateLimiter::new(512 * 1024)), CancellationToken::new()).await);
    let secs = started.elapsed().as_secs_f64();
    assert!(secs >= 1.6, "1 MB ở 512 KB/s phải mất ~2 giây, đo được {secs:.2}s");
    assert_content(&dest, size);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn aria2_downloads_and_cancels() {
    if super::aria2::find_aria2().is_none() {
        eprintln!("bỏ qua: máy không có aria2c.exe");
        return;
    }
    let (base, _) = start_server().await;
    let dir = temp_dir("aria2");
    let a2 = super::aria2::Aria2::default();
    let size = 3 * 1024 * 1024 + 7;
    let p = params(format!("{base}/a2.bin?size={size}"), &dir, 4);
    let names = Arc::new(Mutex::new(Vec::new()));
    let n2 = names.clone();
    let r = a2.download(&client(), &p, &Progress::default(), &CancellationToken::new(), move |i| n2.lock().unwrap().push(i.name)).await;
    let (dest, got) = completed(r);
    assert_eq!(got, size);
    assert_content(&dest, size);
    assert!(names.lock().unwrap().iter().any(|n| n == "a2.bin"), "phải báo tên tệp cho giao diện");

    let cancel = CancellationToken::new();
    let c2 = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(2500)).await;
        c2.cancel();
    });
    let p = params(format!("{base}/slow?size={}", 50 * 1024 * 1024), &dir, 4);
    let r = a2.download(&client(), &p, &Progress::default(), &cancel, |_| {}).await;
    assert!(matches!(r, Ok(Outcome::Cancelled)), "{r:?}");
    // Hủy rồi thì aria2 phải thôi tải thật (trước đây nó tải ngầm, chiếm hết băng thông)
    let size = || std::fs::metadata(dir.join("slow")).map(|m| m.len()).unwrap_or(0);
    // chờ aria2 xả nốt bộ đệm ghi (dữ liệu đã nhận trước khi hủy)
    tokio::time::sleep(Duration::from_secs(1)).await;
    let before = size();
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert_eq!(size(), before, "aria2 vẫn ghi tiếp sau khi đã hủy");
}

// Engine tải HTTP/HTTPS đa luồng:
// - Thăm dò Range, tự chuyển về tải đơn luồng khi máy chủ không hỗ trợ
// - Số luồng thích ứng theo dung lượng, luồng xong sớm chia việc với luồng chậm
// - Retry từng đoạn với backoff, phát hiện kết nối treo (30 giây không có dữ liệu)
// - Lưu tiến độ ra <tệp>.part.json để tiếp tục sau khi tạm dừng hoặc tắt app
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE,
    CONTENT_TYPE, ETAG, IF_RANGE, LAST_MODIFIED, ORIGIN, RANGE, REFERER,
};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

pub const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const MIN_SPLIT: u64 = 512 * 1024;
const MIN_STEAL: u64 = 256 * 1024;
const FLUSH_AT: usize = 512 * 1024;
const MAX_RETRIES: u32 = 8;
// Test dùng 2 giây để kiểm tra phát hiện kết nối treo mà không chờ lâu
const STALL: Duration = Duration::from_secs(if cfg!(test) { 2 } else { 30 });
const UNKNOWN: u64 = u64::MAX;

#[derive(Default)]
pub struct Progress {
    pub downloaded: AtomicU64,
    pub size: AtomicU64,
    pub connections: AtomicU32,
}

/// Giới hạn tốc độ dùng chung cho mọi luồng của mọi tác vụ.
pub struct RateLimiter {
    limit: AtomicU64,
    next: Mutex<Instant>,
}

impl RateLimiter {
    pub fn new(bytes_per_sec: u64) -> Self {
        Self { limit: AtomicU64::new(bytes_per_sec), next: Mutex::new(Instant::now()) }
    }

    pub fn set(&self, bytes_per_sec: u64) {
        self.limit.store(bytes_per_sec, Relaxed);
    }

    pub async fn take(&self, n: usize) {
        let limit = self.limit.load(Relaxed);
        if limit == 0 {
            return;
        }
        let wait = {
            let mut next = self.next.lock().unwrap();
            let now = Instant::now();
            let slot = (*next).max(now);
            *next = slot + Duration::from_secs_f64(n as f64 / limit as f64);
            slot - now
        };
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
    }
}

#[derive(Clone, Debug)]
pub struct Params {
    pub url: String,
    pub dir: PathBuf,
    /// Có sẵn khi tiếp tục tác vụ cũ; None thì đặt tên theo máy chủ (hoặc `filename`).
    pub dest: Option<PathBuf>,
    pub filename: Option<String>,
    pub headers: HashMap<String, String>,
    pub threads: usize,
}

pub struct Info {
    pub dest: PathBuf,
    pub name: String,
    pub size: u64,
}

#[derive(Debug)]
pub enum Outcome {
    Completed { dest: PathBuf, size: u64 },
    Cancelled,
}

#[derive(Debug)]
pub struct DlError {
    pub msg: String,
    pub fatal: bool,
}

impl DlError {
    pub fn retry(msg: impl Into<String>) -> Self {
        Self { msg: msg.into(), fatal: false }
    }
    pub fn fatal(msg: impl Into<String>) -> Self {
        Self { msg: msg.into(), fatal: true }
    }
}

impl std::fmt::Display for DlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.msg)
    }
}

fn io_err(e: std::io::Error) -> DlError {
    DlError::fatal(format!("Lỗi ghi tệp: {e}"))
}

fn net_err(e: &reqwest::Error) -> DlError {
    let mut root: &dyn std::error::Error = e;
    while let Some(s) = root.source() {
        root = s;
    }
    if e.is_connect() {
        DlError::retry(format!("Không kết nối được máy chủ: {root}"))
    } else if e.is_timeout() {
        DlError::retry("Hết thời gian chờ máy chủ")
    } else if e.is_builder() {
        DlError::fatal(format!("Liên kết không hợp lệ: {root}"))
    } else {
        DlError::retry(format!("Lỗi mạng: {root}"))
    }
}

fn http_err(status: StatusCode) -> DlError {
    let code = status.as_u16();
    match code {
        401 | 403 => DlError::fatal(format!(
            "Máy chủ từ chối truy cập (HTTP {code}). Liên kết có thể đã hết hạn hoặc cần đăng nhập."
        )),
        404 | 410 => DlError::fatal(format!("Không tìm thấy tệp trên máy chủ (HTTP {code}).")),
        408 | 429 => DlError::retry(format!("Máy chủ đang bận (HTTP {code}).")),
        400..=499 => DlError::fatal(format!("Máy chủ từ chối yêu cầu (HTTP {code}).")),
        500..=599 => DlError::retry(format!("Máy chủ đang lỗi (HTTP {code}).")),
        _ => DlError::fatal(format!("Phản hồi không mong đợi (HTTP {code}).")),
    }
}

fn host_is(url: &Url, domains: &[&str]) -> bool {
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    domains.iter().any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

const TIKTOK: &[&str] = &["tiktok.com", "byteoversea.com", "ibytedtos.com", "tiktokcdn.com", "tiktokcdn-us.com"];

/// Bỏ tham số chia đoạn của googlevideo để tải trọn tệp.
fn normalize_url(raw: &str) -> String {
    let Ok(mut u) = Url::parse(raw) else { return raw.to_string() };
    if host_is(&u, &["googlevideo.com"]) && u.query_pairs().any(|(k, _)| k == "range") {
        let kept: Vec<(String, String)> = u
            .query_pairs()
            .filter(|(k, _)| !matches!(k.as_ref(), "range" | "rn" | "rbuf"))
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        u.query_pairs_mut().clear().extend_pairs(kept);
    }
    u.to_string()
}

fn build_headers(p: &Params, url: &str) -> HeaderMap {
    let mut h = HeaderMap::new();
    for (k, v) in &p.headers {
        if let (Ok(k), Ok(v)) = (HeaderName::from_bytes(k.trim().as_bytes()), HeaderValue::from_bytes(v.trim().as_bytes())) {
            if !v.is_empty() {
                h.insert(k, v);
            }
        }
    }
    if let Ok(u) = Url::parse(url) {
        // CDN video thường chặn khi thiếu Referer của trang gốc
        let referer = if host_is(&u, &["googlevideo.com"]) {
            Some("https://www.youtube.com/")
        } else if host_is(&u, TIKTOK) {
            Some("https://www.tiktok.com/")
        } else if host_is(&u, &["fbcdn.net", "facebook.com", "cdninstagram.com", "instagram.com"]) {
            Some("https://www.facebook.com/")
        } else if host_is(&u, &["twimg.com", "twitter.com", "x.com"]) {
            Some("https://x.com/")
        } else {
            None
        };
        if let Some(r) = referer {
            h.entry(REFERER).or_insert(HeaderValue::from_static(r));
        }
        if host_is(&u, TIKTOK) {
            h.entry(ORIGIN).or_insert(HeaderValue::from_static("https://www.tiktok.com"));
        }
    }
    h
}

fn header_str(h: &HeaderMap, name: HeaderName) -> Option<String> {
    h.get(name).map(|v| String::from_utf8_lossy(v.as_bytes()).trim().to_string())
}

fn percent_decode(s: &str) -> String {
    percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned()
}

/// Tên tệp trong Content-Disposition (ưu tiên filename*=UTF-8''...).
pub fn parse_content_disposition(cd: &str) -> Option<String> {
    let lower = cd.to_ascii_lowercase();
    if let Some(i) = lower.find("filename*=") {
        let v = cd[i + 10..].split(';').next().unwrap_or("").trim().trim_matches('"');
        let parts: Vec<&str> = v.splitn(3, '\'').collect();
        let v = if parts.len() == 3 { parts[2] } else { v };
        let name = percent_decode(v);
        if !name.trim().is_empty() {
            return Some(name);
        }
    }
    let i = lower.find("filename=")?;
    let v = cd[i + 9..].split(';').next()?.trim().trim_matches('"');
    let name = if v.contains('%') { percent_decode(v) } else { v.to_string() };
    (!name.trim().is_empty()).then_some(name)
}

/// Bỏ ký tự Windows không cho phép, giữ đuôi tệp khi phải cắt ngắn.
pub fn sanitize_filename(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c < ' ' || r#"\/:*?"<>|"#.contains(c) { '_' } else { c })
        .collect();
    let s = s.trim().trim_start_matches('.').trim_end_matches(['.', ' ']);
    let mut s = s.to_string();
    if s.chars().count() > 180 {
        let ext = Path::new(&s)
            .extension()
            .map(|e| e.to_string_lossy().into_owned())
            .filter(|e| e.chars().count() <= 10);
        let keep = 180 - ext.as_ref().map_or(0, |e| e.chars().count() + 1);
        let stem: String = s.chars().take(keep).collect();
        s = match ext {
            Some(e) => format!("{}.{e}", stem.trim_end_matches(['.', ' '])),
            None => stem,
        };
    }
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if s.is_empty() {
        "download".into()
    } else if RESERVED.contains(&stem.as_str()) {
        format!("_{s}")
    } else {
        s
    }
}

fn ext_for_content_type(ct: &str) -> Option<&'static str> {
    let ct = ct.to_ascii_lowercase();
    let map: [(&str, &str); 15] = [
        ("video/mp4", "mp4"),
        ("video/webm", "webm"),
        ("video/quicktime", "mov"),
        ("video/x-matroska", "mkv"),
        ("audio/mpeg", "mp3"),
        ("audio/mp3", "mp3"),
        ("audio/mp4", "m4a"),
        ("audio/ogg", "ogg"),
        ("image/jpeg", "jpg"),
        ("image/png", "png"),
        ("image/webp", "webp"),
        ("application/pdf", "pdf"),
        ("application/zip", "zip"),
        ("application/x-msdownload", "exe"),
        ("application/vnd.android.package-archive", "apk"),
    ];
    map.iter().find(|(k, _)| ct.starts_with(k)).map(|(_, e)| *e).or_else(|| {
        if ct.starts_with("video/") {
            Some("mp4")
        } else if ct.starts_with("audio/") {
            Some("mp3")
        } else {
            None
        }
    })
}

/// Tên tệp: Content-Disposition, rồi ?filename=, rồi đoạn cuối của URL (sau redirect).
pub fn filename_from(h: &HeaderMap, url: &Url) -> String {
    let mut name = header_str(h, CONTENT_DISPOSITION)
        .and_then(|cd| parse_content_disposition(&cd))
        .unwrap_or_default();
    if name.is_empty() {
        name = url
            .query_pairs()
            .find(|(k, _)| k == "filename" || k == "file")
            .map(|(_, v)| v.into_owned())
            .unwrap_or_default();
    }
    if name.is_empty() {
        name = url
            .path_segments()
            .and_then(|s| s.filter(|x| !x.is_empty()).last())
            .map(percent_decode)
            .unwrap_or_default();
    }
    let mut name = sanitize_filename(&name);
    if Path::new(&name).extension().is_none() {
        if let Some(ext) = header_str(h, CONTENT_TYPE).as_deref().and_then(ext_for_content_type) {
            name = format!("{name}.{ext}");
        }
    }
    name
}

pub fn meta_path(dest: &Path) -> PathBuf {
    let mut s = dest.as_os_str().to_owned();
    s.push(".part.json");
    s.into()
}

/// "ten.ext" đã có (hoặc đang tải dở) thì đổi thành "ten (1).ext", "ten (2).ext"...
pub fn unique_path(p: &Path) -> PathBuf {
    let taken = |c: &Path| c.exists() || meta_path(c).exists();
    if !taken(p) {
        return p.to_path_buf();
    }
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (1..)
        .map(|i| p.with_file_name(format!("{stem} ({i}){ext}")))
        .find(|c| !taken(c))
        .unwrap()
}

/// Ít luồng cho tệp nhỏ để không bị CDN chặn vì mở kết nối vô ích.
fn adaptive_threads(size: u64, max: usize) -> usize {
    let mb = 1024 * 1024;
    let n = if size < 2 * mb {
        2
    } else if size < 10 * mb {
        4
    } else if size < 50 * mb {
        8
    } else {
        max
    };
    n.min(max).max(1)
}

struct Probe {
    size: u64,
    ranges: bool,
    validator: Option<String>,
    name: String,
}

async fn send(rb: reqwest::RequestBuilder) -> Result<reqwest::Response, DlError> {
    match tokio::time::timeout(STALL, rb.send()).await {
        Ok(Ok(r)) => Ok(r),
        Ok(Err(e)) => Err(net_err(&e)),
        Err(_) => Err(DlError::retry(format!("Máy chủ không phản hồi (quá {} giây)", STALL.as_secs()))),
    }
}

async fn probe(client: &Client, url: &str, headers: &HeaderMap) -> Result<Probe, DlError> {
    let mut resp = send(client.get(url).headers(headers.clone()).header(RANGE, "bytes=0-0")).await?;
    // Có máy chủ từ chối hẳn yêu cầu có Range: thử lại không kèm Range
    if matches!(resp.status().as_u16(), 400 | 403 | 405 | 416 | 501) {
        if let Ok(r) = send(client.get(url).headers(headers.clone())).await {
            if r.status().is_success() {
                resp = r;
            }
        }
    }
    let status = resp.status();
    let h = resp.headers();
    let (size, ranges) = if status == StatusCode::PARTIAL_CONTENT {
        let total = header_str(h, CONTENT_RANGE)
            .and_then(|cr| cr.rsplit('/').next().and_then(|t| t.trim().parse::<u64>().ok()));
        match total {
            Some(t) if t > 0 => (t, true),
            _ => (UNKNOWN, false),
        }
    } else if status.is_success() {
        let len = header_str(h, CONTENT_LENGTH).and_then(|v| v.parse::<u64>().ok()).filter(|&n| n > 0);
        (len.unwrap_or(UNKNOWN), false)
    } else {
        return Err(http_err(status));
    };
    let validator = header_str(h, ETAG)
        .filter(|e| !e.starts_with("W/"))
        .or_else(|| header_str(h, LAST_MODIFIED));
    let name = filename_from(h, resp.url());
    Ok(Probe { size, ranges, validator, name })
}

#[derive(Serialize, Deserialize)]
struct Meta {
    size: u64,
    validator: Option<String>,
    segments: Vec<MetaSeg>,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
struct MetaSeg {
    start: u64,
    end: u64,
    written: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum SegState {
    Idle,
    Run,
    Done,
}

#[derive(Debug)]
struct Seg {
    start: u64,
    /// byte cuối (bao gồm); UNKNOWN khi không rõ dung lượng
    end: u64,
    /// byte kế tiếp sẽ nhận
    pos: u64,
    /// đã ghi xuống đĩa tới đây (không gồm)
    written: u64,
    state: SegState,
    retries: u32,
}

struct Shared {
    client: Client,
    url: String,
    headers: HeaderMap,
    validator: Option<String>,
    file: File,
    size: u64,
    ranges: AtomicBool,
    segs: Mutex<Vec<Seg>>,
    progress: Arc<Progress>,
    limiter: Arc<RateLimiter>,
    stop: CancellationToken,
}

impl Shared {
    /// Lấy đoạn chưa ai tải; hết thì chia đôi phần còn lại của đoạn đang chạy lâu nhất.
    fn next_segment(&self) -> Option<usize> {
        let mut segs = self.segs.lock().unwrap();
        if let Some(i) = segs.iter().position(|s| s.state == SegState::Idle) {
            segs[i].state = SegState::Run;
            return Some(i);
        }
        if !self.ranges.load(Relaxed) {
            return None;
        }
        let (i, rem) = segs
            .iter()
            .enumerate()
            .filter(|(_, s)| s.state == SegState::Run && s.end != UNKNOWN)
            .map(|(i, s)| (i, (s.end + 1).saturating_sub(s.pos)))
            .max_by_key(|&(_, rem)| rem)?;
        if rem < 2 * MIN_STEAL {
            return None;
        }
        let victim = &mut segs[i];
        let mid = victim.pos + rem / 2;
        let end = victim.end;
        victim.end = mid - 1;
        segs.push(Seg { start: mid, end, pos: mid, written: mid, state: SegState::Run, retries: 0 });
        Some(segs.len() - 1)
    }

    fn all_done(&self) -> bool {
        self.segs.lock().unwrap().iter().all(|s| s.state == SegState::Done)
    }

    fn running(&self) -> u32 {
        self.segs.lock().unwrap().iter().filter(|s| s.state == SegState::Run).count() as u32
    }

    fn save_meta(&self, path: &Path) {
        if !self.ranges.load(Relaxed) {
            return;
        }
        let segments = self
            .segs
            .lock()
            .unwrap()
            .iter()
            .map(|s| MetaSeg { start: s.start, end: s.end, written: s.written })
            .collect();
        let meta = Meta { size: self.size, validator: self.validator.clone(), segments };
        let tmp = path.with_extension("json.tmp");
        if let Ok(b) = serde_json::to_vec(&meta) {
            if std::fs::write(&tmp, b).is_ok() {
                let _ = std::fs::rename(&tmp, path);
            }
        }
    }

    fn write_at(&self, mut off: u64, mut buf: &[u8]) -> Result<(), DlError> {
        use std::os::windows::fs::FileExt;
        tokio::task::block_in_place(|| {
            while !buf.is_empty() {
                let n = self.file.seek_write(buf, off).map_err(io_err)?;
                if n == 0 {
                    return Err(DlError::fatal("Không ghi được dữ liệu xuống đĩa"));
                }
                buf = &buf[n..];
                off += n as u64;
            }
            Ok(())
        })
    }

    fn set_written(&self, idx: usize, upto: u64) {
        self.segs.lock().unwrap()[idx].written = upto;
    }
}

/// Đặt tệp ở chế độ sparse: NTFS không phải ghi số 0 cho vùng trước khi luồng sau ghi tới.
fn set_sparse(f: &File) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::Ioctl::FSCTL_SET_SPARSE;
    use windows_sys::Win32::System::IO::DeviceIoControl;
    let mut ret = 0u32;
    unsafe {
        DeviceIoControl(
            f.as_raw_handle() as _,
            FSCTL_SET_SPARSE,
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            0,
            &mut ret,
            std::ptr::null_mut(),
        );
    }
}

async fn fetch_segment(sh: &Shared, idx: usize) -> Result<(), DlError> {
    let mut from = sh.segs.lock().unwrap()[idx].pos;
    let ranges = sh.ranges.load(Relaxed);
    let mut rb = sh.client.get(&sh.url).headers(sh.headers.clone());
    if ranges {
        let to = sh.segs.lock().unwrap()[idx].end;
        rb = rb.header(RANGE, format!("bytes={from}-{to}"));
        if let Some(v) = &sh.validator {
            rb = rb.header(IF_RANGE, v.as_str());
        }
    } else {
        // Đơn luồng không tiếp tục giữa chừng được: tải lại từ đầu
        {
            let mut segs = sh.segs.lock().unwrap();
            segs[idx].pos = 0;
            segs[idx].written = 0;
        }
        from = 0;
        sh.progress.downloaded.store(0, Relaxed);
        sh.file.set_len(0).map_err(io_err)?;
    }

    let mut resp = tokio::select! {
        _ = sh.stop.cancelled() => return Ok(()),
        r = send(rb) => r?,
    };
    let status = resp.status();
    if ranges && status == StatusCode::OK {
        // Máy chủ bỏ qua Range và trả cả tệp: chuyển sang tải đơn luồng bằng chính phản hồi này
        if !sh.ranges.swap(false, Relaxed) {
            sh.segs.lock().unwrap()[idx].state = SegState::Done;
            return Ok(());
        }
        let mut segs = sh.segs.lock().unwrap();
        for (j, s) in segs.iter_mut().enumerate() {
            if j != idx {
                s.state = SegState::Done;
            }
        }
        let s = &mut segs[idx];
        s.start = 0;
        s.pos = 0;
        s.written = 0;
        s.end = if sh.size == UNKNOWN { UNKNOWN } else { sh.size - 1 };
        from = 0;
        sh.progress.downloaded.store(0, Relaxed);
    } else if ranges && status == StatusCode::PARTIAL_CONTENT {
        let start = header_str(resp.headers(), CONTENT_RANGE)
            .and_then(|cr| cr.split_whitespace().nth(1).map(str::to_string))
            .and_then(|r| r.split('-').next().and_then(|a| a.parse::<u64>().ok()));
        if start.is_some_and(|s| s != from) {
            return Err(DlError::fatal("Máy chủ trả sai đoạn dữ liệu"));
        }
    } else if ranges || !status.is_success() {
        return Err(http_err(status));
    }

    let mut buf: Vec<u8> = Vec::with_capacity(FLUSH_AT + 64 * 1024);
    let mut buf_off = from;
    let mut pos = from;
    let mut net_error: Option<DlError> = None;
    loop {
        let chunk = tokio::select! {
            _ = sh.stop.cancelled() => break,
            r = tokio::time::timeout(STALL, resp.chunk()) => r,
        };
        let bytes = match chunk {
            Err(_) => {
                net_error = Some(DlError::retry(format!("Không nhận được dữ liệu trong {} giây", STALL.as_secs())));
                break;
            }
            Ok(Err(e)) => {
                net_error = Some(net_err(&e));
                break;
            }
            Ok(Ok(None)) => break,
            Ok(Ok(Some(b))) => b,
        };
        // Đoạn có thể vừa bị luồng khác chia bớt phần đuôi: chỉ nhận tới `end` mới
        let n = {
            let mut segs = sh.segs.lock().unwrap();
            let s = &mut segs[idx];
            if s.state != SegState::Run {
                break;
            }
            let remain = if s.end == UNKNOWN { u64::MAX } else { (s.end + 1).saturating_sub(pos) };
            let n = (bytes.len() as u64).min(remain) as usize;
            s.pos = pos + n as u64;
            n
        };
        if n == 0 {
            break;
        }
        sh.limiter.take(n).await;
        buf.extend_from_slice(&bytes[..n]);
        pos += n as u64;
        sh.progress.downloaded.fetch_add(n as u64, Relaxed);
        if buf.len() >= FLUSH_AT {
            sh.write_at(buf_off, &buf)?;
            buf_off += buf.len() as u64;
            buf.clear();
            sh.set_written(idx, buf_off);
        }
        if n < bytes.len() {
            break;
        }
    }
    sh.write_at(buf_off, &buf)?;
    sh.set_written(idx, pos);
    if let Some(e) = net_error {
        return Err(e);
    }
    if sh.stop.is_cancelled() {
        return Ok(());
    }
    let mut segs = sh.segs.lock().unwrap();
    let s = &mut segs[idx];
    if s.state == SegState::Run {
        if s.end != UNKNOWN && pos <= s.end {
            return Err(DlError::retry("Kết nối bị ngắt trước khi nhận đủ dữ liệu"));
        }
        s.state = SegState::Done;
    }
    Ok(())
}

async fn worker(sh: Arc<Shared>) -> Result<(), DlError> {
    loop {
        if sh.stop.is_cancelled() {
            return Ok(());
        }
        let Some(idx) = sh.next_segment() else {
            if sh.all_done() {
                return Ok(());
            }
            tokio::select! {
                _ = sh.stop.cancelled() => return Ok(()),
                _ = tokio::time::sleep(Duration::from_millis(100)) => continue,
            }
        };
        if let Err(e) = fetch_segment(&sh, idx).await {
            if sh.stop.is_cancelled() {
                return Ok(());
            }
            let retries = {
                let mut segs = sh.segs.lock().unwrap();
                let s = &mut segs[idx];
                s.retries += 1;
                s.pos = s.written;
                if s.state == SegState::Run {
                    s.state = SegState::Idle;
                }
                s.retries
            };
            if e.fatal || retries > MAX_RETRIES {
                return Err(e);
            }
            crate::logln!("Đoạn {idx} lỗi (lần {retries}): {e}");
            let backoff = (400.0 * 1.8f64.powi(retries as i32)).min(8000.0) as u64 + (crate::util::now_ms() % 250);
            tokio::select! {
                _ = sh.stop.cancelled() => return Ok(()),
                _ = tokio::time::sleep(Duration::from_millis(backoff)) => {}
            }
        }
    }
}

pub async fn download(
    client: Client,
    p: Params,
    progress: Arc<Progress>,
    limiter: Arc<RateLimiter>,
    cancel: CancellationToken,
    on_info: impl Fn(Info),
) -> Result<Outcome, DlError> {
    let url = normalize_url(p.url.trim());
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(DlError::fatal(
            "Chỉ tải được liên kết http/https. Liên kết blob: là bộ nhớ tạm của trình duyệt — hãy phát video để extension bắt luồng gốc.",
        ));
    }
    let headers = build_headers(&p, &url);
    let pr = tokio::select! {
        _ = cancel.cancelled() => return Ok(Outcome::Cancelled),
        r = probe(&client, &url, &headers) => r?,
    };

    let dest = match &p.dest {
        Some(d) => d.clone(),
        None => {
            std::fs::create_dir_all(&p.dir).map_err(io_err)?;
            let name = p
                .filename
                .as_deref()
                .map(sanitize_filename)
                .filter(|n| n != "download")
                .unwrap_or_else(|| pr.name.clone());
            unique_path(&p.dir.join(name))
        }
    };
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(io_err)?;
    }
    let known = pr.size != UNKNOWN;
    on_info(Info {
        dest: dest.clone(),
        name: dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        size: if known { pr.size } else { 0 },
    });

    let tiktok = Url::parse(&url).is_ok_and(|u| host_is(&u, TIKTOK));
    let threads = if !pr.ranges || tiktok { 1 } else { adaptive_threads(pr.size, p.threads.max(1)) };
    let mpath = meta_path(&dest);
    let resume = pr
        .ranges
        .then(|| std::fs::read(&mpath).ok())
        .flatten()
        .and_then(|b| serde_json::from_slice::<Meta>(&b).ok())
        .filter(|m| m.size == pr.size && m.validator == pr.validator && !m.segments.is_empty())
        .filter(|_| dest.metadata().is_ok_and(|md| md.len() == pr.size));

    let file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(&dest).map_err(io_err)?;
    let segs: Vec<Seg> = match resume {
        Some(m) => {
            crate::logln!("Tiếp tục tải {} từ tiến độ đã lưu", dest.display());
            m.segments
                .iter()
                .map(|s| Seg {
                    start: s.start,
                    end: s.end,
                    pos: s.written,
                    written: s.written,
                    state: if s.written > s.end { SegState::Done } else { SegState::Idle },
                    retries: 0,
                })
                .collect()
        }
        None if pr.ranges => {
            file.set_len(0).map_err(io_err)?;
            set_sparse(&file);
            file.set_len(pr.size).map_err(io_err)?;
            let n = (threads as u64).min((pr.size / MIN_SPLIT).max(1));
            let part = pr.size.div_ceil(n);
            (0..n)
                .map(|i| i * part)
                .filter(|&start| start < pr.size)
                .map(|start| Seg {
                    start,
                    end: (start + part - 1).min(pr.size - 1),
                    pos: start,
                    written: start,
                    state: SegState::Idle,
                    retries: 0,
                })
                .collect()
        }
        None => {
            file.set_len(0).map_err(io_err)?;
            vec![Seg {
                start: 0,
                end: if known { pr.size - 1 } else { UNKNOWN },
                pos: 0,
                written: 0,
                state: SegState::Idle,
                retries: 0,
            }]
        }
    };
    progress.downloaded.store(segs.iter().map(|s| s.written - s.start).sum(), Relaxed);
    progress.size.store(if known { pr.size } else { 0 }, Relaxed);

    let sh = Arc::new(Shared {
        client,
        url,
        headers,
        validator: pr.validator,
        file,
        size: pr.size,
        ranges: AtomicBool::new(pr.ranges),
        segs: Mutex::new(segs),
        progress: progress.clone(),
        limiter,
        stop: cancel.child_token(),
    });
    let mut set = JoinSet::new();
    for _ in 0..threads {
        set.spawn(worker(sh.clone()));
    }
    let mut failure: Option<DlError> = None;
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            r = set.join_next() => match r {
                None => break,
                Some(Ok(Ok(()))) => {}
                Some(Ok(Err(e))) => {
                    if failure.is_none() {
                        failure = Some(e);
                        sh.stop.cancel();
                    }
                }
                Some(Err(e)) => {
                    failure.get_or_insert(DlError::fatal(format!("Lỗi nội bộ: {e}")));
                    sh.stop.cancel();
                }
            },
            _ = tick.tick() => {
                progress.connections.store(sh.running(), Relaxed);
                sh.save_meta(&mpath);
            }
        }
    }
    progress.connections.store(0, Relaxed);
    if let Some(e) = failure {
        sh.save_meta(&mpath);
        return Err(e);
    }
    if cancel.is_cancelled() {
        sh.save_meta(&mpath);
        return Ok(Outcome::Cancelled);
    }
    if !sh.all_done() {
        sh.save_meta(&mpath);
        return Err(DlError::retry("Tải chưa đủ dữ liệu"));
    }
    let size = if known && sh.ranges.load(Relaxed) {
        pr.size
    } else {
        let written = sh.segs.lock().unwrap().iter().map(|s| s.written).max().unwrap_or(0);
        sh.file.set_len(written).map_err(io_err)?;
        written
    };
    let _ = std::fs::remove_file(&mpath);
    progress.downloaded.store(size, Relaxed);
    progress.size.store(size, Relaxed);
    Ok(Outcome::Completed { dest, size })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_disposition() {
        assert_eq!(
            parse_content_disposition("attachment; filename*=UTF-8''t%E1%BB%87p%20m%E1%BA%ABu.bin").as_deref(),
            Some("tệp mẫu.bin")
        );
        assert_eq!(parse_content_disposition(r#"attachment; filename="a b.zip""#).as_deref(), Some("a b.zip"));
        assert_eq!(
            parse_content_disposition(r#"attachment; filename="x.zip"; filename*=UTF-8''y.zip"#).as_deref(),
            Some("y.zip")
        );
        assert_eq!(parse_content_disposition("inline"), None);
    }

    #[test]
    fn sanitize() {
        assert_eq!(sanitize_filename(r#"a<b>:c"/d\e|f?g*.txt"#), "a_b__c__d_e_f_g_.txt");
        assert_eq!(sanitize_filename("..  "), "download");
        assert_eq!(sanitize_filename("con.txt"), "_con.txt");
        let long = format!("{}.mp4", "x".repeat(300));
        let s = sanitize_filename(&long);
        assert!(s.ends_with(".mp4") && s.chars().count() <= 180);
    }

    #[test]
    fn name_from_url_and_type() {
        let mut h = HeaderMap::new();
        h.insert(CONTENT_TYPE, HeaderValue::from_static("video/mp4"));
        let u = Url::parse("https://cdn.example.com/v/clip%20one?x=1").unwrap();
        assert_eq!(filename_from(&h, &u), "clip one.mp4");
        let u = Url::parse("https://example.com/get?file=report.pdf").unwrap();
        assert_eq!(filename_from(&HeaderMap::new(), &u), "report.pdf");
    }

    #[test]
    fn host_matching_does_not_match_lookalikes() {
        let u = Url::parse("https://www.dropbox.com/s/a.zip").unwrap();
        assert!(!host_is(&u, &["x.com"]));
        let u = Url::parse("https://pbs.twimg.com/a.jpg").unwrap();
        assert!(host_is(&u, &["twimg.com"]));
    }

    #[test]
    fn googlevideo_range_params_removed() {
        let u = normalize_url("https://r1.googlevideo.com/videoplayback?id=1&range=0-1000&rn=3&itag=18");
        assert!(!u.contains("range=") && !u.contains("rn=") && u.contains("itag=18"));
    }

    #[test]
    fn threads_scale_with_size() {
        assert_eq!(adaptive_threads(1024 * 1024, 8), 2);
        assert_eq!(adaptive_threads(5 * 1024 * 1024, 8), 4);
        assert_eq!(adaptive_threads(500 * 1024 * 1024, 16), 16);
        assert_eq!(adaptive_threads(500 * 1024 * 1024, 1), 1);
    }
}

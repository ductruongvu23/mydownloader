// Quản lý hàng đợi tác vụ: chạy tối đa N tác vụ, tạm dừng/tiếp tục, lưu tasks.json.
// Định dạng tasks.json giữ như bản Electron để danh sách cũ vẫn hiện và tải tiếp được.
pub mod aria2;
pub mod batch;
pub mod http;
#[cfg(test)]
mod http_tests;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::runtime::Handle;
use tokio_util::sync::CancellationToken;

use crate::util;
use http::{DlError, Info, Outcome, Params, Progress, RateLimiter};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    #[default]
    Waiting,
    Active,
    Paused,
    Done,
    Error,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Task {
    pub id: String,
    pub url: String,
    pub name: String,
    pub dir: String,
    pub dest: Option<String>,
    /// Tên người dùng tự đặt (ưu tiên hơn tên máy chủ trả về)
    pub filename: Option<String>,
    pub status: Status,
    pub size: u64,
    pub downloaded: u64,
    #[serde(skip)]
    pub speed: u64,
    #[serde(skip)]
    pub connections: u32,
    pub error: Option<String>,
    pub headers: HashMap<String, String>,
    pub threads: usize,
    pub added_at: u64,
    pub completed_at: Option<u64>,
}

impl Task {
    pub fn eta_secs(&self) -> Option<u64> {
        (self.status == Status::Active && self.speed > 0 && self.size > self.downloaded)
            .then(|| (self.size - self.downloaded) / self.speed)
    }
}

pub struct AddOptions {
    pub dir: String,
    pub filename: Option<String>,
    pub headers: HashMap<String, String>,
    pub threads: usize,
}

pub enum Event {
    Changed,
    Done(Task),
    Failed(Task),
}

struct Run {
    cancel: CancellationToken,
    progress: Arc<Progress>,
    last_bytes: u64,
}

struct Inner {
    tasks: Vec<Task>,
    runs: HashMap<String, Run>,
    /// Tác vụ bị xóa kèm tệp khi đang chạy: xóa tệp sau khi luồng tải đóng tệp (id -> đường dẫn)
    pending_deletes: HashMap<String, Option<String>>,
    max_concurrent: usize,
    shutting_down: bool,
    last_save: Instant,
}

pub struct Manager {
    inner: Mutex<Inner>,
    rt: Handle,
    client: reqwest::Client,
    limiter: Arc<RateLimiter>,
    aria2: aria2::Aria2,
    store: PathBuf,
    notify: Box<dyn Fn(Event) + Send + Sync>,
}

fn new_id() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    format!("{:x}{:04x}", util::now_ms(), SEQ.fetch_add(1, Relaxed) & 0xffff)
}

/// Tên hiển thị trước khi máy chủ trả tên thật.
fn guess_name(url: &str) -> String {
    if let Some(dn) = url.split(['?', '&']).find_map(|p| p.strip_prefix("dn=")) {
        return percent_encoding::percent_decode_str(&dn.replace('+', " ")).decode_utf8_lossy().into_owned();
    }
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.path_segments().and_then(|s| s.filter(|x| !x.is_empty()).last().map(str::to_string)))
        .map(|s| percent_encoding::percent_decode_str(&s).decode_utf8_lossy().into_owned())
        .or_else(|| Path::new(url).file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_default()
}

fn remove_files(dest: &str) {
    for f in [dest.to_string(), format!("{dest}.part.json"), format!("{dest}.aria2")] {
        if Path::new(&f).exists() {
            if let Err(e) = std::fs::remove_file(&f) {
                util::log(&format!("Không xóa được {f}: {e}"));
            }
        }
    }
}

impl Manager {
    pub fn new(
        rt: Handle,
        store: PathBuf,
        max_concurrent: usize,
        speed_limit: u64,
        notify: Box<dyn Fn(Event) + Send + Sync>,
    ) -> Arc<Self> {
        let mut tasks: Vec<Task> = std::fs::read(&store)
            .ok()
            .and_then(|b| match serde_json::from_slice(&b) {
                Ok(t) => Some(t),
                Err(e) => {
                    util::log(&format!("tasks.json lỗi, bỏ qua: {e}"));
                    None
                }
            })
            .unwrap_or_default();
        for t in &mut tasks {
            // App tắt khi đang tải: đưa về hàng chờ để tự tải tiếp
            if t.status == Status::Active {
                t.status = Status::Waiting;
            }
            if t.id.is_empty() {
                t.id = new_id();
            }
        }
        let client = reqwest::Client::builder()
            .user_agent(http::DEFAULT_UA)
            .connect_timeout(Duration::from_secs(20))
            .pool_idle_timeout(Duration::from_secs(60))
            // HTTP/1.1 để mỗi luồng là một kết nối TCP riêng (CDN hay giới hạn tốc độ theo kết nối)
            .http1_only()
            .build()
            .expect("không tạo được HTTP client");
        let mgr = Arc::new(Self {
            inner: Mutex::new(Inner {
                tasks,
                runs: HashMap::new(),
                pending_deletes: HashMap::new(),
                max_concurrent: max_concurrent.max(1),
                shutting_down: false,
                last_save: Instant::now(),
            }),
            rt,
            client,
            limiter: Arc::new(RateLimiter::new(speed_limit)),
            aria2: aria2::Aria2::default(),
            store,
            notify,
        });
        let mut inner = mgr.inner.lock().unwrap();
        mgr.pump(&mut inner);
        drop(inner);
        mgr
    }

    fn save(&self, inner: &mut Inner) {
        inner.last_save = Instant::now();
        let tmp = self.store.with_extension("json.tmp");
        let r = serde_json::to_vec_pretty(&inner.tasks)
            .map_err(std::io::Error::other)
            .and_then(|b| std::fs::write(&tmp, b))
            .and_then(|_| std::fs::rename(&tmp, &self.store));
        if let Err(e) = r {
            util::log(&format!("Lưu tasks.json thất bại: {e}"));
        }
    }

    /// Lưu + báo UI vẽ lại + chạy thêm tác vụ chờ nếu còn chỗ.
    fn commit(self: &Arc<Self>, inner: &mut Inner) {
        self.save(inner);
        self.pump(inner);
        (self.notify)(Event::Changed);
    }

    fn pump(self: &Arc<Self>, inner: &mut Inner) {
        if inner.shutting_down {
            return;
        }
        let active = inner.tasks.iter().filter(|t| t.status == Status::Active).count();
        let slots = inner.max_concurrent.saturating_sub(active);
        let ready: Vec<usize> = inner
            .tasks
            .iter()
            .enumerate()
            .filter(|(_, t)| t.status == Status::Waiting)
            .map(|(i, _)| i)
            .take(slots)
            .collect();
        for i in ready {
            self.start(inner, i);
        }
    }

    fn start(self: &Arc<Self>, inner: &mut Inner, i: usize) {
        let t = &mut inner.tasks[i];
        t.status = Status::Active;
        t.error = None;
        t.speed = 0;
        let cancel = CancellationToken::new();
        let progress = Arc::new(Progress::default());
        progress.downloaded.store(t.downloaded, Relaxed);
        progress.size.store(t.size, Relaxed);
        let params = Params {
            url: t.url.clone(),
            dir: PathBuf::from(&t.dir),
            dest: t.dest.as_ref().map(PathBuf::from),
            filename: t.filename.clone(),
            headers: t.headers.clone(),
            threads: t.threads.max(1),
        };
        let id = t.id.clone();
        inner.runs.insert(id.clone(), Run { cancel: cancel.clone(), progress: progress.clone(), last_bytes: t.downloaded });
        let me = self.clone();
        self.rt.spawn(async move {
            let job = {
                let me = me.clone();
                let id = id.clone();
                tokio::spawn(async move {
                    let on_info = |info: Info| me.set_info(&id, info);
                    if aria2::handles(&params.url) {
                        me.aria2.download(&me.client, &params, &progress, &cancel, on_info).await
                    } else {
                        http::download(me.client.clone(), params, progress, me.limiter.clone(), cancel, on_info).await
                    }
                })
            };
            // Bọc thêm một lớp spawn: lỡ engine panic thì tác vụ báo lỗi thay vì kẹt "đang tải"
            let res = job.await.unwrap_or_else(|e| Err(DlError::fatal(format!("Lỗi nội bộ: {e}"))));
            me.finish(&id, res);
        });
    }

    fn set_info(&self, id: &str, info: Info) {
        let dest = info.dest.to_string_lossy().into_owned();
        let mut inner = self.inner.lock().unwrap();
        if let Some(t) = inner.tasks.iter_mut().find(|t| t.id == id) {
            t.dest = Some(dest);
            t.name = info.name;
            if info.size > 0 {
                t.size = info.size;
            }
            self.save(&mut inner);
        } else if let Some(pending) = inner.pending_deletes.get_mut(id) {
            *pending = Some(dest);
        }
        drop(inner);
        (self.notify)(Event::Changed);
    }

    fn finish(self: &Arc<Self>, id: &str, res: Result<Outcome, DlError>) {
        let mut inner = self.inner.lock().unwrap();
        inner.runs.remove(id);
        if let Some(Some(dest)) = inner.pending_deletes.remove(id) {
            remove_files(&dest);
        }
        let mut event = None;
        if let Some(t) = inner.tasks.iter_mut().find(|t| t.id == id) {
            t.speed = 0;
            t.connections = 0;
            match res {
                Ok(Outcome::Completed { dest, size }) if t.status == Status::Active => {
                    t.status = Status::Done;
                    t.dest = Some(dest.to_string_lossy().into_owned());
                    t.size = size;
                    t.downloaded = size;
                    t.completed_at = Some(util::now_ms());
                    util::log(&format!("Tải xong: {}", t.name));
                    event = Some(Event::Done(t.clone()));
                }
                Err(e) if t.status == Status::Active => {
                    util::log(&format!("Lỗi tải {} ({}): {}", t.name, t.url, e.msg));
                    t.status = Status::Error;
                    t.error = Some(e.msg);
                    event = Some(Event::Failed(t.clone()));
                }
                _ => {}
            }
        }
        self.commit(&mut inner);
        drop(inner);
        if let Some(e) = event {
            (self.notify)(e);
        }
    }

    pub fn add(self: &Arc<Self>, url: &str, opts: &AddOptions) -> String {
        let id = new_id();
        let filename = opts.filename.clone().filter(|f| !f.trim().is_empty());
        let task = Task {
            id: id.clone(),
            url: url.trim().to_string(),
            name: filename.clone().unwrap_or_else(|| guess_name(url)),
            dir: opts.dir.clone(),
            filename,
            headers: opts.headers.clone(),
            threads: opts.threads.max(1),
            added_at: util::now_ms(),
            ..Default::default()
        };
        util::log(&format!("Thêm tác vụ: {}", task.url));
        let mut inner = self.inner.lock().unwrap();
        inner.tasks.push(task);
        self.commit(&mut inner);
        id
    }

    /// Tên tác vụ đang tải/đang chờ cùng URL (để không tải trùng).
    pub fn active_url(&self, url: &str) -> Option<String> {
        let url = url.trim();
        let inner = self.inner.lock().unwrap();
        inner
            .tasks
            .iter()
            .find(|t| t.url == url && matches!(t.status, Status::Active | Status::Waiting))
            .map(|t| t.name.clone())
    }

    pub fn snapshot(&self) -> Vec<Task> {
        self.inner.lock().unwrap().tasks.clone()
    }

    pub fn pause(self: &Arc<Self>, ids: &[String]) {
        let mut inner = self.inner.lock().unwrap();
        let Inner { tasks, runs, .. } = &mut *inner;
        for t in tasks.iter_mut().filter(|t| ids.contains(&t.id)) {
            if matches!(t.status, Status::Active | Status::Waiting) {
                if let Some(r) = runs.get(&t.id) {
                    r.cancel.cancel();
                }
                t.status = Status::Paused;
                t.speed = 0;
            }
        }
        self.commit(&mut inner);
    }

    pub fn resume(self: &Arc<Self>, ids: &[String]) {
        let mut inner = self.inner.lock().unwrap();
        for t in inner.tasks.iter_mut().filter(|t| ids.contains(&t.id)) {
            if matches!(t.status, Status::Paused | Status::Error) {
                t.status = Status::Waiting;
                t.error = None;
            }
        }
        self.commit(&mut inner);
    }

    pub fn pause_all(self: &Arc<Self>) {
        let ids: Vec<String> = self.snapshot().into_iter().map(|t| t.id).collect();
        self.pause(&ids);
    }

    pub fn resume_all(self: &Arc<Self>) {
        let ids: Vec<String> = self.snapshot().into_iter().map(|t| t.id).collect();
        self.resume(&ids);
    }

    /// Xóa tác vụ khỏi danh sách; tệp đang mở thì xóa sau khi luồng tải đóng tệp.
    pub fn remove(self: &Arc<Self>, ids: &[String], delete_files: bool) {
        let mut inner = self.inner.lock().unwrap();
        let removed: Vec<Task> = {
            let (gone, keep): (Vec<Task>, Vec<Task>) = inner.tasks.drain(..).partition(|t| ids.contains(&t.id));
            inner.tasks = keep;
            gone
        };
        let Inner { runs, pending_deletes, .. } = &mut *inner;
        for t in &removed {
            match runs.get(&t.id) {
                Some(r) => {
                    r.cancel.cancel();
                    if delete_files {
                        pending_deletes.insert(t.id.clone(), t.dest.clone());
                    }
                }
                None if delete_files => {
                    if let Some(dest) = &t.dest {
                        remove_files(dest);
                    }
                }
                None => {}
            }
        }
        self.commit(&mut inner);
    }

    pub fn clear_done(self: &Arc<Self>) {
        let mut inner = self.inner.lock().unwrap();
        inner.tasks.retain(|t| t.status != Status::Done);
        self.commit(&mut inner);
    }

    pub fn set_speed_limit(&self, bytes_per_sec: u64) {
        self.limiter.set(bytes_per_sec);
    }

    pub fn set_max_concurrent(self: &Arc<Self>, n: usize) {
        let mut inner = self.inner.lock().unwrap();
        inner.max_concurrent = n.max(1);
        self.pump(&mut inner);
    }

    /// Gọi mỗi 500 ms: cập nhật tiến độ/tốc độ, lưu định kỳ. Trả về (tổng tốc độ, số tác vụ đang tải).
    pub fn tick(&self, dt: Duration) -> (u64, usize) {
        let mut inner = self.inner.lock().unwrap();
        let Inner { tasks, runs, .. } = &mut *inner;
        let (mut total, mut active) = (0u64, 0usize);
        for t in tasks.iter_mut().filter(|t| t.status == Status::Active) {
            let Some(r) = runs.get_mut(&t.id) else { continue };
            let now = r.progress.downloaded.load(Relaxed);
            let delta = now.saturating_sub(r.last_bytes);
            r.last_bytes = now;
            let inst = (delta as f64 / dt.as_secs_f64().max(0.001)) as u64;
            t.speed = if t.speed == 0 { inst } else { (t.speed * 3 + inst * 2) / 5 };
            t.downloaded = now;
            let size = r.progress.size.load(Relaxed);
            if size > 0 {
                t.size = size;
            }
            t.connections = r.progress.connections.load(Relaxed);
            total += t.speed;
            active += 1;
        }
        if active > 0 && inner.last_save.elapsed() > Duration::from_secs(5) {
            self.save(&mut inner);
        }
        (total, active)
    }

    /// Dừng mọi tác vụ (giữ trạng thái để lần mở sau tải tiếp) và chờ tối đa 3 giây để lưu tiến độ.
    pub fn shutdown(&self) {
        {
            let mut inner = self.inner.lock().unwrap();
            inner.shutting_down = true;
            for r in inner.runs.values() {
                r.cancel.cancel();
            }
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline && !self.inner.lock().unwrap().runs.is_empty() {
            std::thread::sleep(Duration::from_millis(50));
        }
        let mut inner = self.inner.lock().unwrap();
        self.save(&mut inner);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_electron_tasks_json() {
        let old = r#"[{"id":"0b8f","url":"https://x/a.zip","urls":["https://x/a.zip"],"mirrors":[],
            "headers":{"Referer":"https://x/"},"threads":8,"dir":"C:\\D","dest":null,"name":"a.zip",
            "status":"active","size":0,"downloaded":10,"speed":5,"connections":2,"addedAt":1700000000000}]"#;
        let tasks: Vec<Task> = serde_json::from_str(old).unwrap();
        assert_eq!(tasks[0].status, Status::Active);
        assert_eq!(tasks[0].headers["Referer"], "https://x/");
        assert_eq!((tasks[0].downloaded, tasks[0].speed, tasks[0].dest.is_none()), (10, 0, true));
    }

    #[test]
    fn guesses_names() {
        assert_eq!(guess_name("https://x/files/b%20c.zip?t=1"), "b c.zip");
        assert_eq!(guess_name("magnet:?xt=urn:btih:abc&dn=Ubuntu+24.04"), "Ubuntu 24.04");
    }
}

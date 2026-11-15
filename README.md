# 🚀 MyDownloader

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/ductruongvu23/mydownloader?style=for-the-badge&logo=github&color=0284c7)](https://github.com/ductruongvu23/mydownloader/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-3b82f6?style=for-the-badge&logo=open-source-initiative&logoColor=white)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-egui_0.32-B7410E?style=for-the-badge&logo=rust&logoColor=white)](rust/)

**Trình quản lý tải xuống đa luồng cho Windows, bắt link và video ngay từ trình duyệt.**  
*A lightweight multi-threaded download manager for Windows, with a browser extension that catches downloads and media.*

</div>

---

## 🦀 MyDownloader 2.0 — viết lại bằng Rust

Bản 2.0 thay Electron bằng Rust + egui: **1 tiến trình, ~94 MB RAM** (bản Electron 1.x: 4 tiến trình, ~284 MB, đo trên cùng máy).

- **Extension nói chuyện với app qua native messaging** (`mydownloader-host.exe`) thay cho HTTP cổng 6801: trang web không gọi vào app được nữa, không còn quét cổng/token.
- **App đang tắt vẫn bắt được link**: trình duyệt chạy host, host tự mở app ẩn ở khay rồi chuyển link sang.
- **Bấm ✕ thì thu xuống khay và vẫn tải tiếp**; thoát hẳn từ menu khay. Tắt ngang (crash, tắt máy) thì lần mở sau tải tiếp từ chỗ dừng.
- Dùng chung dữ liệu với bản 1.x (`%APPDATA%\mydownloader`: `settings.json`, `tasks.json`), log ở `mydownloader.log` cùng thư mục.

---

## 🌟 Tính Năng

### 🚀 Động cơ tải
- Thăm dò Range trước khi tải; máy chủ không hỗ trợ Range thì tự chuyển sang tải đơn luồng.
- Số luồng thích ứng theo dung lượng tệp (tối đa 1–32 luồng mỗi tệp, chỉnh trong Cài đặt); luồng xong sớm chia việc với luồng chậm.
- Lỗi mạng chỉ thử lại đoạn bị hỏng (backoff, tối đa 8 lần); 30 giây không có dữ liệu thì coi là treo và kết nối lại.
- Tiến độ lưu ở `<tệp>.part.json`: tạm dừng hay tắt app thì lần sau tải tiếp từ chỗ dừng.
- Hàng đợi chạy 1–20 tác vụ cùng lúc, giới hạn tốc độ chung cho mọi tác vụ.
- Tải hàng loạt theo mẫu, ví dụ `http://x/img[001-100].jpg`.
- Torrent / Magnet / FTP qua `aria2c.exe` (không đi kèm: đặt cạnh `MyDownloader.exe` hoặc có trong `PATH`).

### 🎬 Tiện ích trình duyệt (`extension/`, Manifest V3)
- Bắt download của trình duyệt: tạm dừng bản của trình duyệt, hỏi trong app, chỉ hủy khi bạn bấm tải bằng MyDownloader.
- Bắt luồng video thực (`.mp4`, `.webm`, `.m3u8`, `googlevideo.com`...) qua `webRequest`; bóc stream MP4 của YouTube và TikTok.
- Nút tải nổi trên video đang phát; menu chuột phải tải link, ảnh, video/âm thanh và link bôi đen.
- Gửi kèm Referer, Cookie, User-Agent của trang gốc để CDN không chặn (403).

### 🎨 Giao diện
- Giao diện tối / sáng / theo hệ thống, tiếng Việt / English.
- Lọc theo trạng thái, tìm kiếm, chọn nhiều tác vụ để tạm dừng / tiếp tục / xóa; dán link (Ctrl+V) để thêm nhanh.
- Thông báo Windows khi tải xong hoặc lỗi; tùy chọn khởi động cùng Windows (ẩn ở khay).

---

## 📥 Cài Đặt

Tải `MyDownloader-<version>-win-x64.zip` ở mục [Releases](https://github.com/ductruongvu23/mydownloader/releases), giải nén vào một thư mục cố định rồi chạy `MyDownloader.exe` một lần: app tự đăng ký native host với Chrome / Edge / Brave / Cốc Cốc / Chromium (chỉ ghi vào `HKCU`, không cần quyền admin).

### 🔌 Cài extension

1. Trong MyDownloader: **Cài đặt** → **📂 Mở thư mục Extension** (thư mục `extension` nằm cạnh `MyDownloader.exe`).
2. Mở `chrome://extensions` (`edge://extensions`, `coccoc://extensions`), bật **Chế độ dành cho nhà phát triển**.
3. Bấm **Tải tiện ích đã giải nén** và chọn thư mục ở bước 1.

Extension có `key` cố định trong `manifest.json` nên ID luôn là `pialejfhnnjfpkmlgkogbhphaeomhafe`, dù đặt ở thư mục nào. Đã cài extension của bản 1.x thì gỡ ra rồi cài lại theo các bước trên.

### 🔄 Cập nhật

**Cài đặt** → **Kiểm tra cập nhật** → **Cập nhật ngay**: app tải gói zip của bản mới, thay các tệp trong thư mục cài rồi tự khởi động lại. Sau đó bấm ⟳ ở thẻ extension trong `chrome://extensions` để trình duyệt nạp extension mới. Cập nhật tay: thoát MyDownloader (chuột phải icon khay → **Thoát**), giải nén bản mới đè lên thư mục cũ rồi mở lại.

Bản 1.x (Electron) không tự cập nhật lên 2.x được: tải zip về như trên, cài đặt và danh sách tải được giữ nguyên; gỡ bản 1.x trong Settings → Apps nếu muốn.

---

## 🛠️ Phát Triển

Cần [Rust](https://rustup.rs/) và [MSYS2](https://www.msys2.org/) UCRT64 có `gcc` (`pacman -S mingw-w64-ucrt-x86_64-gcc`). Máy dev không có Windows SDK nên project dùng toolchain GNU, chọn tự động qua `rust/rust-toolchain.toml`; linker `C:/msys64/ucrt64/bin/gcc.exe` khai báo trong `rust/.cargo/config.toml`. Chạy `cargo` trong thư mục `rust/` để hai file này có hiệu lực.

```bash
cd rust
cargo test --release
cargo build --release
```

Chạy `rust/target/release/MyDownloader.exe` một lần để đăng ký native host; khi chạy từ `target/`, app tự tìm thư mục `extension/` ở gốc repo.

### 📦 Đóng gói

```bash
powershell -ExecutionPolicy Bypass -File rust\package.ps1
```

Build release rồi tạo `rust/dist/MyDownloader/` (`MyDownloader.exe`, `mydownloader-host.exe`, `extension/`) và `rust/dist/MyDownloader-<version>-win-x64.zip`. Phiên bản lấy từ `rust/Cargo.toml` và được đồng bộ sang `extension/manifest.json`. Icon `resources/icon.ico` được nhúng vào cả hai exe lúc build (`rust/build.rs`, dùng `windres` của MSYS2). Nếu báo *Permission denied* thì thoát MyDownloader đang chạy từ `rust/target/release` rồi chạy lại.

### 🚢 Phát hành lên GitHub Releases

```bash
powershell -ExecutionPolicy Bypass -File rust\package.ps1 -Release
```

Đóng gói rồi tạo Release `v<version>` kèm file zip, ghi chú lấy từ `rust/release-notes.md` (cần [GitHub CLI](https://cli.github.com/) đã `gh auth login`). Script chỉ phát hành khi `rust/`, `extension/`, `resources/` không còn thay đổi chưa commit và commit hiện tại đã push; tag được tạo trên GitHub tại đúng commit đó. Chạy lại cùng phiên bản thì chỉ thay file zip. Bộ tự cập nhật trong app (`rust/src/update.rs`) đọc `releases/latest`: so `tag_name` với phiên bản đang chạy rồi tải asset `MyDownloader-…-win….zip`, nên đừng đổi dạng tag hay tên zip. Mỗi bản mới chỉ cần tăng `version` trong `rust/Cargo.toml`, commit, push rồi chạy lệnh trên.

---

## 🏗️ Cấu Trúc Dự Án

```
mydownloader/
├── rust/                     # App Rust (egui, tokio, reqwest)
│   ├── src/
│   │   ├── main.rs           # Khởi động: 1 phiên bản duy nhất, đăng ký native host, khởi động cùng Windows
│   │   ├── app.rs            # Lõi dùng chung giữa giao diện và IPC, icon khay
│   │   ├── ui.rs             # Giao diện egui
│   │   ├── update.rs         # Tự cập nhật từ GitHub Releases
│   │   ├── ipc.rs            # Named pipe nhận lệnh từ native host
│   │   ├── native.rs         # Đăng ký native messaging host (HKCU), tìm thư mục extension
│   │   ├── settings.rs       # settings.json
│   │   ├── util.rs           # Thư mục dữ liệu, log, Win32
│   │   ├── engine/           # http.rs (tải đa luồng), mod.rs (hàng đợi), aria2.rs, batch.rs
│   │   └── bin/host.rs       # mydownloader-host.exe: native messaging host
│   ├── build.rs              # Nhúng icon vào exe
│   ├── package.ps1           # Đóng gói zip / phát hành GitHub Releases
│   └── release-notes.md      # Ghi chú đăng kèm mỗi Release
├── extension/                # Tiện ích Chrome/Edge (Manifest V3)
│   ├── manifest.json         # key cố định -> ID pialejfhnnjfpkmlgkogbhphaeomhafe
│   ├── background.js         # Bắt download, media sniffer, gọi native host
│   ├── content.js            # Nút tải nổi, bóc stream YouTube / TikTok
│   └── popup.html / popup.js # Trạng thái kết nối app, gửi link nhanh
├── resources/                # icon.ico, icon.png, tray.png
└── scripts/                  # gen-icons.cjs, setup-ltsc (môi trường Windows LTSC)
```

---

## 📄 Giấy Phép (License)

Dự án được phân phối dưới giấy phép mã nguồn mở **MIT License**. Xem chi tiết tại tệp [LICENSE](LICENSE).

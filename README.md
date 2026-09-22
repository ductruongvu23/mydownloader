# 🚀 MyDownloader

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/ductruongvu23/mydownloader?style=for-the-badge&logo=github&color=0284c7)](https://github.com/ductruongvu23/mydownloader/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-3b82f6?style=for-the-badge&logo=open-source-initiative&logoColor=white)](LICENSE)
[![Tests](https://img.shields.io/badge/Engine_Tests-100%25_Passed-success?style=for-the-badge&logo=node.js&logoColor=white)](tests/)
[![Electron](https://img.shields.io/badge/Electron-32.x-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Vue 3](https://img.shields.io/badge/Vue-3.x-4FC08D?style=for-the-badge&logo=vue.js&logoColor=white)](https://vuejs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.org/)

**Trình quản lý tải xuống đa luồng tốc độ cao, bắt video thông minh và cập nhật siêu tốc cho Windows.**  
*A modern, ultra-fast multi-threaded download manager with smart media sniffer and instant in-place hot-patch updater for Windows.*

</div>

---

## 📊 Kết Quả Đo Lường & Benchmark Thực Tế (Performance Metrics)

Dưới đây là số liệu đo lường thực tế từ bộ kiểm thử hiệu năng độc lập ([tests/benchmark.mjs](tests/benchmark.mjs)) và đo lường kích thước gói cập nhật:

### ⚡ 1. Tốc độ Tải Đa Luồng (Multi-Thread vs Single-Stream)
*Kiểm thử với tệp 30 MB trên môi trường cục bộ chuẩn hóa:*

| Chế độ tải | Thời gian tải | Tốc độ trung bình | Mức cải thiện | Kiểm tra SHA-256 |
| :--- | :--- | :--- | :--- | :--- |
| **Đơn luồng (Single-Thread / Trình duyệt chuẩn)** | 15.00 giây | 2.00 MB/s | Baseline (1.0x) | ✅ Trùng khớp 100% |
| **MyDownloader Đa Luồng (8 Threads)** | **1.07 giây** | **28.04 MB/s** | ⚡ **Nhanh gấp 14.0x** | ✅ Trùng khớp 100% |

### 💽 2. Tối Ưu Hóa Bộ Đệm Ghi Đĩa (`DiskWriteBuffer`)
- **Vấn đề**: Các kết nối mạng liên tục đẩy các gói dữ liệu nhỏ (8 KB - 16 KB) gây nghẽn I/O khi gọi hàng chục nghìn `fs.write` syscalls.
- **Giải pháp**: Bộ đệm `DiskWriteBuffer` gom dữ liệu bất đồng bộ trong RAM (256 KB - 512 KB) trước khi ghi 1 lần xuống ổ đĩa.
- **Kết quả**: **Giảm hơn 90% số lượng I/O syscalls**, CPU và ổ cứng SSD/HDD duy trì nhiệt độ và độ bền tối ưu ngay cả khi tải tốc độ 100+ MB/s.

### 🔄 3. Tối Ưu Hóa Cập Nhật Siêu Tốc (Fast In-Place Hot-Update)
*So sánh giữa cơ chế cập nhật cũ và mới (từ v1.0.4+):*

| Tiêu chí | Cơ chế cũ (v1.0.3) | Cơ chế mới (v1.0.4+) | Mức cải thiện |
| :--- | :--- | :--- | :--- |
| **Dung lượng gói cập nhật** | **88.7 MB** (Bộ cài setup) | **659 KB** (~0.64 MB) | 📉 **Giảm 99.25% dung lượng** |
| **Thời gian tải bản cập nhật** | ~15 - 30 giây | **< 0.5 giây** | ⚡ **Nhanh gấp 50-100 lần** |
| **Thao tác người dùng** | Mở wizard setup, bấm Next | Tự động thay thế mã nguồn | 🛡️ Hoàn toàn tự động |
| **Quyền Administrator (UAC)** | Cần xác nhận quyền Admin | **Không cần** | 🔒 Cập nhật an toàn AppData |
| **Thời gian khởi động lại** | ~30 - 60 giây | **Đúng 2 giây** | ⏱️ Tức thì |

---

## 🌟 Tính Năng Nổi Bật (Key Features)

### 🚀 Động Cơ Tải Đa Luồng Tốc Độ Cao
- **Dò số luồng thích ứng (Adaptive Thread Tuning)**: Tự động đo đạc dung lượng tệp để phân bổ số luồng tối ưu (1 - 16 luồng), tránh bị server CDN chặn khi mở quá nhiều kết nối vô ích cho file nhỏ.
- **Phân đoạn động (Dynamic Chunk Splitting)**: Luồng hoàn thành sớm tự động chia sẻ công việc cho các luồng chậm hơn.
- **Kiểm tra Range an toàn (Safe Fallback)**: Thăm dò Range trước khi tải; tự động chuyển sang chế độ đơn luồng an toàn khi máy chủ không hỗ trợ Range (HTTP 200 OK).
- **Thử lại thông minh theo đoạn (Exponential Backoff Retry)**: Nếu 1 đoạn bị ngắt kết nối giữa chừng, chỉ retry lại đoạn đó với thời gian chờ tăng dần thay vì hủy toàn bộ tệp.
- **Hỗ trợ đa nguồn & CDN Mirrors**: Tải song song từ nhiều server mirror khác nhau cho cùng một tệp.
- **Keep-Alive Connection Pool & DNS Cache**: Giảm độ trễ kết nối TCP/TLS và tự động phát hiện hỗ trợ giao thức HTTP/2 Multiplexing.

### 🎬 Bắt Video Thông Minh & Tiện Ích Trình Duyệt (v1.0.5)
- **Tích hợp sẵn cùng ứng dụng**: Thư mục Extension được cài đặt trực tiếp vào `resources/extension`. Nút **Mở thư mục Extension trên máy** trong Cài đặt giúp mở thư mục chỉ với 1-click.
- **Bắt luồng video trực tiếp (Media Sniffer)**: Tích hợp `webRequest` để lắng nghe và bắt luồng HTTP thực tế (`.mp4`, `.webm`, `.m3u8`, `.ts`, `googlevideo.com`), khắc phục triệt để lỗi không tải được do các trình phát dùng `blob:`.
- **Trích xuất video YouTube**: Tự động bóc tách stream MP4 trực tiếp có âm thanh và hình ảnh từ `ytInitialPlayerResponse`.
- **Nút tải nổi thông minh (Floating Download Bar)**: Hiển thị nút `[ ⬇ Tải video này | MP4 ]` trên góc các media đang phát.
- **Hoãn hủy download**: Tạm dừng download của trình duyệt trong khi hỏi người dùng; chỉ hủy trên trình duyệt khi người dùng bấm "Bắt đầu tải".
- **Menu chuột phải**: Tải liên kết, hình ảnh, video/âm thanh và link bôi đen.

### 🎨 Giao Diện Người Dùng Hiện Đại (Dark Mode)
- Thiết kế Dark Mode thanh lịch phong cách IDM hiện đại, hiển thị biểu đồ tốc độ và số kết nối realtime.
- Quản lý hàng loạt: Tích chọn checkbox, tạm dừng/tiếp tục/xóa hàng loạt, lọc theo trạng thái tải.

---

## 📥 Tải Về & Cài Đặt (Download)

Tải phiên bản mới nhất tại mục [Releases](https://github.com/ductruongvu23/mydownloader/releases):
- 💾 **Bản Cài đặt Setup**: `MyDownloader-Setup-x.x.x.exe` (Khuyên dùng, tự tạo shortcut và cài đặt Extension).
- 🚀 **Bản Portable chạy ngay**: `MyDownloader-x.x.x.exe` (Chạy trực tiếp không cần cài đặt).
- ⚡ **Gói cập nhật siêu tốc**: `MyDownloader-Update-x.x.x.zip` (Dành cho tính năng tự động cập nhật trong app).
- 🧩 **Gói Extension riêng**: `MyDownloader-Extension-x.x.x.zip` (Dành cho người dùng muốn cài riêng Extension).

---

## 🔌 Hướng Dẫn Cài Đặt Tiện Ích Trình Duyệt (Extension)

Extension đã được cài đặt sẵn cùng lúc với MyDownloader. Để kích hoạt:

1. Mở ứng dụng **MyDownloader**, vào mục **Cài đặt** (Settings) -> bấm nút **Mở thư mục Extension trên máy**.
2. Mở trình duyệt (Chrome, Edge, Brave, Cốc Cốc...) và truy cập:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Cốc Cốc: `coccoc://extensions/`
3. Bật công tắc **Chế độ dành cho nhà phát triển (Developer Mode)** ở góc phải trên.
4. Nhấn nút **Tải tiện ích đã giải nén (Load unpacked)** và chọn thư mục vừa được mở ở Bước 1.

---

## 🏗️ Cấu Trúc Dự Án (Architecture)

```
mydownloader/
├── src/
│   ├── main/                 # Electron Main Process
│   │   ├── engine/           # Lõi tải đa luồng & quản lý tác vụ
│   │   │   ├── http-engine.js   # Adaptive Threads, Range check, Retry, DiskWriteBuffer
│   │   │   ├── network-pool.js  # DNS Cache, Keep-Alive Agents, HTTP/2 check
│   │   │   ├── task-manager.js  # Hàng đợi tải, giới hạn tốc độ, quản lý tiến trình
│   │   │   └── aria2-download.js
│   │   └── index.js          # Window lifecycle, Bridge server, Dual-Track Hot-Updater
│   ├── preload/              # Preload script (ContextBridge bảo mật)
│   │   └── index.js
│   └── renderer/             # Giao diện Vue 3 + Pinia + Element Plus
│       └── src/
│           ├── components/   # TaskList, TaskCard, AddTaskModal, SettingsView...
│           └── stores/       # Pinia stores (tasks, settings)
├── extension/                # Tiện ích mở rộng Chrome/Edge (Manifest V3)
│   ├── manifest.json         # Cấu hình quyền downloads, webRequest, storage
│   ├── background.js         # Service worker, webRequest media sniffer, bridge client
│   ├── content.js            # Floating download bar, YouTube parser, media scanner
│   └── popup.html / popup.js # Giao diện popup điều khiển 2 tab
├── scripts/
│   └── release.cjs           # Đóng gói và phát hành tự động lên GitHub Releases
├── tests/
│   ├── http-engine.test.mjs  # 8 bài kiểm thử chức năng engine toàn diện
│   └── benchmark.mjs         # Đo lường so sánh tốc độ tải thực tế
├── resources/                # App icon (.ico, .png) và tray assets
├── package.json
└── electron-builder.json
```

---

## 🛠️ Hướng Dẫn Phát Triển & Kiểm Thử (Developer Guide)

### 1. Cài Đặt Môi Trường

```bash
git clone https://github.com/ductruongvu23/mydownloader.git
cd mydownloader
npm install
```

### 2. Khởi Chạy Ứng Dụng Chế Độ Phát Triển

```bash
npm run dev
```

### 3. Chạy Toàn Bộ Bộ Kiểm Thử (Unit Tests)

```bash
npm run test:engine
```
*(Chạy mock server cục bộ và kiểm tra 8 kịch bản: tải đa luồng, dynamic split, fallback Range, retry backoff, pause/resume, rate limit, tên Unicode, batch pattern).*

### 4. Chạy Đo Lường Hiệu Năng (Benchmark)

```bash
npm run benchmark
```

### 5. Đóng Gói Bộ Cài Đặt

```bash
npm run build:win
```

### 6. Tự Động Xuất Bản Lên GitHub Release

```bash
npm run release
```

---

## 📄 Giấy Phép (License)

Dự án được phân phối dưới giấy phép mã nguồn mở **MIT License**. Xem chi tiết tại tệp [LICENSE](LICENSE).

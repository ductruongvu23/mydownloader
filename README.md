# 🚀 MyDownloader

<div align="center">

[![GitHub Release](https://img.shields.io/github/v/release/ductruongvu23/mydownloader?style=for-the-badge&logo=github&color=0284c7)](https://github.com/ductruongvu23/mydownloader/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-3b82f6?style=for-the-badge&logo=open-source-initiative&logoColor=white)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-32.x-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Vue 3](https://img.shields.io/badge/Vue-3.x-4FC08D?style=for-the-badge&logo=vue.js&logoColor=white)](https://vuejs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.org/)

**Trình quản lý tải xuống đa luồng tốc độ cao, giao diện hiện đại và mã nguồn mở cho Windows.**  
*A modern, open-source high-speed multi-threaded download manager for Windows.*

</div>

---

## 🌟 Tính Năng Nổi Bật (Key Features)

### ⚡ Động Cơ Tải Đa Luồng Tốc Độ Cao
- **Phân đoạn HTTP Range thông minh**: Tự động chia tệp thành nhiều phân đoạn kết nối đồng thời để tối đa hóa tốc độ đường truyền.
- **Tối ưu hóa phân đoạn động (Dynamic Chunk Splitting)**: Các kết nối hoàn thành sớm sẽ tự động chia sẻ công việc cho các phân đoạn còn lại.
- **Tạm dừng & Tiếp tục an toàn**: Lưu tiến trình thời gian thực, cho phép tiếp tục tải khi mất mạng hoặc khởi động lại máy mà không phải tải lại từ đầu.
- **Chống trùng lặp & Tối ưu RAM**: Kiểm tra liên kết trước khi tải, ngăn chặn việc tải lặp lại các tệp đã hoàn tất, giải phóng bộ đệm thông minh.

### 🎨 Giao Diện Người Dùng Hiện Đại & Trực Quan
- **Thiết kế Dark/Light Mode thanh lịch**: Tối ưu thị giác, hiệu ứng mượt mà và trực quan.
- **Quản lý hàng loạt linh hoạt**: Hỗ trợ ô tích chọn (checkbox) từng mục, chọn tất cả, tạm dừng/tiếp tục/xóa hàng loạt và nút "Xóa tất cả".
- **Hiển thị thông số chi tiết**: Tốc độ tải (MB/s), thời gian ước tính còn lại (ETA), số luồng kết nối và tiến trình phần trăm.
- **Tự động kiểm tra cập nhật (Auto-Updater)**: Tích hợp sẵn cơ chế kiểm tra phiên bản mới từ GitHub, tự động tải và cập nhật trong 1 click.

### 🧩 Tiện Ích Trình Duyệt (Browser Integration)
- Hỗ trợ tiện ích mở rộng cho các trình duyệt Chromium (Google Chrome, Microsoft Edge, Brave, CocCoc...).
- Bắt liên kết thông minh, hiển thị hộp thoại xác nhận trước khi tải, tránh tình trạng tải ngầm không mong muốn.

---

## 📥 Tải Về & Cài Đặt (Download)

Tải phiên bản mới nhất tại mục [Releases](https://github.com/ductruongvu23/mydownloader/releases):
- **Bản Cài đặt (Setup Installer)**: `MyDownloader-Setup-x.x.x.exe` (Tự động tạo shortcut và cập nhật).
- **Bản Portable (Chạy ngay)**: `MyDownloader-x.x.x.exe` (Không cần cài đặt, chạy trực tiếp).

---

## 🏗️ Cấu Trúc Dự Án (Architecture)

```
mydownloader/
├── src/
│   ├── main/                 # Electron Main Process
│   │   ├── engine/           # Lõi tải HTTP đa luồng & quản lý tác vụ
│   │   │   ├── http-engine.js
│   │   │   └── task-manager.js
│   │   ├── index.js          # Khởi tạo cửa sổ, IPC handlers, server bắt link & updater
│   ├── preload/              # Preload script (Bridge an toàn giữa Main & Renderer)
│   │   └── index.js
│   └── renderer/             # Giao diện Vue 3 + Pinia + Element Plus
│       └── src/
│           ├── components/   # TaskList, TaskCard, AddTaskModal, SettingsView...
│           ├── stores/       # Pinia stores (tasks, settings)
│           └── assets/       # CSS & Icon assets
├── extension/                # Tiện ích mở rộng cho trình duyệt
├── resources/                # App icon (.ico, .png) và tray assets
├── package.json
└── electron-builder.json
```

---

## 🛠️ Hướng Dẫn Phát Triển (Development Guide)

### 1. Yêu Cầu
- **Node.js**: Phiên bản `>= 18.x`
- **npm** hoặc **pnpm / yarn**

### 2. Cài Đặt

```bash
git clone https://github.com/ductruongvu23/mydownloader.git
cd mydownloader
npm install
```

### 3. Chạy Development Server

```bash
npm run dev
```

### 4. Đóng Gói (Build)

```bash
# Đóng gói bộ cài đặt Windows (.exe)
npm run build:win
```
Các tệp thực thi sẽ được xuất ra thư mục `dist/`.

---

## 🔌 Cài Đặt Tiện Ích Trình Duyệt

1. Mở Chrome / Edge và truy cập: `chrome://extensions/`
2. Bật công tắc **Chế độ dành cho nhà phát triển (Developer Mode)**.
3. Nhấn **Tải tiện ích đã giải nén (Load unpacked)** và chọn thư mục `extension/` của dự án.

---

## 📄 Giấy Phép (License)

Phát hành dưới giấy phép **MIT License**. Xem thêm tại tệp `LICENSE`.

# 🚀 MyDownloader - High-Speed Multi-Threaded Download Manager

<div align="center">

![Electron](https://img.shields.io/badge/Electron-32.x-47848F?style=for-the-badge&logo=electron&logoColor=white)
![Vue 3](https://img.shields.io/badge/Vue-3.x-4FC08D?style=for-the-badge&logo=vue.js&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

**Trình quản lý tải xuống đa luồng tốc độ cao với kiến trúc động cơ HTTP phân đoạn thông minh và giao diện người dùng phong cách hiện đại.**

</div>

---

## 🌟 Tính Năng Nổi Bật

### ⚡ Động Cơ Tải Đa Luồng Mạnh Mẽ (IDM-like Engine)
- **Tải đa phân đoạn (Multi-part HTTP Range)**: Tự động chia tệp thành nhiều phân đoạn nhỏ và tải đồng thời (mặc định hỗ trợ lên tới 32 kết nối song song).
- **Dynamic Chunk Splitting**: Luồng nào tải xong sớm sẽ tự động chia đôi phân đoạn của luồng khác đang tải dở để tối đa hóa băng thông Internet.
- **Tạm dừng & Tiếp tục (Pause & Resume)**: Lưu trạng thái tải liên tục qua tệp `.meta`, cho phép tiếp tục tải mà không mất dữ liệu ngay cả khi mạng ngắt kết nối hoặc tắt ứng dụng.
- **Bắt link & Hỗ trợ Redirect/Auth**: Tự động giải quyết chuỗi URL chuyển hướng (Redirect HTTP 301/302/307), tùy chỉnh Headers, Cookie, Referer và User-Agent linh hoạt.

### 🎨 Giao Diện Người Dùng Hiện Đại (Motrix Style)
- **Thiết kế Glassmorphism & Dark Mode**: Tối ưu thị giác, phong cách hiện đại với animations mượt mà.
- **Hiển thị thời gian thực**: Tốc độ tải trực quan (KB/s, MB/s), thời gian còn lại (ETA), số luồng hoạt động, tiến trình tải dạng phân đoạn.
- **Phân loại tệp thông minh**: Tự động phân loại tải xuống theo Video, Nhạc, Tài liệu, Tệp nén (Zip/Rar), Chương trình cài đặt,...
- **Bộ lọc & Tìm kiếm**: Lọc nhanh các tác vụ theo trạng thái (*Đang tải, Đã xong, Đã tạm dừng, Thất bại*).

### 🧩 Tiện Ích Trình Duyệt (Browser Extension)
- Tích hợp sẵn extension cho trình duyệt nhân Chromium (Google Chrome, Microsoft Edge, Brave, CocCoc,...).
- Tự động bắt link tải tệp lớn hoặc cho phép gửi link trực tiếp về ứng dụng chỉ với 1 click chuột phải.

---

## 🏗️ Cấu Trúc Dự Án

```
idmclone/
├── src/
│   ├── main/                 # Electron Main Process
│   │   ├── engine/           # Lõi tải HTTP đa luồng & phân đoạn
│   │   │   ├── http-engine.js
│   │   │   └── task-manager.js
│   │   ├── index.js          # Khởi tạo cửa sổ, IPC handlers, server bắt link
│   │   └── tray.js           # Khay hệ thống
│   ├── preload/              # Preload script (Bridge giữa Main và Renderer)
│   │   └── index.js
│   └── renderer/             # Giao diện Vue 3 + Pinia + Element Plus
│       └── src/
│           ├── components/   # Sidebar, TaskCard, AddTaskModal, StatusBar...
│           ├── stores/       # Pinia stores quản lý Tasks, Settings
│           └── assets/       # CSS & icons
├── extension/                # Tiện ích mở rộng cho trình duyệt Chrome/Edge
│   ├── manifest.json
│   ├── background.js
│   └── popup.html
├── package.json
└── electron.vite.config.mjs
```

---

## 🚀 Hướng Dẫn Cài Đặt & Phát Triển

### 1. Yêu Cầu Môi Trường
- **Node.js**: Phiên bản `>= 18.x`
- **npm** hoặc **pnpm / yarn**

### 2. Cài Đặt Dependencies

```bash
# Clone repository
git clone https://github.com/ductruongvu23/mydownloader.git
cd mydownloader

# Cài đặt thư viện
npm install
```

### 3. Chạy Ở Chế Độ Phát Triển (Development)

```bash
npm run dev
```

### 4. Đóng Gói Ứng Dụng (Build Installer)

```bash
# Build cho hệ điều hành Windows (.exe)
npm run build:win
```
Tệp cài đặt sẽ được tạo tại thư mục `dist/`.

---

## 🔌 Cài Đặt Tiện Ích Mở Rộng Trình Duyệt

1. Mở trình duyệt Chrome / Edge và truy cập: `chrome://extensions/`
2. Bật công tắc **Chế độ dành cho nhà phát triển (Developer Mode)** ở góc trên bên phải.
3. Nhấn vào nút **Tải tiện ích đã giải nén (Load unpacked)**.
4. Chọn thư mục `extension/` bên trong thư mục nguồn của dự án.
5. Biểu tượng **MyDownloader** sẽ xuất hiện trên thanh công cụ duyệt web.

---

## ⚙️ Cấu Hình Mặc Định

| Tham số | Giá trị mặc định | Mô tả |
| :--- | :--- | :--- |
| `threads` | `32` | Số luồng kết nối tải đồng thời tối đa trên mỗi tệp |
| `maxConcurrent` | `5` | Số tác vụ tải xuống song song |
| `minSplit` | `512 KB` | Kích thước tối thiểu của một phân đoạn tải |
| `downloadDir` | Thư mục `Downloads` của hệ thống | Vị trí lưu mặc định |

---

## 📄 Giấy Phép (License)

Dự án được phân phối dưới giấy phép **MIT License**.

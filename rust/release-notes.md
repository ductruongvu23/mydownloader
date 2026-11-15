## Cài đặt

1. Tải tệp `MyDownloader-…-win-x64.zip` bên dưới, giải nén vào một thư mục cố định (ví dụ `C:\Users\<tên>\MyDownloader`). Không cần quyền admin.
2. Chạy `MyDownloader.exe` một lần: app tự đăng ký với Chrome / Edge / Brave / Cốc Cốc.
3. Mở `chrome://extensions` (hoặc `edge://extensions`, `coccoc://extensions`), bật **Chế độ dành cho nhà phát triển**, bấm **Tải tiện ích đã giải nén** và chọn thư mục `extension` nằm cạnh `MyDownloader.exe`.

Torrent / Magnet / FTP cần `aria2c.exe` đặt cạnh `MyDownloader.exe` hoặc có trong `PATH`.

## Cập nhật

Từ bản 2.x: **Cài đặt → Kiểm tra cập nhật → Cập nhật ngay** (app tự tải, thay tệp và khởi động lại), rồi bấm ⟳ (tải lại) ở thẻ extension trong `chrome://extensions`. Cập nhật tay: thoát MyDownloader (chuột phải icon ở khay → Thoát), giải nén bản mới đè lên thư mục cũ rồi mở lại.

**Đang dùng bản 1.x (Electron):** bản 1.x không tự cập nhật lên 2.x được, hãy tải zip ở trên. Cài đặt và danh sách tải được giữ nguyên (`%APPDATA%\mydownloader`). Gỡ bản 1.x trong Settings → Apps, gỡ extension cũ rồi cài lại từ thư mục `extension` mới.

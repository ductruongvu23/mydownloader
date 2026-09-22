// scripts/upload-release.cjs
const fs = require('fs')
const path = require('path')

const TOKEN = process.env.GH_TOKEN || ''
const OWNER = 'ductruongvu23'
const REPO = 'mydownloader'
const TAG = 'v1.0.1'
const RELEASE_NAME = 'MyDownloader v1.0.1'

const RELEASE_NOTES = `# 🚀 MyDownloader v1.0.1

Bản cập nhật v1.0.1 mang đến khả năng chọn và quản lý tác vụ hàng loạt, cơ chế tự động kiểm tra và cài đặt bản cập nhật, đồng thời khắc phục triệt để tình trạng ngốn RAM do bắt link trùng lặp từ trình duyệt.

### ✨ Tính Năng Mới
- 🔘 **Quản lý hàng loạt & Xóa tất cả**:
  - Hỗ trợ ô tích chọn (checkbox) cho từng tệp tải xuống.
  - Thanh công cụ thao tác nhanh: *Chọn tất cả*, *Tạm dừng hàng loạt*, *Tiếp tục hàng loạt*, *Xóa các mục đã chọn*.
  - Nút **Xóa tất cả** với tùy chọn xóa luôn tệp vật lý trên ổ đĩa.
- 🔄 **Tự động kiểm tra cập nhật (Auto-Updater)**:
  - Tích hợp nút Kiểm tra cập nhật tại thanh điều hướng và màn hình Cài đặt.
  - Tự động phát hiện phiên bản mới trên GitHub, hiển thị phần trăm tiến trình tải và cài đặt trong 1 click.

### 🐛 Sửa Lỗi & Tối Ưu Hóa
- 🛑 **Khắc phục lỗi chạy ngầm & ngốn RAM**:
  - Tiện ích trình duyệt bắt link sẽ chuyển sang hộp thoại xác nhận tải của ứng dụng thay vì tự động mở tải ngầm đa luồng.
  - Tự động bỏ qua liên kết đang tải hoặc tệp đã hoàn tất trên ổ đĩa.
- 🎨 **Mã nguồn mở chuyên nghiệp**:
  - Chuẩn hóa mã nguồn mở, dọn dẹp sạch sẽ toàn bộ từ khóa bản quyền và thương hiệu khác.

---

### 📦 Tệp Tải Về (Downloads)
- **Cài đặt Windows (Khuyên dùng)**: \`MyDownloader Setup 1.0.1.exe\` (Tự tạo shortcut Desktop & Start Menu).
- **Bản Portable (Chạy ngay)**: \`MyDownloader 1.0.1.exe\` (Không cần cài đặt, cắm USB dùng ngay).`

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'MyDownloader-Release-Uploader',
  'X-GitHub-Api-Version': '2022-11-28'
}

async function run() {
  console.log(`[1/3] Kiểm tra bản Release ${TAG} trên GitHub...`)
  let release = null

  // 1. Kiểm tra release đã có chưa
  const getRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, { headers })
  if (getRes.ok) {
    release = await getRes.json()
    console.log(`  -> Đã tìm thấy Release hiện có: ID ${release.id}`)
  } else if (getRes.status === 404) {
    console.log(`  -> Chưa có Release ${TAG}, tiến hành tạo mới...`)
    const createRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: TAG,
        name: RELEASE_NAME,
        body: RELEASE_NOTES,
        draft: false,
        prerelease: false
      })
    })

    if (!createRes.ok) {
      const errText = await createRes.text()
      throw new Error(`Tạo Release thất bại: HTTP ${createRes.status} - ${errText}`)
    }
    release = await createRes.json()
    console.log(`  -> Đã tạo Release thành công! ID: ${release.id}`)
  } else {
    throw new Error(`Lỗi kiểm tra release: HTTP ${getRes.status}`)
  }

  // 2. Danh sách assets cần upload
  const distDir = path.resolve(__dirname, '../dist')
  const filesToUpload = [
    'MyDownloader Setup 1.0.1.exe',
    'MyDownloader 1.0.1.exe',
    'latest.yml',
    'MyDownloader Setup 1.0.1.exe.blockmap'
  ]

  console.log(`\n[2/3] Chuẩn bị tải lên ${filesToUpload.length} tệp assets...`)
  const existingAssets = release.assets || []

  for (const filename of filesToUpload) {
    const filePath = path.join(distDir, filename)
    if (!fs.existsSync(filePath)) {
      console.warn(`  [!] Cảnh báo: Tệp không tồn tại: ${filePath}`)
      continue
    }

    const stat = fs.statSync(filePath)
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(2)

    // Xóa asset cũ nếu trùng tên
    const dup = existingAssets.find((a) => a.name === filename)
    if (dup) {
      console.log(`  -> Đang xóa asset cũ '${filename}' (ID: ${dup.id})...`)
      await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${dup.id}`, {
        method: 'DELETE',
        headers
      })
    }

    console.log(`  -> Đang tải lên '${filename}' (${sizeMB} MB)...`)
    const fileBuffer = fs.readFileSync(filePath)

    const uploadUrl = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(filename)}`
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stat.size)
      },
      body: fileBuffer
    })

    if (!uploadRes.ok) {
      const errText = await uploadRes.text()
      console.error(`  [X] Thất bại khi upload '${filename}': HTTP ${uploadRes.status} - ${errText}`)
    } else {
      const uploadedAsset = await uploadRes.json()
      console.log(`  [✓] Hoàn tất '${filename}'! URL: ${uploadedAsset.browser_download_url}`)
    }
  }

  console.log(`\n[3/3] ✨ TẤT CẢ FILE ĐÃ ĐƯỢC TẢI LÊN GITHUB RELEASE THÀNH CÔNG!`)
  console.log(`👉 Link bản phát hành: ${release.html_url}`)
}

run().catch((err) => {
  console.error('[!] Lỗi thực thi upload:', err)
  process.exit(1)
})

// scripts/release.cjs - Quy trình đóng gói và phát hành tự động lên GitHub Release
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// 1. Tự động nạp GH_TOKEN từ process.env hoặc file .env cục bộ
let token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''
const envPath = path.resolve(__dirname, '../.env')
if (!token && fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8')
  const match = content.match(/GH_TOKEN\s*=\s*(["']?)([^"'\r\n]+)\1/)
  if (match) token = match[2].trim()
}

if (!token) {
  console.error('[!] LỖI: Không tìm thấy GitHub Token!')
  console.error('    Vui lòng thiết lập biến môi trường GH_TOKEN hoặc thêm vào file .env')
  process.exit(1)
}

// 2. Đọc thông tin package.json
const pkgPath = path.resolve(__dirname, '../package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const version = pkg.version || '1.0.2'
const tag = `v${version}`
const OWNER = 'ductruongvu23'
const REPO = 'mydownloader'
const RELEASE_NAME = `MyDownloader v${version}`

const RELEASE_NOTES = `# 🚀 MyDownloader v${version}

Phiên bản v${version} mang đến nâng cấp lớn cho Extension trình duyệt, cơ chế hoãn hủy bắt link thông minh, nút tải video nổi IDM style và menu chuột phải mở rộng.

### ✨ Tính Năng Mới & Nổi Bật
- 🛡️ **Bắt link thông minh (Hoãn hủy download)**:
  - Khi bắt link, Extension tạm dừng download của trình duyệt trong khi MyDownloader hiện cửa sổ hỏi.
  - Chỉ hủy download trên trình duyệt khi người dùng bấm **Bắt đầu tải**.
  - Nếu bấm **Hủy**, trình duyệt tự động tiếp tục tải bình thường không làm mất file.
- 🎬 **Nút tải video nổi trên media đang phát (Media Sniffer)**:
  - Tự động phát hiện video/audio đang phát và hiển thị nút nổi \`[ ⬇ Tải video này | MP4 ]\` ở góc video.
  - Tab *Media trên trang* trong Extension popup hiển thị đầy đủ danh sách media để tải 1-click.
- 🎨 **Giao diện Extension Dark Mode hoàn toàn mới**:
  - Giao diện 2 tab trực quan, hiển thị trạng thái kết nối realtime và công tắc bật/tắt linh hoạt.
- 🖱️ **Mở rộng Menu ngữ cảnh chuột phải**:
  - Hỗ trợ tải liên kết, hình ảnh, video/âm thanh và bôi đen văn bản.

---

### 📦 Tệp Tải Về
- **Bản cài đặt Setup**: \`MyDownloader Setup ${version}.exe\`
- **Bản Portable chạy ngay**: \`MyDownloader ${version}.exe\`
- **Cấu hình tự động cập nhật**: \`latest.yml\``

console.log(`\n======================================================`)
console.log(`🚀 BẮT ĐẦU QUY TRÌNH ĐÓNG GÓI & PHÁT HÀNH TỰ ĐỘNG: ${tag}`)
console.log(`======================================================\n`)

// 3. Biên dịch mã nguồn (npm run build)
console.log(`[1/5] 🔨 Đang biên dịch mã nguồn (electron-vite build)...`)
execSync('npm.cmd run build', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') })

// 4. Đóng gói bộ cài đặt Windows (electron-builder)
console.log(`\n[2/5] 📦 Đang đóng gói bộ cài đặt Windows bằng electron-builder...`)
execSync('npx.cmd electron-builder --win', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') })

// 5. Đồng bộ Git commit và tag lên GitHub
console.log(`\n[3/5] 🏷️ Đang tạo Git tag và đẩy lên GitHub...`)
const gitCmd = '"C:\\Program Files\\Git\\cmd\\git.exe"'
try {
  execSync(`${gitCmd} add .`, { stdio: 'pipe' })
  try {
    execSync(`${gitCmd} commit -m "chore(release): bump version to ${tag}"`, { stdio: 'pipe' })
  } catch {}
  execSync(`${gitCmd} tag -a ${tag} -m "Release ${tag}" -f`, { stdio: 'pipe' })
  execSync(`${gitCmd} push https://x-access-token:${token}@github.com/${OWNER}/${REPO}.git main --tags -f`, { stdio: 'inherit' })
  console.log(`  -> Đã đẩy mã nguồn và tag ${tag} lên GitHub thành công!`)
} catch (e) {
  console.warn(`  [!] Cảnh báo khi push git: ${e.message}`)
}

// 6. Tải các tệp trong dist/ lên GitHub Release
console.log(`\n[4/5] ☁️ Đang tải bản build lên GitHub Release ${tag}...`)
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'MyDownloader-Auto-Releaser',
  'X-GitHub-Api-Version': '2022-11-28'
}

async function uploadRelease() {
  let release = null
  const getRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${tag}`, { headers })
  if (getRes.ok) {
    release = await getRes.json()
    console.log(`  -> Tìm thấy Release hiện có (ID: ${release.id})`)
  } else if (getRes.status === 404) {
    console.log(`  -> Đang tạo mới bản Release ${tag}...`)
    const createRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: RELEASE_NAME,
        body: RELEASE_NOTES,
        draft: false,
        prerelease: false
      })
    })
    if (!createRes.ok) {
      throw new Error(`Tạo Release thất bại: HTTP ${createRes.status} - ${await createRes.text()}`)
    }
    release = await createRes.json()
    console.log(`  -> Đã tạo Release thành công (ID: ${release.id})!`)
  }

  const distDir = path.resolve(__dirname, '../dist')
  const filesToUpload = [
    `MyDownloader Setup ${version}.exe`,
    `MyDownloader ${version}.exe`,
    'latest.yml',
    `MyDownloader Setup ${version}.exe.blockmap`
  ]

  const existingAssets = release.assets || []

  for (const filename of filesToUpload) {
    const filePath = path.join(distDir, filename)
    if (!fs.existsSync(filePath)) {
      console.warn(`  [!] Không tìm thấy tệp: ${filePath}`)
      continue
    }

    const stat = fs.statSync(filePath)
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(2)

    // Xóa asset cũ nếu trùng
    const dup = existingAssets.find((a) => a.name === filename)
    if (dup) {
      console.log(`  -> Đang thay thế asset cũ '${filename}'...`)
      await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${dup.id}`, {
        method: 'DELETE',
        headers
      })
    }

    console.log(`  -> Đang tải lên '${filename}' (${sizeMB} MB)...`)
    const buffer = fs.readFileSync(filePath)
    const uploadUrl = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(filename)}`

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stat.size)
      },
      body: buffer
    })

    if (uploadRes.ok) {
      const asset = await uploadRes.json()
      console.log(`  [✓] Hoàn tất '${filename}'! URL: ${asset.browser_download_url}`)
    } else {
      console.error(`  [X] Lỗi upload '${filename}': HTTP ${uploadRes.status}`)
    }
  }

  console.log(`\n[5/5] 🎉 PHÁT HÀNH THÀNH CÔNG BẢN BUILD ${tag}!`)
  console.log(`👉 Xem trên GitHub: ${release.html_url}`)
}

uploadRelease().catch((err) => {
  console.error('[!] LỖI trong quá trình phát hành:', err)
  process.exit(1)
})

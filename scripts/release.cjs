const fs = require('fs')
const path = require('path')
const https = require('https')
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

// 2. Đọc thông tin package.json và đồng bộ sang extension manifest
const pkgPath = path.resolve(__dirname, '../package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const version = pkg.version || '1.0.5'
const tag = `v${version}`
const OWNER = 'ductruongvu23'
const REPO = 'mydownloader'
const RELEASE_NAME = `MyDownloader v${version}`

// Tự động đồng bộ version vào extension/manifest.json
const manifestPath = path.resolve(__dirname, '../extension/manifest.json')
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.version = version
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  console.log(`[✓] Đã đồng bộ phiên bản Extension manifest.json thành: ${version}`)
}

const RELEASE_NOTES = `# 🚀 MyDownloader v${version} - Bản vá Cập nhật Tại chỗ & Khắc phục Extension Media

Phiên bản v${version} khắc phục hoàn toàn sự cố khi cập nhật tại chỗ, sửa lỗi tiện ích extension bắt được video nhưng không tải được xuống và triệt tiêu xung đột với TikTok (chỉ phát âm thanh)!

### ✨ Tính Năng & Bản Vá v${version}
- 🎬 **Khắc phục lỗi bắt & tải video trên Extension**:
  - Tự động gắn kèm Referer, Origin và Cookies phiên từ trang gốc cho các video CDN (TikTok, YouTube, Facebook, Twitter).
  - Tự động nhận diện phần mở rộng (.mp4, .webm, .m4a, .mp3...) từ Content-Type phản hồi khi máy chủ không đặt tên tệp.
  - Tối ưu hóa luồng tải CDN tránh bị 403 Forbidden và fallback mượt mà sang stream đơn luồng khi CDN trả về HTTP 200.
  - Sửa lỗi nạp Cookie và Headers trong hộp thoại AddTaskModal khi nhận liên kết từ tiện ích mở rộng.
- 🎵 **Khắc phục xung đột TikTok chỉ phát âm thanh**:
  - Nút tải nổi được chuyển sang \`position: fixed\` gắn trực tiếp trên \`document.body\`, loại bỏ hoàn toàn việc can thiệp vào container DOM của TikTok player làm vỡ layout co khung hình video về 0px.
  - Tích hợp bộ bóc tách stream TikTok trực tiếp từ \`__UNIVERSAL_DATA_FOR_REHYDRATION__\` & \`SIGI_STATE\` cho phép tải trực tiếp tệp MP4 gốc.
  - Debounce bộ lắng nghe MutationObserver giúp lướt xem TikTok mượt mà, không tốn tài nguyên CPU.
- 🛠️ **Hệ thống Hot-Update & Đóng gói**:
  - Khắc phục lỗi cập nhật tại chỗ với batch script Windows retry 15 lần.
  - Giao diện Settings tự động lấy phiên bản thực tế của runtime qua IPC \`app:version\`.
  - Bộ cài đặt Setup Windows dual-mode tự động tương thích nâng cấp mượt mà từ các bản cũ.

---

### 📦 Tệp Tải Về
- ⚡ **Gói cập nhật siêu tốc**: \`MyDownloader-FastUpdate-${version}.zip\` (~660 KB)
- 🧩 **Tiện ích mở rộng trình duyệt**: \`MyDownloader-Extension-${version}.zip\`
- 💾 **Bộ cài đặt Setup Windows đầy đủ**: \`MyDownloader Setup ${version}.exe\`
- 🚀 **Bản Portable chạy ngay**: \`MyDownloader ${version}.exe\`
- 📄 **Cấu hình tự động cập nhật**: \`latest.yml\``

function uploadAssetHttps(uploadUrl, filePath, token, maxRetries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (retryCount) => {
      const url = new URL(uploadUrl)
      const stat = fs.statSync(filePath)
      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'User-Agent': 'MyDownloader-Release-Agent',
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size
        }
      }

      const req = https.request(options, (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body))
            } catch {
              resolve({ ok: true })
            }
          } else {
            console.error(`  [!] Upload ${path.basename(filePath)} HTTP ${res.statusCode}: ${body.slice(0, 150)}`)
            if (retryCount < maxRetries) {
              console.log(`  -> Thử lại lần ${retryCount + 1}/${maxRetries} sau 3 giây...`)
              setTimeout(() => attempt(retryCount + 1), 3000)
            } else {
              reject(new Error(`Upload failed with HTTP ${res.statusCode}`))
            }
          }
        })
      })

      req.on('error', (err) => {
        console.error(`  [!] Socket error: ${err.message}`)
        if (retryCount < maxRetries) {
          console.log(`  -> Thử lại lần ${retryCount + 1}/${maxRetries} sau 3 giây...`)
          setTimeout(() => attempt(retryCount + 1), 3000)
        } else {
          reject(err)
        }
      })

      fs.createReadStream(filePath).pipe(req)
    }

    attempt(0)
  })
}

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
let gitBin = 'git'
const gitCandidates = [
  'C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Programs\\Git\\cmd\\git.exe')
]
for (const c of gitCandidates) {
  if (fs.existsSync(c)) {
    gitBin = `"${c}"`
    break
  }
}

try {
  execSync(`${gitBin} add .`, { stdio: 'ignore' })
  execSync(`${gitBin} commit -m "fix(extension): fix video download and resolve tiktok playback conflict"`, { stdio: 'ignore' })
} catch {}
try {
  execSync(`${gitBin} tag -a ${tag} -m "${RELEASE_NAME}" -f`, { stdio: 'ignore' })
} catch {}
try {
  execSync(`${gitBin} push origin main --tags -f`, { stdio: 'inherit' })
  console.log(`  -> Đã đẩy mã nguồn và tag ${tag} lên GitHub thành công!`)
} catch (e) {
  console.warn(`  [!] Cảnh báo push git: ${e.message}`)
}

// 6. Tải các tệp trong dist/ lên GitHub Release
console.log(`\n[4/5] ☁️ Đang tải bản build lên GitHub Release ${tag}...`)

async function uploadRelease() {
  const headers = {
    'User-Agent': 'MyDownloader-Release-Agent',
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json'
  }

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

  // Tạo gói cập nhật siêu tốc MyDownloader-FastUpdate-{version}.zip chứa app.asar
  const updateZipName = `MyDownloader-FastUpdate-${version}.zip`
  const updateZipPath = path.join(distDir, updateZipName)
  const asarPath = path.join(distDir, 'win-unpacked/resources/app.asar')
  if (fs.existsSync(asarPath)) {
    console.log(`\n  ⚡ Đang đóng gói bản cập nhật siêu tốc: ${updateZipName}...`)
    try {
      execSync(`tar -a -cf "${updateZipPath}" -C "${path.dirname(asarPath)}" app.asar`)
      const zipStat = fs.statSync(updateZipPath)
      console.log(`  -> [✓] Đã tạo '${updateZipName}' thành công: ${(zipStat.size / (1024 * 1024)).toFixed(2)} MB (${(zipStat.size / 1024).toFixed(0)} KB)`)
    } catch (e) {
      console.warn(`  [!] Cảnh báo không tạo được zip cập nhật: ${e.message}`)
    }
  }

  // Tạo gói tiện ích mở rộng MyDownloader-Extension-{version}.zip
  const extensionZipName = `MyDownloader-Extension-${version}.zip`
  const extensionZipPath = path.join(distDir, extensionZipName)
  const extensionSrcDir = path.resolve(__dirname, '../extension')
  if (fs.existsSync(extensionSrcDir)) {
    console.log(`  🧩 Đang đóng gói tiện ích mở rộng: ${extensionZipName}...`)
    try {
      execSync(`tar -a -cf "${extensionZipPath}" -C "${path.dirname(extensionSrcDir)}" extension`)
      const extStat = fs.statSync(extensionZipPath)
      console.log(`  -> [✓] Đã tạo '${extensionZipName}' thành công: ${(extStat.size / 1024).toFixed(0)} KB`)
    } catch (e) {
      console.warn(`  [!] Cảnh báo không tạo được zip extension: ${e.message}`)
    }
  }

  const filesToUpload = [
    updateZipName,
    extensionZipName,
    `MyDownloader Setup ${version}.exe`,
    `MyDownloader ${version}.exe`,
    'latest.yml',
    `MyDownloader Setup ${version}.exe.blockmap`
  ]

  // Lấy danh sách asset mới nhất từ GitHub
  const currentAssetsRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets`, { headers })
  const existingAssets = currentAssetsRes.ok ? await currentAssetsRes.json() : (release.assets || [])

  // Xóa các asset cũ hoặc asset xung đột (ví dụ MyDownloader-Update-*.zip khiến bản cũ 1.0.4 chạy script lỗi, hoặc file có dấu chấm)
  for (const a of existingAssets) {
    const isConflict = a.name.startsWith('MyDownloader-Update-') ||
      a.name.includes(`Setup.${version}`) ||
      a.name.includes(`.${version}.exe`) ||
      filesToUpload.includes(a.name)
    if (isConflict) {
      console.log(`  -> Đang xóa asset cũ/xung đột '${a.name}'...`)
      await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${a.id}`, {
        method: 'DELETE',
        headers
      })
    }
  }

  for (const filename of filesToUpload) {
    const filePath = path.join(distDir, filename)
    if (!fs.existsSync(filePath)) {
      console.warn(`  [!] Không tìm thấy tệp: ${filePath}`)
      continue
    }

    const stat = fs.statSync(filePath)
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(2)

    console.log(`  -> Đang tải lên '${filename}' (${sizeMB} MB)...`)
    const uploadUrl = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(filename)}`

    try {
      const asset = await uploadAssetHttps(uploadUrl, filePath, token)
      console.log(`  [✓] Hoàn tất '${filename}'! URL: ${asset.browser_download_url || uploadUrl}`)
    } catch (err) {
      console.error(`  [X] Lỗi upload '${filename}': ${err.message}`)
      throw err
    }
  }

  console.log(`\n[5/5] 🎉 PHÁT HÀNH THÀNH CÔNG BẢN BUILD ${tag}!`)
  console.log(`👉 Xem trên GitHub: ${release.html_url}`)
}

uploadRelease().catch((err) => {
  console.error('[!] LỖI trong quá trình phát hành:', err)
  process.exit(1)
})

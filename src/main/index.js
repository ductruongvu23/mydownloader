// src/main/index.js
import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  Notification,
  shell,
  dialog,
  nativeTheme,
  nativeImage
} from 'electron'
import path from 'path'
import http from 'http'
import fs from 'fs'
import crypto from 'crypto'
import { TaskManager } from './engine/task-manager'
import { expandPattern } from './engine/batch'

// Chỉ cho phép 1 instance ứng dụng chạy
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock && !process.env.ELECTRON_RENDERER_URL) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    if (!mainWindow.isVisible()) mainWindow.show()
    mainWindow.focus()
  }
})

let mainWindow = null
let tray = null
let manager = null
let bridgeServer = null

// Quản lý cấu hình Settings
const settingsPath = path.join(app.getPath('userData'), 'settings.json')

function loadSettings() {
  const defaults = {
    downloadDir: app.getPath('downloads'),
    language: 'vi',
    theme: 'dark',
    maxConcurrent: 5,
    threads: 8, // Tối ưu 8 luồng mặc định để tiết kiệm RAM & CPU
    speedLimit: 0,
    notifyOnComplete: true,
    bridgeEnabled: true,
    bridgePort: 6801,
    extensionToken: crypto.randomBytes(16).toString('hex'),
    openAtLogin: false,
    autoDownloadFromExtension: false // Mặc định hiện hộp thoại xác nhận khi bắt link, không tự tải ngầm
  }

  try {
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      return { ...defaults, ...data }
    } else {
      fs.writeFileSync(settingsPath, JSON.stringify(defaults, null, 2))
    }
  } catch (e) {
    console.warn('[Settings] Đọc cấu hình thất bại, dùng mặc định:', e.message)
  }
  return defaults
}

let currentSettings = loadSettings()

function saveSettings(newSettings) {
  currentSettings = { ...currentSettings, ...newSettings }
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2))
  } catch (e) {
    console.error('[Settings] Lưu cấu hình thất bại:', e.message)
  }
  return currentSettings
}

// Lưu trạng thái quyết định của người dùng cho các download item từ extension
const bridgeDecisions = new Map()

// Cầu nối Extension HTTP Server
function startBridge(port = 6801) {
  if (bridgeServer) {
    try {
      bridgeServer.close()
    } catch {}
    bridgeServer = null
  }

  if (!currentSettings.bridgeEnabled) return

  bridgeServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Token')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }

    if (req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({
        status: 'pong',
        version: app.getVersion(),
        token: currentSettings.extensionToken,
        port
      }))
    }

    // Endpoint kiểm tra quyết định của người dùng cho một lượt tải từ extension
    if (req.method === 'GET' && req.url.startsWith('/bridge/decision')) {
      try {
        const parsedUrl = new URL(req.url, 'http://127.0.0.1')
        const id = parsedUrl.searchParams.get('id')
        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          return res.end(JSON.stringify({ error: 'Thiếu downloadId' }))
        }
        const record = bridgeDecisions.get(String(id))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({
          downloadId: id,
          action: record ? record.action : 'pending'
        }))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ error: e.message }))
      }
    }

    // Kiểm tra token nếu client có gửi hoặc nếu token được cấu hình bắt buộc
    const tokenHeader = req.headers['x-token']
    if (tokenHeader && tokenHeader !== currentSettings.extensionToken) {
      console.warn('[Bridge Server] Token không khớp:', tokenHeader)
      // Vẫn chấp nhận từ 127.0.0.1 để tiện lợi cho người dùng
    }

    if (req.method === 'POST' && req.url === '/add') {
      let body = ''
      req.on('data', (c) => {
        body += c
        if (body.length > 2e6) req.destroy()
      })
      req.on('end', () => {
        try {
          const { url, referrer, cookie, userAgent, filename, downloadId } = JSON.parse(body)
          if (!url || !/^https?:\/\//i.test(url)) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ error: 'URL không hợp lệ' }))
          }

          console.log(`[Bridge Server] 📥 Nhận liên kết tải từ Extension: ${url.slice(0, 100)}... (tên: ${filename || 'tự động'}, downloadId: ${downloadId || 'none'})`)

          // Luôn đưa cửa sổ lên màn hình chính khi có link từ trình duyệt
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            if (!mainWindow.isVisible()) mainWindow.show()
            mainWindow.focus()
          }

          // Kiểm tra xem URL đã có trong danh sách tác vụ chưa
          const dup = manager.checkDuplicate(url)
          if (dup) {
            console.log(`[Bridge Server] ⚠️ Phát hiện liên kết đã có trong danh sách (${dup.type}):`, url.slice(0, 80))
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('bridge:duplicate-detected', {
                type: dup.type,
                task: dup.task,
                fileExists: dup.fileExists
              })
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ success: true, duplicate: true, type: dup.type }))
          }

          const headers = {}
          if (referrer) headers.Referer = referrer
          if (cookie) headers.Cookie = cookie
          if (userAgent) headers['User-Agent'] = userAgent

          if (currentSettings.autoDownloadFromExtension) {
            // Tự động tải nếu người dùng bật cấu hình
            const task = manager.add(url, {
              dir: currentSettings.downloadDir,
              filename: filename || '',
              headers,
              threads: currentSettings.threads
            })
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ success: true, id: task.id }))
          } else {
            // Mặc định: Gửi xuống Renderer để mở hộp thoại xác nhận tải, không chạy ngầm lén lút
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('bridge:link-received', {
                url,
                filename: filename || '',
                headers,
                dir: currentSettings.downloadDir,
                threads: currentSettings.threads,
                downloadId: downloadId || null
              })
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ success: true, prompt: true }))
          }
        } catch (err) {
          console.error('[Bridge Server] Lỗi xử lý /add:', err.message)
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      })
      return
    }

    res.writeHead(404)
    res.end()
  })

  // Bắt lỗi để tránh crash app - đặc biệt EADDRINUSE khi port đang bị chiếm
  bridgeServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Bridge Server] Port ${port} đang bị chiếm, thử port ${port + 1}`)
      try { bridgeServer.close() } catch {}
      bridgeServer = null
      // Thử port tiếp theo (tối đa thử 9 port)
      if (port < currentSettings.bridgePort + 9) {
        setTimeout(() => startBridge(port + 1), 300)
      } else {
        console.error('[Bridge Server] Không tìm được port trống - tắt Bridge Server')
      }
    } else {
      console.error('[Bridge Server] Lỗi:', err.message)
    }
  })

  bridgeServer.listen(port, '127.0.0.1', () => {
    console.log(`[Bridge Server] Đang lắng nghe trên http://127.0.0.1:${port}`)
  })
}

function getPreloadPath() {
  // Preload được build thành CJS (index.js) - ưu tiên file .js
  const js = path.join(__dirname, '../preload/index.js')
  if (fs.existsSync(js)) return js
  // Fallback nếu build cũ vẫn còn file .mjs
  const mjs = path.join(__dirname, '../preload/index.mjs')
  if (fs.existsSync(mjs)) return mjs
  return js
}

function getAppIcon() {
  const candidates = [
    path.join(__dirname, '../../resources/icon.ico'),
    path.join(__dirname, '../../resources/icon.png'),
    path.join(process.resourcesPath, 'resources/icon.ico'),
    path.join(process.resourcesPath, 'icon.ico'),
    path.join(app.getAppPath(), 'resources/icon.ico'),
    path.join(app.getAppPath(), 'resources/icon.png')
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p)
        if (!img.isEmpty()) return img
      }
    } catch {}
  }
  return null
}

function getTrayIcon() {
  const candidates = [
    path.join(__dirname, '../../resources/tray.png'),
    path.join(__dirname, '../../resources/icon.ico'),
    path.join(process.resourcesPath, 'resources/tray.png'),
    path.join(process.resourcesPath, 'tray.png'),
    path.join(app.getAppPath(), 'resources/tray.png')
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p)
        if (!img.isEmpty()) return img
      }
    } catch {}
  }

  const fallbackPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAZklEQVQ4T2NkoBAwUqifgWoG/P//n5GBgYGBhYWF4S8TAwMDw/fv3xkZGRgZfvz4wfD371+Gv79/M/xnYGBg+Pf3P8NffgYGBsbfv38ZfjAABW7evMlwsZkBXfPnz58MGKbhUTcM0wMA2n0tEZd51VwAAAAASUVORK5CYII='
  try {
    const img = nativeImage.createFromDataURL(fallbackPng)
    if (!img.isEmpty()) return img
  } catch {}

  return null
}

function createWindow() {
  const appIcon = getAppIcon()
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 700,
    minWidth: 840,
    minHeight: 560,
    title: 'MyDownloader',
    icon: appIcon || undefined,
    backgroundColor: currentSettings.theme === 'light' ? '#f7f8fa' : '#141416',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Đặt theme
  if (currentSettings.theme === 'dark') nativeTheme.themeSource = 'dark'
  else if (currentSettings.theme === 'light') nativeTheme.themeSource = 'light'
  else nativeTheme.themeSource = 'system'

  // Load URL từ Vite dev server hoặc production file
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    // Tự mở DevTools trong chế độ dev để xem log renderer
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Log tất cả console message từ renderer ra terminal
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const lvl = ['log', 'warn', 'error', 'info'][level] || 'log'
    const src = sourceId ? sourceId.split('/').pop() : ''
    console.log(`[Renderer:${lvl}] ${src ? src + ':' + line + ' ' : ''}${message}`)
  })

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      if (tray) {
        e.preventDefault()
        mainWindow.hide()
      } else {
        app.isQuitting = true
        app.quit()
      }
    }
  })
}

function setupTray() {
  try {
    const icon = getTrayIcon()
    if (!icon || icon.isEmpty()) {
      console.warn('[Tray] Không tìm thấy icon hợp lệ, bỏ qua setup tray')
      return
    }
    tray = new Tray(icon)
    tray.setToolTip('MyDownloader - Sẵn sàng')

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Mở MyDownloader',
        click: () => {
          if (mainWindow) {
            mainWindow.show()
            mainWindow.focus()
          }
        }
      },
      {
        label: 'Tạm dừng tất cả',
        click: () => manager?.pauseAll()
      },
      {
        label: 'Tiếp tục tất cả',
        click: () => manager?.resumeAll()
      },
      { type: 'separator' },
      {
        label: 'Thoát',
        click: () => {
          app.isQuitting = true
          app.quit()
        }
      }
    ])

    tray.setContextMenu(contextMenu)
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      }
    })

    // Cập nhật tooltip tốc độ thời gian thực
    setInterval(() => {
      if (!manager || !tray) return
      const activeTasks = manager.list().filter((t) => t.status === 'active')
      const totalSpeed = activeTasks.reduce((acc, t) => acc + (t.speed || 0), 0)
      const speedMB = (totalSpeed / (1024 * 1024)).toFixed(1)

      if (activeTasks.length > 0) {
        tray.setToolTip(`MyDownloader: Đang tải ${activeTasks.length} task · ${speedMB} MB/s`)
      } else {
        tray.setToolTip('MyDownloader: Sẵn sàng')
      }
    }, 1000)
  } catch (err) {
    console.warn('[Tray] Không thể tạo Tray:', err.message)
  }
}

function cleanUrl(u) {
  if (!u || typeof u !== 'string') return ''
  // Chỉ xóa các ký tự không hợp lệ bao quanh URL (quote, dấu nháy)
  // KHÔNG xóa [ ] vì có thể là URL hợp lệ hoặc batch pattern
  return u
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
}

function registerIpcHandlers() {
  ipcMain.handle('tasks:add', (_e, urls, opts = {}) => {
    console.log('[IPC tasks:add] urls:', JSON.stringify(urls).slice(0, 200), 'opts:', JSON.stringify(opts).slice(0, 200))
    if (!Array.isArray(urls)) urls = [urls]
    const cleanedUrls = urls
      .map(cleanUrl)
      .filter((u) => Boolean(u) && /^https?:\/\//i.test(u))

    console.log('[IPC tasks:add] cleaned URLs count:', cleanedUrls.length, '- first:', cleanedUrls[0]?.slice(0, 80))

    if (cleanedUrls.length === 0) {
      console.error('[IPC tasks:add] Không có URL hợp lệ - raw input:', JSON.stringify(urls).slice(0, 300))
      throw new Error('Không có liên kết HTTP/HTTPS hợp lệ')
    }

    const expandedUrls = cleanedUrls.flatMap((u) => expandPattern(u))
    console.log('[IPC tasks:add] expanded:', expandedUrls.length, 'URLs')

    const addedTasks = []
    for (const url of expandedUrls) {
      const task = manager.add(url, {
        dir: opts.dir || currentSettings.downloadDir,
        filename: opts.filename || '',
        headers: opts.headers || {},
        threads: opts.threads || currentSettings.threads
      })
      addedTasks.push(task)
      console.log('[IPC tasks:add] Đã thêm task id:', task.id, 'dir:', task.dir)
    }
    console.log('[IPC tasks:add] Tổng:', addedTasks.length, 'tasks')
    return addedTasks
  })

  ipcMain.handle('tasks:list', () => {
    const list = manager.list()
    console.log('[IPC tasks:list] Số tasks:', list.length)
    return list
  })
  ipcMain.handle('tasks:pause', (_e, id) => {
    console.log('[IPC tasks:pause] id:', id)
    return manager.pause(id)
  })
  ipcMain.handle('tasks:resume', (_e, id) => {
    console.log('[IPC tasks:resume] id:', id)
    return manager.resume(id)
  })
  ipcMain.handle('tasks:pauseAll', () => manager.pauseAll())
  ipcMain.handle('tasks:resumeAll', () => manager.resumeAll())
  ipcMain.handle('tasks:clearDone', () => manager.clearDone())
  ipcMain.handle('tasks:remove', (_e, id, deleteFile) => {
    console.log('[IPC tasks:remove] id:', id, 'deleteFile:', deleteFile)
    return manager.remove(id, { deleteFile })
  })

  ipcMain.handle('settings:speedLimit', (_e, bps) => {
    manager.setSpeedLimit(bps)
    saveSettings({ speedLimit: bps })
  })

  ipcMain.handle('settings:maxConcurrent', (_e, n) => {
    manager.setMaxConcurrent(n)
    saveSettings({ maxConcurrent: n })
  })

  ipcMain.handle('settings:get', () => currentSettings)

  ipcMain.handle('settings:update', (_e, newSettings) => {
    const updated = saveSettings(newSettings)
    if (newSettings.speedLimit !== undefined) {
      manager.setSpeedLimit(newSettings.speedLimit)
    }
    if (newSettings.maxConcurrent !== undefined) {
      manager.setMaxConcurrent(newSettings.maxConcurrent)
    }
    if (newSettings.theme) {
      if (newSettings.theme === 'dark') nativeTheme.themeSource = 'dark'
      else if (newSettings.theme === 'light') nativeTheme.themeSource = 'light'
      else nativeTheme.themeSource = 'system'
    }
    if (newSettings.bridgeEnabled !== undefined || newSettings.bridgePort !== undefined) {
      startBridge(updated.bridgePort)
    }
    return updated
  })

  ipcMain.handle('dialog:selectDirectory', async (event) => {
    try {
      let defaultPath = currentSettings.downloadDir
      if (!defaultPath || !fs.existsSync(defaultPath)) {
        defaultPath = app.getPath('downloads')
      }
      if (!fs.existsSync(defaultPath)) {
        defaultPath = app.getPath('home')
      }

      // Lấy cửa sổ gốc - không gọi focus() trước dialog vì sẽ gây conflict
      const win = BrowserWindow.fromWebContents(event.sender) || mainWindow

      const dialogOptions = {
        title: 'Chọn thư mục lưu tệp tải xuống',
        defaultPath,
        properties: ['openDirectory', 'createDirectory']
      }

      let res
      if (win && !win.isDestroyed()) {
        res = await dialog.showOpenDialog(win, dialogOptions)
      } else {
        res = await dialog.showOpenDialog(dialogOptions)
      }

      console.log('[Dialog] Kết quả chọn thư mục:', res)

      if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
        const chosen = res.filePaths[0]
        currentSettings.downloadDir = chosen
        saveSettings({ downloadDir: chosen })
        return chosen
      }
    } catch (err) {
      console.error('[Dialog] Lỗi chọn thư mục:', err.message)
    }
    return null
  })

  ipcMain.handle('shell:show', (_e, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath)
    }
  })

  ipcMain.handle('shell:open', (_e, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      shell.openPath(filePath)
    }
  })

  // Tác vụ hàng loạt & Xóa tất cả
  ipcMain.handle('tasks:clearAll', (_e, deleteFiles) => {
    return manager.clearAll({ deleteFiles })
  })

  ipcMain.handle('tasks:removeBatch', (_e, ids, deleteFiles) => {
    return manager.removeBatch(ids, { deleteFiles })
  })

  ipcMain.handle('tasks:checkDuplicate', (_e, url) => {
    return manager.checkDuplicate(url)
  })

  // Auto-Updater Handlers từ GitHub
  ipcMain.handle('updater:check', async () => {
    return await checkForUpdate()
  })

  ipcMain.handle('updater:download', async (event, { downloadUrl, assetName }) => {
    return await downloadUpdateAsset(downloadUrl, assetName, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:progress', progress)
      }
    })
  })

  ipcMain.handle('updater:install', (_e, installerPath) => {
    return installUpdateFile(installerPath)
  })

  // IPC xử lý quyết định từ giao diện khi người dùng bấm Bắt đầu tải hoặc Hủy
  ipcMain.handle('bridge:decision', (_e, { downloadId, action }) => {
    if (downloadId) {
      bridgeDecisions.set(String(downloadId), { action, time: Date.now() })
      setTimeout(() => {
        bridgeDecisions.delete(String(downloadId))
      }, 60000)
    }
    return { success: true }
  })
}

// Module Kiểm tra & Tải Cập nhật từ GitHub Releases
const GITHUB_REPO = 'ductruongvu23/mydownloader'

function compareSemver(v1, v2) {
  const p1 = (v1 || '0').replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const p2 = (v2 || '0').replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0
    const num2 = p2[i] || 0
    if (num1 > num2) return 1
    if (num1 < num2) return -1
  }
  return 0
}

async function checkForUpdate() {
  const currentVersion = app.getVersion()
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        'User-Agent': `MyDownloader/${currentVersion}`
      }
    })
    if (!res.ok) {
      if (res.status === 404) {
        return { updateAvailable: false, currentVersion, message: 'Chưa có bản phát hành (release) nào trên GitHub.' }
      }
      throw new Error(`GitHub API phản hồi HTTP ${res.status}`)
    }
    const release = await res.json()
    const latestVersion = (release.tag_name || '').replace(/^v/i, '')
    const isNewer = compareSemver(latestVersion, currentVersion) > 0

    const assets = release.assets || []
    const setupAsset = assets.find((a) => a.name.endsWith('.exe'))

    return {
      updateAvailable: isNewer,
      currentVersion,
      latestVersion,
      releaseName: release.name || release.tag_name,
      releaseNotes: release.body || '',
      publishedAt: release.published_at,
      downloadUrl: setupAsset ? setupAsset.browser_download_url : release.html_url,
      assetName: setupAsset ? setupAsset.name : '',
      assetSize: setupAsset ? setupAsset.size : 0
    }
  } catch (err) {
    console.error('[Updater] Lỗi kiểm tra cập nhật:', err.message)
    return { updateAvailable: false, currentVersion, error: err.message }
  }
}

async function downloadUpdateAsset(downloadUrl, assetName, onProgress) {
  const tempDir = app.getPath('temp')
  const destPath = path.join(tempDir, assetName || `MyDownloader-Setup-${Date.now()}.exe`)

  const res = await fetch(downloadUrl, {
    headers: { 'User-Agent': `MyDownloader/${app.getVersion()}` }
  })
  if (!res.ok) throw new Error(`Tải tệp cập nhật thất bại: HTTP ${res.status}`)

  const totalBytes = Number(res.headers.get('content-length')) || 0
  const fileStream = fs.createWriteStream(destPath)
  let receivedBytes = 0

  const reader = res.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    fileStream.write(Buffer.from(value))
    receivedBytes += value.length
    if (totalBytes > 0 && onProgress) {
      const percent = Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
      onProgress({ percent, receivedBytes, totalBytes })
    }
  }

  await new Promise((resolve, reject) => {
    fileStream.end()
    fileStream.on('finish', resolve)
    fileStream.on('error', reject)
  })

  return destPath
}

function installUpdateFile(installerPath) {
  if (!installerPath || !fs.existsSync(installerPath)) {
    throw new Error('Không tìm thấy tệp cài đặt cập nhật đã tải về.')
  }
  import('child_process').then(({ spawn }) => {
    const child = spawn(installerPath, [], {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    app.isQuitting = true
    app.quit()
  })
}

app.whenReady().then(() => {
  // 1. Khởi tạo TaskManager
  manager = new TaskManager({
    storePath: path.join(app.getPath('userData'), 'tasks.json'),
    maxConcurrent: currentSettings.maxConcurrent,
    speedLimit: currentSettings.speedLimit
  })

  // Đẩy cập nhật xuống renderer + Desktop Notification
  const prevStatuses = new Map()
  manager.on('update', (task) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tasks:update', task)
    }

    if (task.status === 'done' && prevStatuses.get(task.id) !== 'done') {
      if (currentSettings.notifyOnComplete && Notification.isSupported()) {
        new Notification({
          title: 'Tải xuống hoàn tất',
          body: `${task.name || 'Tệp'} đã được tải xong thành công.`
        }).show()
      }
    }
    prevStatuses.set(task.id, task.status)
  })

  manager.on('cleared', (ids) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tasks:cleared', ids)
    }
  })

  manager.on('removed', (id) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tasks:removed', id)
    }
  })

  // 2. ĐĂNG KÝ IPC TRƯỚC KHI TẠO CỬA SỔ ĐỂ TRÁNH LỖI "No handler registered"
  registerIpcHandlers()

  // 3. Khởi động Bridge Server
  startBridge(currentSettings.bridgePort)

  // 4. Khởi tạo Tray
  setupTray()

  // 5. Khởi tạo cửa sổ
  createWindow()
})

app.on('before-quit', () => {
  app.isQuitting = true
  if (bridgeServer) {
    try {
      bridgeServer.close()
    } catch {}
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  } else if (mainWindow) {
    mainWindow.show()
  }
})

// extension/background.js - MyDownloader Chrome Extension Service Worker

const handledDownloads = new Set()

// Tạo menu chuột phải khi cài đặt hoặc khởi động extension
chrome.runtime.onInstalled.addListener(() => {
  createContextMenus()
})

chrome.runtime.onStartup.addListener(() => {
  createContextMenus()
})

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'mydownloader_link',
      title: 'Tải liên kết bằng MyDownloader',
      contexts: ['link']
    })

    chrome.contextMenus.create({
      id: 'mydownloader_media',
      title: 'Tải tệp đa phương tiện này bằng MyDownloader',
      contexts: ['image', 'video', 'audio']
    })

    chrome.contextMenus.create({
      id: 'mydownloader_selection',
      title: 'Tải liên kết được bôi đen bằng MyDownloader',
      contexts: ['selection']
    })
  })
}

// Xử lý khi người dùng nhấn menu chuột phải
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let targetUrl = ''
  if (info.menuItemId === 'mydownloader_link') {
    targetUrl = info.linkUrl
  } else if (info.menuItemId === 'mydownloader_media') {
    targetUrl = info.srcUrl
  } else if (info.menuItemId === 'mydownloader_selection') {
    const text = (info.selectionText || '').trim()
    if (/^https?:\/\//i.test(text)) {
      targetUrl = text
    }
  }

  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return
  }

  const tabReferrer = tab?.url || ''
  await sendToMyDownloader(targetUrl, tabReferrer, '', true)
})

// Tìm kiếm cổng Bridge đang hoạt động (6801 - 6805)
async function getActivePort() {
  const settings = await chrome.storage.local.get(['port'])
  const preferredPort = Number(settings.port) || 6801

  // Thử port hiện tại trước
  try {
    const res = await fetch(`http://127.0.0.1:${preferredPort}/ping`, {
      signal: AbortSignal.timeout ? AbortSignal.timeout(600) : undefined
    })
    if (res.ok) return preferredPort
  } catch {}

  // Quét nhanh các cổng lân cận nếu port 6801 bị chiếm
  for (let p = 6801; p <= 6805; p++) {
    if (p === preferredPort) continue
    try {
      const res = await fetch(`http://127.0.0.1:${p}/ping`, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(500) : undefined
      })
      if (res.ok) {
        await chrome.storage.local.set({ port: p })
        return p
      }
    } catch {}
  }
  return preferredPort
}

// Gửi liên kết sang MyDownloader
async function sendToMyDownloader(url, referrer = '', filename = '', showNotification = false) {
  const settings = await chrome.storage.local.get(['token', 'enabled'])
  if (settings.enabled === false) return false

  const port = await getActivePort()

  try {
    let cookieHeader = ''
    try {
      const cookies = await chrome.cookies.getAll({ url })
      if (cookies && cookies.length > 0) {
        cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
      }
    } catch (e) {
      console.warn('[MyDownloader] Không thể lấy cookies:', e)
    }

    const payload = {
      url,
      referrer: referrer || '',
      userAgent: navigator.userAgent,
      cookie: cookieHeader,
      filename: filename || ''
    }

    const headers = { 'Content-Type': 'application/json' }
    if (settings.token) {
      headers['X-Token'] = settings.token
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)

    const res = await fetch(`http://127.0.0.1:${port}/add`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    clearTimeout(timer)

    if (res.ok) {
      if (showNotification && chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon.png',
          title: 'MyDownloader',
          message: 'Đã gửi liên kết tải vào MyDownloader thành công!'
        })
      }
      return true
    }
  } catch (err) {
    console.debug('[MyDownloader Extension] Không kết nối được MyDownloader:', err.message)
  }
  return false
}

// Tự động bắt lượt tải từ trình duyệt
chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url
  if (!url || !/^https?:/i.test(url)) return

  // Tránh xử lý lặp lại cùng một download item
  if (handledDownloads.has(item.id)) return
  handledDownloads.add(item.id)
  setTimeout(() => handledDownloads.delete(item.id), 10000)

  // Bỏ qua nếu người dùng chủ động tắt tính năng trong popup
  const settings = await chrome.storage.local.get(['enabled'])
  if (settings.enabled === false) return

  // Bỏ qua các file đuôi .crx (cài đặt extension trình duyệt)
  if (/\.crx(\?.*)?$/i.test(url)) return

  const filename = item.filename ? item.filename.split(/[\\/]/).pop() : ''
  const referrer = item.referrer || ''

  const success = await sendToMyDownloader(url, referrer, filename, false)

  if (success) {
    try {
      // Đã chuyển sang MyDownloader thành công -> Hủy lượt tải trên Chrome
      await chrome.downloads.cancel(item.id)
      await chrome.downloads.erase({ id: item.id })
    } catch (e) {
      console.debug('[MyDownloader Extension] Lỗi khi hủy download trên Chrome:', e)
    }
  }
})

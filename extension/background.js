// extension/background.js - MyDownloader Chrome Extension Service Worker v1.2.0

const handledDownloads = new Set()
const tabMediaMap = new Map() // tabId -> Array<{ url, title, filename, ext, type }>

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
      id: 'mydownloader_image',
      title: 'Tải hình ảnh này bằng MyDownloader',
      contexts: ['image']
    })

    chrome.contextMenus.create({
      id: 'mydownloader_media',
      title: 'Tải video / âm thanh này bằng MyDownloader',
      contexts: ['video', 'audio']
    })

    chrome.contextMenus.create({
      id: 'mydownloader_selection',
      title: 'Tải liên kết được bôi đen bằng MyDownloader',
      contexts: ['selection']
    })

    chrome.contextMenus.create({
      id: 'mydownloader_page',
      title: 'Tải trang / Quét media bằng MyDownloader',
      contexts: ['page']
    })
  })
}

// Xử lý khi người dùng nhấn menu chuột phải
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let targetUrl = ''
  let filename = ''

  if (info.menuItemId === 'mydownloader_link') {
    targetUrl = info.linkUrl
  } else if (info.menuItemId === 'mydownloader_image' || info.menuItemId === 'mydownloader_media') {
    targetUrl = info.srcUrl
  } else if (info.menuItemId === 'mydownloader_selection') {
    const text = (info.selectionText || '').trim()
    if (/^https?:\/\//i.test(text)) {
      targetUrl = text
    }
  } else if (info.menuItemId === 'mydownloader_page') {
    targetUrl = tab?.url || ''
    filename = (tab?.title || 'TrangWeb') + '.html'
  }

  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    return
  }

  const tabReferrer = tab?.url || ''
  await sendToMyDownloader(targetUrl, tabReferrer, filename, true)
})

// Dọn dẹp danh sách media khi đóng tab
chrome.tabs.onRemoved.addListener((tabId) => {
  tabMediaMap.delete(tabId)
})

// Lắng nghe thông điệp từ Content Script và Popup
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'download_url') {
    sendToMyDownloader(req.url, req.referrer || '', req.filename || '', true)
      .then((res) => sendResponse({ success: Boolean(res) }))
    return true
  }

  if (req.action === 'media_detected') {
    const tabId = sender.tab ? sender.tab.id : null
    if (tabId && req.media) {
      if (!tabMediaMap.has(tabId)) {
        tabMediaMap.set(tabId, [])
      }
      const list = tabMediaMap.get(tabId)
      if (!list.some((item) => item.url === req.media.url)) {
        list.push(req.media)
        if (list.length > 50) list.shift()
      }

      // Cập nhật số lượng media lên huy hiệu của Extension Icon
      try {
        chrome.action.setBadgeText({ text: String(list.length), tabId })
        chrome.action.setBadgeBackgroundColor({ color: '#0ea5e9', tabId })
      } catch {}
    }
    sendResponse({ success: true })
    return true
  }

  if (req.action === 'get_tab_media') {
    const tabId = req.tabId
    const mediaList = tabMediaMap.get(tabId) || []
    sendResponse({ mediaList })
    return true
  }

  return true
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
async function sendToMyDownloader(url, referrer = '', filename = '', showNotification = false, downloadId = null) {
  const settings = await chrome.storage.local.get(['token', 'enabled'])
  if (settings.enabled === false) return null

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
      filename: filename || '',
      downloadId: downloadId || null
    }

    const headers = { 'Content-Type': 'application/json' }
    if (settings.token) {
      headers['X-Token'] = settings.token
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3500)

    const res = await fetch(`http://127.0.0.1:${port}/add`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    })
    clearTimeout(timer)

    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      if (showNotification && chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon.png',
          title: 'MyDownloader',
          message: 'Đã gửi liên kết tải vào MyDownloader thành công!'
        })
      }
      return { success: true, port, data }
    }
  } catch (err) {
    console.debug('[MyDownloader Extension] Không kết nối được MyDownloader:', err.message)
  }
  return null
}

// Chờ phản hồi quyết định của người dùng trên MyDownloader (Started / Cancelled)
async function waitForBridgeDecision(port, downloadId, timeoutMs = 35000) {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/bridge/decision?id=${encodeURIComponent(downloadId)}`, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(1000) : undefined
      })
      if (res.ok) {
        const body = await res.json()
        if (body.action === 'started') return 'started'
        if (body.action === 'cancelled') return 'cancelled'
      }
    } catch {}

    // Nghỉ 400ms trước khi kiểm tra lại
    await new Promise((resolve) => setTimeout(resolve, 400))
  }

  // Quá thời gian chờ (hết 35s mà người dùng chưa bấm)
  return 'timeout'
}

// Tự động bắt lượt tải từ trình duyệt với cơ chế Hoãn Hủy (Pause -> Confirm -> Cancel / Resume)
chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url
  if (!url || !/^https?:/i.test(url)) return

  // Tránh xử lý lặp lại cùng một download item
  if (handledDownloads.has(item.id)) return
  handledDownloads.add(item.id)
  setTimeout(() => handledDownloads.delete(item.id), 20000)

  // Bỏ qua nếu người dùng chủ động tắt tính năng trong popup
  const settings = await chrome.storage.local.get(['enabled'])
  if (settings.enabled === false) return

  // Bỏ qua các file đuôi .crx (cài đặt extension trình duyệt)
  if (/\.crx(\?.*)?$/i.test(url)) return

  console.log(`[MyDownloader Extension] Bắt lượt tải mới (ID: ${item.id}):`, url)

  // BƯỚC 1: Tạm dừng lượt tải trên Chrome để giữ chỗ, không để Chrome tải ngốn mạng và rác đĩa
  try {
    await chrome.downloads.pause(item.id)
  } catch (err) {
    console.debug('[MyDownloader Extension] Không thể tạm dừng download:', err.message)
  }

  const filename = item.filename ? item.filename.split(/[\\/]/).pop() : ''
  const referrer = item.referrer || ''

  // BƯỚC 2: Gửi link và downloadId sang MyDownloader
  const sendResult = await sendToMyDownloader(url, referrer, filename, false, item.id)

  if (sendResult && sendResult.success) {
    // Nếu app đã tự động tải ngay (autoDownloadFromExtension: true)
    if (sendResult.data && sendResult.data.id) {
      try {
        await chrome.downloads.cancel(item.id)
        await chrome.downloads.erase({ id: item.id })
      } catch {}
      return
    }

    // BƯỚC 3: Cửa sổ MyDownloader đang hiện menu hỏi xác nhận (AddTaskModal).
    // Đợi người dùng đưa ra quyết định:
    const decision = await waitForBridgeDecision(sendResult.port, item.id, 35000)

    if (decision === 'started') {
      // Người dùng bấm "Bắt đầu tải" -> Bây giờ mới hủy download trên Chrome!
      try {
        console.log(`[MyDownloader Extension] Người dùng xác nhận tải. Đang hủy download Chrome (ID: ${item.id})...`)
        await chrome.downloads.cancel(item.id)
        await chrome.downloads.erase({ id: item.id })
      } catch (e) {
        console.debug('[MyDownloader Extension] Lỗi khi hủy download Chrome:', e)
      }
    } else {
      // Người dùng bấm "Hủy" hoặc đóng popup hoặc hết hạn 35s -> Tiếp tục tải trên Chrome bình thường!
      try {
        console.log(`[MyDownloader Extension] Quyết định là '${decision}'. Đang cho Chrome tiếp tục tải bình thường...`)
        await chrome.downloads.resume(item.id)
      } catch (e) {
        console.debug('[MyDownloader Extension] Lỗi khi tiếp tục download Chrome:', e)
      }
    }
  } else {
    // Nếu không kết nối được MyDownloader (app chưa bật) -> Cho Chrome tiếp tục tải bình thường
    try {
      await chrome.downloads.resume(item.id)
    } catch {}
  }
})

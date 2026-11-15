// extension/background.js - MyDownloader Chrome Extension Service Worker v2.0.0
// Nói chuyện với app qua native messaging (mydownloader-host.exe): app đang tắt thì host tự mở app.

const handledDownloads = new Set()
const tabMediaMap = new Map() // tabId -> Array<{ url, title, filename, ext, type }>

// Service worker MV3 tự ngủ sau ~30s nên Map trong RAM bị mất: lưu thêm vào storage.session và nạp lại khi thức dậy
const mediaReady = chrome.storage.session
  .get(null)
  .then((all) => {
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith('media_') && !tabMediaMap.has(Number(k.slice(6)))) tabMediaMap.set(Number(k.slice(6)), v)
    }
  })
  .catch(() => {})

function persistTabMedia(tabId) {
  chrome.storage.session.set({ [`media_${tabId}`]: tabMediaMap.get(tabId) }).catch(() => {})
}

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

  const res = await sendToApp(targetUrl, tab?.url || '', filename, false)
  if (res.ok) notify('Đã gửi liên kết sang MyDownloader')
})

// Dọn dẹp danh sách media khi đóng tab
chrome.tabs.onRemoved.addListener((tabId) => {
  tabMediaMap.delete(tabId)
  chrome.storage.session.remove(`media_${tabId}`).catch(() => {})
})

// Định dạng media và pattern video streaming cần sniff
const MEDIA_EXTENSIONS = /\.(mp4|webm|mkv|m4v|mov|flv|avi|mp3|m4a|aac|ogg|wav|ts|m3u8|mpd)(\?.*)?$/i
const GOOGLEVIDEO_PATTERN = /googlevideo\.com\/videoplayback/i

function cleanMediaUrl(rawUrl) {
  try {
    const u = new URL(rawUrl)
    // Nếu là googlevideo.com, loại bỏ các tham số chia đoạn để tải trọn tệp
    if (GOOGLEVIDEO_PATTERN.test(u.hostname + u.pathname)) {
      u.searchParams.delete('range')
      u.searchParams.delete('rn')
      u.searchParams.delete('rbuf')
      return u.toString()
    }
  } catch {}
  return rawUrl
}

async function addMediaToTab(tabId, url, type = 'video', title = '') {
  if (!tabId || tabId <= 0 || !url || /^blob:/i.test(url) || /^data:/i.test(url)) return
  await mediaReady
  if (!tabMediaMap.has(tabId)) {
    tabMediaMap.set(tabId, [])
  }
  const list = tabMediaMap.get(tabId)
  const cleanedUrl = cleanMediaUrl(url)
  if (list.some((item) => item.url === cleanedUrl || item.url === url)) return

  let ext = 'MP4'
  if (/\.m3u8(\?.*)?$/i.test(url)) ext = 'M3U8'
  else if (/\.mpd(\?.*)?$/i.test(url)) ext = 'MPD'
  else if (/\.webm(\?.*)?$/i.test(url)) ext = 'WEBM'
  else if (/\.mp3(\?.*)?$/i.test(url)) ext = 'MP3'
  else if (/\.m4a(\?.*)?$/i.test(url)) ext = 'M4A'

  const filename = `${title || 'Video_' + Date.now()}.${ext.toLowerCase()}`

  list.push({
    url: cleanedUrl,
    title: title || 'Video Media',
    filename,
    ext,
    type,
    time: Date.now()
  })

  if (list.length > 50) list.shift()
  persistTabMedia(tabId)

  try {
    chrome.action.setBadgeText({ text: String(list.length), tabId })
    chrome.action.setBadgeBackgroundColor({ color: '#0ea5e9', tabId })
  } catch {}
}

// Bắt luồng mạng webRequest đối với các tệp video/audio thực tế
if (chrome.webRequest) {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      const url = details.url
      if (!url || details.tabId <= 0) return
      if (MEDIA_EXTENSIONS.test(url) || GOOGLEVIDEO_PATTERN.test(url)) {
        addMediaToTab(details.tabId, url, 'video')
      }
    },
    { urls: ['<all_urls>'] }
  )

  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (!details.url || details.tabId <= 0) return
      const ctHeader = details.responseHeaders?.find((h) => h.name.toLowerCase() === 'content-type')
      const ct = ctHeader ? ctHeader.value.toLowerCase() : ''
      if (
        ct.startsWith('video/') ||
        ct.startsWith('audio/') ||
        ct.includes('application/vnd.apple.mpegurl') ||
        ct.includes('application/x-mpegurl')
      ) {
        addMediaToTab(details.tabId, details.url, ct.startsWith('audio/') ? 'audio' : 'video')
      }
    },
    { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
    ['responseHeaders']
  )
}

// Lắng nghe thông điệp từ Content Script và Popup
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'download_url') {
    sendToApp(req.url, req.referrer || '', req.filename || '', false).then((res) => {
      if (res.ok) notify('Đã gửi liên kết sang MyDownloader')
      sendResponse({ success: res.ok, error: res.error })
    })
    return true
  }

  if (req.action === 'ping_app') {
    nativeCall({ cmd: 'ping' }, 8000).then(sendResponse)
    return true
  }

  if (req.action === 'media_detected') {
    const tabId = sender.tab ? sender.tab.id : null
    if (tabId && req.media) {
      addMediaToTab(tabId, req.media.url, req.media.type || 'video', req.media.title)
    }
    sendResponse({ success: true })
    return true
  }

  if (req.action === 'get_tab_best_media') {
    const tabId = sender.tab ? sender.tab.id : req.tabId
    mediaReady.then(() => {
      const mediaList = tabMediaMap.get(tabId) || []
      // Ưu tiên tệp video thực sự, loại trừ audio thuần nếu có video
      const videos = mediaList.filter((m) => m.type === 'video')
      const best =
        videos.length > 0
          ? videos[videos.length - 1]
          : mediaList.length > 0
            ? mediaList[mediaList.length - 1]
            : null
      sendResponse({ media: best, mediaList })
    })
    return true
  }

  if (req.action === 'get_tab_media') {
    mediaReady.then(() => sendResponse({ mediaList: tabMediaMap.get(req.tabId) || [] }))
    return true
  }

  return false
})

const NATIVE_HOST = 'com.mydownloader.host'

// Gửi 1 lệnh tới app qua native host. Cổng native giữ service worker sống trong lúc chờ
// người dùng quyết định trên hộp thoại của app (app tự hết hạn sau 110 giây).
function nativeCall(msg, timeoutMs = 120000) {
  return new Promise((resolve) => {
    let port
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST)
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message ? e.message : e) })
      return
    }
    let finished = false
    const done = (res) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      try {
        port.disconnect()
      } catch {}
      resolve(res)
    }
    const timer = setTimeout(() => done({ ok: false, error: 'timeout' }), timeoutMs)
    port.onMessage.addListener((res) => done(res || { ok: false, error: 'empty' }))
    port.onDisconnect.addListener(() => done({ ok: false, error: chrome.runtime.lastError?.message || 'disconnected' }))
    port.postMessage(msg)
  })
}

function notify(message) {
  try {
    chrome.notifications.create({ type: 'basic', iconUrl: 'icon.png', title: 'MyDownloader', message })
  } catch {}
}

// Báo một lần khi chưa kết nối được app (chưa cài / chưa mở app lần nào để đăng ký với trình duyệt)
let warnedMissingApp = false
function warnMissingApp(error) {
  chrome.action.setBadgeText({ text: '!' }).catch(() => {})
  chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }).catch(() => {})
  if (warnedMissingApp) return
  warnedMissingApp = true
  console.warn('[MyDownloader] Không kết nối được app:', error)
  notify('Không kết nối được MyDownloader. Hãy mở MyDownloader một lần để app đăng ký với trình duyệt.')
}

async function cookiesFor(url, referrer) {
  try {
    let cookies = await chrome.cookies.getAll({ url })
    // CDN (tiktokcdn, googlevideo, fbcdn...) thường không có cookie riêng: lấy của trang gốc
    if ((!cookies || cookies.length === 0) && /^https?:\/\//i.test(referrer)) {
      cookies = await chrome.cookies.getAll({ url: referrer })
    }
    return (cookies || []).map((c) => `${c.name}=${c.value}`).join('; ')
  } catch {
    return ''
  }
}

// wait = true: download của trình duyệt đang tạm dừng, chờ người dùng chọn trên app
async function sendToApp(url, referrer = '', filename = '', wait = false) {
  const { enabled } = await chrome.storage.local.get('enabled')
  if (enabled === false) return { ok: false, error: 'disabled' }
  const res = await nativeCall({
    cmd: 'add',
    url,
    referrer,
    cookie: await cookiesFor(url, referrer),
    userAgent: navigator.userAgent,
    filename,
    wait
  })
  if (res.ok) {
    chrome.action.setBadgeText({ text: '' }).catch(() => {})
  } else {
    warnMissingApp(res.error)
  }
  return res
}

// Bắt lượt tải của trình duyệt: tạm dừng -> hỏi app -> hủy bản của trình duyệt hoặc cho tải tiếp
chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url
  if (!url || !/^https?:/i.test(url) || item.state === 'complete') return
  if (handledDownloads.has(item.id)) return
  handledDownloads.add(item.id)
  setTimeout(() => handledDownloads.delete(item.id), 180000)

  const { enabled } = await chrome.storage.local.get('enabled')
  if (enabled === false) return
  // Tệp cài extension (.crx) phải để trình duyệt tự xử lý
  if (/\.crx(\?.*)?$/i.test(url)) return

  try {
    await chrome.downloads.pause(item.id)
  } catch {}

  const filename = item.filename ? item.filename.split(/[\/]/).pop() : ''
  const res = await sendToApp(url, item.referrer || '', filename, true)

  // started: app tải; duplicate: app đang tải link này rồi -> trình duyệt bỏ bản của nó
  if (res.ok && (res.action === 'started' || res.action === 'duplicate')) {
    try {
      await chrome.downloads.cancel(item.id)
      await chrome.downloads.erase({ id: item.id })
    } catch {}
  } else {
    // Người dùng bấm Hủy, hết giờ, hoặc không có app -> trình duyệt tải tiếp như bình thường
    try {
      await chrome.downloads.resume(item.id)
    } catch {}
  }
})

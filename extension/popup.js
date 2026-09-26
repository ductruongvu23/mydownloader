// extension/popup.js - MyDownloader Extension Controller v1.0.6

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const tabSettingsBtn = document.getElementById('tabSettingsBtn')
  const tabMediaBtn = document.getElementById('tabMediaBtn')
  const tabMediaBadge = document.getElementById('tabMediaBadge')
  const tabSettingsContent = document.getElementById('tabSettingsContent')
  const tabMediaContent = document.getElementById('tabMediaContent')

  const statusCard = document.getElementById('statusCard')
  const statusText = document.getElementById('statusText')
  const enabledInput = document.getElementById('enabledInput')
  const videoBarInput = document.getElementById('videoBarInput')
  const portInput = document.getElementById('portInput')
  const checkBtn = document.getElementById('checkBtn')
  const quickUrl = document.getElementById('quickUrl')
  const quickAddBtn = document.getElementById('quickAddBtn')
  const quickMsg = document.getElementById('quickMsg')

  const scanMediaBtn = document.getElementById('scanMediaBtn')
  const mediaListContainer = document.getElementById('mediaListContainer')
  const extVersionText = document.getElementById('extVersionText')

  // Hiển thị phiên bản extension thực tế từ manifest
  try {
    const manifest = chrome.runtime.getManifest()
    if (extVersionText && manifest?.version) {
      extVersionText.textContent = `Extension v${manifest.version}`
    }
  } catch {}

  // Tab switching
  tabSettingsBtn.addEventListener('click', () => {
    tabSettingsBtn.classList.add('active')
    tabMediaBtn.classList.remove('active')
    tabSettingsContent.style.display = 'block'
    tabMediaContent.style.display = 'none'
  })

  tabMediaBtn.addEventListener('click', () => {
    tabMediaBtn.classList.add('active')
    tabSettingsBtn.classList.remove('active')
    tabMediaContent.style.display = 'block'
    tabSettingsContent.style.display = 'none'
    loadTabMedia()
  })

  // Đọc thiết lập đã lưu
  const stored = await chrome.storage.local.get(['port', 'enabled', 'token', 'videoBarEnabled'])
  if (stored.port) portInput.value = stored.port
  if (stored.enabled !== undefined) enabledInput.checked = stored.enabled
  if (stored.videoBarEnabled !== undefined) videoBarInput.checked = stored.videoBarEnabled

  // Toggles
  enabledInput.addEventListener('change', async () => {
    await chrome.storage.local.set({ enabled: enabledInput.checked })
  })

  videoBarInput.addEventListener('change', async () => {
    await chrome.storage.local.set({ videoBarEnabled: videoBarInput.checked })
  })

  // Kiểm tra kết nối với MyDownloader Bridge
  async function checkConnection(manual = false) {
    let port = Number(portInput.value) || 6801
    statusCard.className = 'status-card disconnected'
    statusText.textContent = `Đang kết nối cổng ${port}...`

    try {
      const res = await fetch(`http://127.0.0.1:${port}/ping`, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(800) : undefined
      })
      if (res.ok) {
        const data = await res.json()
        statusCard.className = 'status-card connected'
        statusText.textContent = `🟢 Đã kết nối MyDownloader v${data.version || '1.0.1'}`
        if (data.token) {
          await chrome.storage.local.set({ token: data.token, port })
        }
        return true
      }
    } catch {}

    // Quét nhanh các cổng lân cận 6801-6805
    for (let p = 6801; p <= 6805; p++) {
      if (p === port) continue
      try {
        const res = await fetch(`http://127.0.0.1:${p}/ping`, {
          signal: AbortSignal.timeout ? AbortSignal.timeout(500) : undefined
        })
        if (res.ok) {
          const data = await res.json()
          portInput.value = p
          await chrome.storage.local.set({ port: p, token: data.token || '' })
          statusCard.className = 'status-card connected'
          statusText.textContent = `🟢 Đã kết nối MyDownloader (cổng ${p})`
          return true
        }
      } catch {}
    }

    statusCard.className = 'status-card disconnected'
    statusText.textContent = '🔴 Không tìm thấy app (Hãy mở MyDownloader)'
    return false
  }

  // Chạy kiểm tra kết nối ngay
  await checkConnection()

  checkBtn.addEventListener('click', async () => {
    const port = Number(portInput.value) || 6801
    await chrome.storage.local.set({ port })
    await checkConnection(true)
  })

  // Gửi link nhanh
  quickAddBtn.addEventListener('click', async () => {
    const url = quickUrl.value.trim()
    if (!url || !/^https?:\/\//i.test(url)) {
      quickMsg.style.color = '#f87171'
      quickMsg.textContent = 'Vui lòng nhập đường link HTTP/HTTPS hợp lệ.'
      return
    }

    quickMsg.style.color = '#94a3b8'
    quickMsg.textContent = 'Đang gửi...'

    const port = Number(portInput.value) || 6801
    const s = await chrome.storage.local.get(['token'])

    try {
      const headers = { 'Content-Type': 'application/json' }
      if (s.token) headers['X-Token'] = s.token

      const res = await fetch(`http://127.0.0.1:${port}/add`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url,
          userAgent: navigator.userAgent
        })
      })

      if (res.ok) {
        quickMsg.style.color = '#4ade80'
        quickMsg.textContent = '✅ Đã thêm vào MyDownloader thành công!'
        quickUrl.value = ''
        setTimeout(() => { quickMsg.textContent = '' }, 3000)
      } else {
        const data = await res.json().catch(() => ({}))
        quickMsg.style.color = '#f87171'
        quickMsg.textContent = `Lỗi: ${data.error || 'App từ chối nhận link'}`
      }
    } catch (err) {
      quickMsg.style.color = '#f87171'
      quickMsg.textContent = 'Không thể kết nối đến MyDownloader. Hãy chắc chắn app đang chạy.'
    }
  })

  // Quét và hiển thị Media của tab hiện tại
  async function loadTabMedia() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab || !tab.id) return

      // Yêu cầu background trả về danh sách media đã bắt được
      chrome.runtime.sendMessage({ action: 'get_tab_media', tabId: tab.id }, async (response) => {
        let mediaList = (response && response.mediaList) || []

        // Nếu background chưa có, thử hỏi trực tiếp content script của tab
        if (mediaList.length === 0) {
          try {
            const pageRes = await chrome.tabs.sendMessage(tab.id, { action: 'get_page_media' })
            if (pageRes && pageRes.mediaList) {
              mediaList = pageRes.mediaList
            }
          } catch {}
        }

        renderMediaList(mediaList, tab)
      })
    } catch (e) {
      console.error('Lỗi khi lấy media tab:', e)
    }
  }

  function renderMediaList(list, currentTab) {
    if (!list || list.length === 0) {
      tabMediaBadge.style.display = 'none'
      mediaListContainer.innerHTML = `
        <div class="media-empty">
          <span class="media-empty-icon">🎬</span>
          Chưa phát hiện video hoặc âm thanh nào đang phát trên tab này.<br>Hãy phát video trên trang web rồi mở lại.
        </div>
      `
      return
    }

    tabMediaBadge.textContent = String(list.length)
    tabMediaBadge.style.display = 'inline-block'

    mediaListContainer.innerHTML = ''
    list.forEach((item, idx) => {
      const card = document.createElement('div')
      card.className = 'media-card'

      const title = item.title || currentTab.title || 'Video'
      const ext = item.ext || 'MP4'
      const displayUrl = item.url.length > 55 ? item.url.slice(0, 52) + '...' : item.url

      card.innerHTML = `
        <div class="media-header">
          <span class="media-title" title="${item.url}">${title}</span>
          <span class="media-badge">${ext}</span>
        </div>
        <div class="media-url" title="${item.url}">${displayUrl}</div>
        <div class="media-actions">
          <button class="media-btn btn-primary download-btn">⬇ Tải với MyDownloader</button>
          <button class="media-btn btn-secondary copy-btn">📋 Sao chép</button>
        </div>
      `

      const downloadBtn = card.querySelector('.download-btn')
      const copyBtn = card.querySelector('.copy-btn')

      downloadBtn.addEventListener('click', () => {
        downloadBtn.textContent = 'Đang chuyển...'
        chrome.runtime.sendMessage({
          action: 'download_url',
          url: item.url,
          filename: item.filename || `${title}.${ext.toLowerCase()}`,
          referrer: currentTab.url || ''
        }, (res) => {
          if (res && res.success) {
            downloadBtn.textContent = '✓ Đã nhận!'
            setTimeout(() => { downloadBtn.textContent = '⬇ Tải với MyDownloader' }, 2000)
          } else {
            downloadBtn.textContent = 'Lỗi gửi app'
          }
        })
      })

      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(item.url)
        copyBtn.textContent = '✓ Đã chép'
        setTimeout(() => { copyBtn.textContent = '📋 Sao chép' }, 1500)
      })

      mediaListContainer.appendChild(card)
    })
  }

  scanMediaBtn.addEventListener('click', async () => {
    scanMediaBtn.textContent = '⏳ Đang quét...'
    await loadTabMedia()
    setTimeout(() => {
      scanMediaBtn.textContent = '🔄 Quét lại video trên trang này'
    }, 600)
  })

  // Tự động kiểm tra số lượng media ban đầu để hiện badge trên tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab && tab.id) {
      chrome.runtime.sendMessage({ action: 'get_tab_media', tabId: tab.id }, (res) => {
        if (res && res.mediaList && res.mediaList.length > 0) {
          tabMediaBadge.textContent = String(res.mediaList.length)
          tabMediaBadge.style.display = 'inline-block'
        }
      })
    }
  } catch {}
})

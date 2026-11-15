// extension/popup.js - MyDownloader Extension Controller v2.0.0

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
  const stored = await chrome.storage.local.get(['enabled', 'videoBarEnabled'])
  if (stored.enabled !== undefined) enabledInput.checked = stored.enabled
  if (stored.videoBarEnabled !== undefined) videoBarInput.checked = stored.videoBarEnabled

  // Toggles
  enabledInput.addEventListener('change', async () => {
    await chrome.storage.local.set({ enabled: enabledInput.checked })
  })

  videoBarInput.addEventListener('change', async () => {
    await chrome.storage.local.set({ videoBarEnabled: videoBarInput.checked })
  })

  // Kiểm tra kết nối qua native host (không mở app nếu app đang tắt)
  async function checkConnection() {
    statusCard.className = 'status-card disconnected'
    statusText.textContent = 'Đang kiểm tra kết nối app...'
    const res = await chrome.runtime.sendMessage({ action: 'ping_app' }).catch((e) => ({ ok: false, error: String(e) }))
    if (res && res.ok && res.running) {
      statusCard.className = 'status-card connected'
      statusText.textContent = `🟢 Đã kết nối MyDownloader v${res.version || ''}`
    } else if (res && res.ok) {
      statusCard.className = 'status-card connected'
      statusText.textContent = '🟡 MyDownloader đang tắt — sẽ tự mở khi có link tải'
    } else {
      statusCard.className = 'status-card disconnected'
      statusText.textContent = '🔴 Chưa kết nối được app. Hãy mở MyDownloader một lần để app đăng ký với trình duyệt.'
      statusText.title = (res && res.error) || ''
    }
  }

  checkConnection()
  checkBtn.addEventListener('click', checkConnection)

  // Gửi link nhanh
  quickAddBtn.addEventListener('click', async () => {
    const url = quickUrl.value.trim()
    if (!url || !/^(https?:\/\/|magnet:)/i.test(url)) {
      quickMsg.style.color = '#f87171'
      quickMsg.textContent = 'Vui lòng nhập liên kết http(s) hoặc magnet hợp lệ.'
      return
    }
    quickMsg.style.color = '#94a3b8'
    quickMsg.textContent = 'Đang gửi...'
    const res = await chrome.runtime.sendMessage({ action: 'download_url', url }).catch((e) => ({ success: false, error: String(e) }))
    if (res && res.success) {
      quickMsg.style.color = '#4ade80'
      quickMsg.textContent = '✅ Đã gửi sang MyDownloader!'
      quickUrl.value = ''
      setTimeout(() => {
        quickMsg.textContent = ''
      }, 3000)
    } else {
      quickMsg.style.color = '#f87171'
      quickMsg.textContent = `Không gửi được: ${(res && res.error) || 'không kết nối được app'}`
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
          <span class="media-title"></span>
          <span class="media-badge"></span>
        </div>
        <div class="media-url"></div>
        <div class="media-actions">
          <button class="media-btn btn-primary download-btn">⬇ Tải với MyDownloader</button>
          <button class="media-btn btn-secondary copy-btn">📋 Sao chép</button>
        </div>
      `
      // Title/URL đến từ trang web nên gán bằng textContent, không chèn thẳng vào HTML
      const titleEl = card.querySelector('.media-title')
      titleEl.textContent = title
      titleEl.title = item.url
      card.querySelector('.media-badge').textContent = ext
      const urlEl = card.querySelector('.media-url')
      urlEl.textContent = displayUrl
      urlEl.title = item.url

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

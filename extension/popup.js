// extension/popup.js
document.addEventListener('DOMContentLoaded', async () => {
  const statusCard = document.getElementById('statusCard')
  const statusText = document.getElementById('statusText')
  const enabledInput = document.getElementById('enabledInput')
  const portInput = document.getElementById('portInput')
  const checkBtn = document.getElementById('checkBtn')
  const quickUrl = document.getElementById('quickUrl')
  const quickAddBtn = document.getElementById('quickAddBtn')
  const quickMsg = document.getElementById('quickMsg')

  // Đọc thiết lập đã lưu
  const stored = await chrome.storage.local.get(['port', 'enabled', 'token'])
  if (stored.port) portInput.value = stored.port
  if (stored.enabled !== undefined) enabledInput.checked = stored.enabled

  // Hàm kiểm tra kết nối với MyDownloader
  async function checkConnection(manual = false) {
    let port = Number(portInput.value) || 6801
    statusCard.className = 'status-card disconnected'
    statusText.textContent = `Đang kết nối cổng ${port}...`

    // Thử port hiện tại
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ping`, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(1000) : undefined
      })
      if (res.ok) {
        const data = await res.json()
        statusCard.className = 'status-card connected'
        statusText.textContent = `🟢 Đã kết nối MyDownloader v${data.version || '1.0'}`
        if (data.token) {
          await chrome.storage.local.set({ token: data.token, port })
        }
        return true
      }
    } catch {}

    // Nếu không được, quét tự động các cổng 6801-6805
    for (let p = 6801; p <= 6805; p++) {
      if (p === port) continue
      try {
        const res = await fetch(`http://127.0.0.1:${p}/ping`, {
          signal: AbortSignal.timeout ? AbortSignal.timeout(600) : undefined
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

  // Chạy kiểm tra kết nối ngay khi mở popup
  await checkConnection()

  // Bật/tắt tự động bắt link
  enabledInput.addEventListener('change', async () => {
    await chrome.storage.local.set({ enabled: enabledInput.checked })
  })

  // Đổi cổng
  portInput.addEventListener('change', async () => {
    const port = Number(portInput.value) || 6801
    await chrome.storage.local.set({ port })
    await checkConnection(true)
  })

  // Nút kiểm tra lại
  checkBtn.addEventListener('click', async () => {
    await checkConnection(true)
  })

  // Nút gửi nhanh link vào app
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
    const stored = await chrome.storage.local.get(['token'])

    try {
      const headers = { 'Content-Type': 'application/json' }
      if (stored.token) headers['X-Token'] = stored.token

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
})

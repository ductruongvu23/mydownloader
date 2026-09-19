// extension/background.js
chrome.downloads.onCreated.addListener(async (item) => {
  const url = item.finalUrl || item.url
  if (!/^https?:/i.test(url)) return // Bỏ qua blob:, data:, chrome-extension:...

  const settings = await chrome.storage.local.get(['token', 'port', 'enabled'])
  if (settings.enabled === false) return

  const token = settings.token
  const port = settings.port || 6801
  if (!token) return

  try {
    const cookies = await chrome.cookies.getAll({ url })
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

    const res = await fetch(`http://127.0.0.1:${port}/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Token': token
      },
      body: JSON.stringify({
        url,
        referrer: item.referrer || '',
        userAgent: navigator.userAgent,
        cookie: cookieHeader,
        filename: item.filename ? item.filename.split(/[\\/]/).pop() : ''
      })
    })

    if (res.ok) {
      // Khi app MyDownloader đã nhận task thành công, hủy lượt tải của trình duyệt
      await chrome.downloads.cancel(item.id)
      await chrome.downloads.erase({ id: item.id })
    }
  } catch (err) {
    // Nếu app MyDownloader chưa bật, để trình duyệt tải như bình thường
    console.debug('[MyDownloader Extension] App chưa mở hoặc lỗi kết nối:', err.message)
  }
})

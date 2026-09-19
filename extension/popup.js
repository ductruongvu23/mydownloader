// extension/popup.js
document.addEventListener('DOMContentLoaded', async () => {
  const tokenInput = document.getElementById('token')
  const portInput = document.getElementById('port')
  const enabledInput = document.getElementById('enabled')
  const saveBtn = document.getElementById('saveBtn')
  const statusDiv = document.getElementById('status')

  const stored = await chrome.storage.local.get(['token', 'port', 'enabled'])
  if (stored.token) tokenInput.value = stored.token
  if (stored.port) portInput.value = stored.port
  if (stored.enabled !== undefined) enabledInput.checked = stored.enabled

  async function checkHealth(port, token) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ping`)
      if (res.ok) {
        statusDiv.textContent = 'Đã kết nối với MyDownloader'
        statusDiv.className = 'status connected'
        return true
      }
    } catch {}
    statusDiv.textContent = 'Không tìm thấy MyDownloader (Hãy mở app)'
    statusDiv.className = 'status disconnected'
    return false
  }

  if (portInput.value) {
    checkHealth(portInput.value, tokenInput.value)
  }

  saveBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim()
    const port = Number(portInput.value) || 6801
    const enabled = enabledInput.checked

    await chrome.storage.local.set({ token, port, enabled })
    await checkHealth(port, token)
  })
})

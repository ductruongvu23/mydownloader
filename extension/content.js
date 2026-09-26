// extension/content.js - MyDownloader Media Sniffer & Floating Download Bar
// Tương thích tối đa, chống lỗi 'Extension context invalidated' khi cập nhật / tải lại extension

;(function () {
  'use strict'

  let isInvalidated = false
  let videoBarEnabled = true
  let observer = null
  const intervals = new Set()

  function isContextValid() {
    if (isInvalidated) return false
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        isInvalidated = true
        return false
      }
      return true
    } catch {
      isInvalidated = true
      return false
    }
  }

  function cleanupOnInvalidated() {
    isInvalidated = true
    try {
      if (observer) {
        observer.disconnect()
        observer = null
      }
    } catch {}
    intervals.forEach((timer) => {
      try { clearInterval(timer) } catch {}
    })
    intervals.clear()
    try {
      if (typeof scanDebounceTimer !== 'undefined' && scanDebounceTimer) {
        clearTimeout(scanDebounceTimer)
        scanDebounceTimer = null
      }
    } catch {}
    try {
      if (typeof activeBars !== 'undefined') {
        activeBars.clear()
      }
    } catch {}
    try {
      document.querySelectorAll('.mydownloader-floating-bar').forEach((b) => b.remove())
    } catch {}
  }

  // Bắt lỗi toàn cục ngăn chặn console cảnh báo lỗi context invalidated từ Chrome
  window.addEventListener(
    'error',
    (event) => {
      if (event?.message && event.message.includes('Extension context invalidated')) {
        event.stopImmediatePropagation()
        cleanupOnInvalidated()
      }
    },
    true
  )

  // Gửi thông điệp an toàn tới background script
  function safeSendMessage(payload, callback) {
    if (!isContextValid()) {
      cleanupOnInvalidated()
      return
    }
    try {
      chrome.runtime.sendMessage(payload, (res) => {
        const err = chrome.runtime?.lastError
        if (err) {
          if (err.message && err.message.includes('Extension context invalidated')) {
            cleanupOnInvalidated()
          }
          return
        }
        if (callback && typeof callback === 'function') {
          callback(res)
        }
      })
    } catch (err) {
      if (err?.message && err.message.includes('Extension context invalidated')) {
        cleanupOnInvalidated()
      }
    }
  }

  // Đọc cài đặt hiển thị nút nổi
  try {
    if (isContextValid() && chrome.storage?.local) {
      chrome.storage.local.get(['videoBarEnabled'], (res) => {
        if (!isContextValid()) return
        if (res && res.videoBarEnabled !== undefined) {
          videoBarEnabled = res.videoBarEnabled
        }
      })
    }
  } catch {}

  // Lắng nghe thay đổi cài đặt từ popup
  try {
    if (isContextValid() && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!isContextValid()) return
        if (area === 'local' && changes.videoBarEnabled) {
          videoBarEnabled = changes.videoBarEnabled.newValue
          document.querySelectorAll('.mydownloader-floating-bar').forEach((bar) => {
            bar.style.display = videoBarEnabled ? 'inline-flex' : 'none'
          })
        }
      })
    }
  } catch {}

  const handledVideos = new WeakSet()
  const reportedMediaUrls = new Set()

  // Icon SVG tải xuống
  const DOWNLOAD_SVG = `
    <svg class="mydownloader-floating-icon" viewBox="0 0 24 24">
      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
    </svg>
  `

  function cleanTitle(str) {
    if (!str) return 'Video'
    return str
      .replace(/^\(\d+\)\s*/, '') // Xóa số thông báo YouTube (1) Video...
      .replace(/\s*-\s*YouTube$/i, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
  }

  // Bóc tách luồng phát trực tiếp từ YouTube khi xem video
  function extractYouTubeStream() {
    try {
      if (!location.hostname.includes('youtube.com') && !location.hostname.includes('youtu.be')) {
        return null
      }
      const scripts = document.querySelectorAll('script')
      for (const s of scripts) {
        const txt = s.textContent || ''
        if (txt.includes('ytInitialPlayerResponse')) {
          const m = txt.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/)
          if (m) {
            const data = JSON.parse(m[1])
            const formats = data?.streamingData?.formats || []
            // Ưu tiên itag 22 (720p có âm thanh) hoặc itag 18 (360p có âm thanh)
            const best = formats.find((f) => f.itag === 22) || formats.find((f) => f.itag === 18) || formats[0]
            if (best && best.url) {
              return {
                url: best.url,
                title: data?.videoDetails?.title || cleanTitle(document.title),
                ext: 'MP4'
              }
            }
          }
        }
      }
    } catch {}
    return null
  }

  // Bóc tách luồng phát trực tiếp từ TikTok khi xem video
  function extractTikTokStream() {
    try {
      if (!location.hostname.includes('tiktok.com')) {
        return null
      }

      // 1. Thử đọc từ thẻ __UNIVERSAL_DATA_FOR_REHYDRATION__ (chuẩn mới nhất của TikTok Web)
      const rehydrationEl = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')
      if (rehydrationEl && rehydrationEl.textContent) {
        try {
          const data = JSON.parse(rehydrationEl.textContent)
          const defaultScope = data?.['__DEFAULT_SCOPE__'] || {}
          const itemStruct =
            defaultScope['webapp.video-detail']?.itemInfo?.itemStruct ||
            defaultScope['seo.video-detail']?.itemInfo?.itemStruct
          if (itemStruct?.video) {
            const videoUrl = itemStruct.video.playAddr || itemStruct.video.downloadAddr
            if (videoUrl) {
              return {
                url: videoUrl,
                title: cleanTitle(itemStruct.desc || document.title),
                ext: 'MP4'
              }
            }
          }
        } catch {}
      }

      // 2. Thử đọc từ thẻ SIGI_STATE (chuẩn cổ điển của TikTok)
      const sigiEl = document.getElementById('SIGI_STATE')
      if (sigiEl && sigiEl.textContent) {
        try {
          const data = JSON.parse(sigiEl.textContent)
          const items = data?.ItemModule || {}
          const pathMatch = location.pathname.match(/\/video\/(\d+)/)
          const currentId = pathMatch ? pathMatch[1] : Object.keys(items)[0]
          const item = items[currentId] || Object.values(items)[0]
          if (item?.video) {
            const videoUrl = item.video.playAddr || item.video.downloadAddr
            if (videoUrl) {
              return {
                url: videoUrl,
                title: cleanTitle(item.desc || document.title),
                ext: 'MP4'
              }
            }
          }
        } catch {}
      }
    } catch {}
    return null
  }

  function getVideoSource(video) {
    let src = video.currentSrc || video.src
    if (!src) {
      const sourceTag = video.querySelector('source[src]')
      if (sourceTag) src = sourceTag.src
    }
    if (src && !/^blob:/i.test(src) && !/^data:/i.test(src)) {
      try {
        return new URL(src, location.href).href
      } catch {}
    }
    return ''
  }

  function getMediaExtension(url) {
    try {
      const pathname = new URL(url).pathname
      const m = pathname.match(/\.(mp4|webm|mkv|m4v|mov|flv|avi|mp3|m4a|aac|ogg)(\?.*)?$/i)
      if (m) return m[1].toUpperCase()
    } catch {}
    return 'MP4'
  }

  // Báo cáo media lên background
  function reportMedia(url, type = 'video') {
    if (!url || reportedMediaUrls.has(url)) return
    if (!isContextValid()) return
    reportedMediaUrls.add(url)

    const ext = getMediaExtension(url)
    const title = cleanTitle(document.title) || 'Media'
    const filename = `${title}.${ext.toLowerCase()}`

    safeSendMessage({
      action: 'media_detected',
      media: {
        url,
        title,
        filename,
        ext,
        type,
        pageUrl: location.href
      }
    })
  }

  const activeBars = new Set()

  function updateAllBars() {
    if (!isContextValid()) {
      cleanupOnInvalidated()
      return
    }
    activeBars.forEach((b) => {
      try {
        b._updatePosition?.()
      } catch {}
    })
  }

  window.addEventListener('scroll', updateAllBars, { passive: true })
  window.addEventListener('resize', updateAllBars, { passive: true })

  // Tạo và gắn nút nổi vào thẻ video
  function attachFloatingBar(video) {
    if (!video || handledVideos.has(video)) return
    handledVideos.add(video)

    // Tạo thanh nút bấm
    const bar = document.createElement('div')
    bar.className = 'mydownloader-floating-bar idle-hidden'
    if (!videoBarEnabled) bar.style.display = 'none'

    const ext = 'MP4'
    bar.innerHTML = `
      ${DOWNLOAD_SVG}
      <span class="mydownloader-floating-text">Tải video này</span>
      <span class="mydownloader-floating-tag">${ext}</span>
    `

    // QUAN TRỌNG: Gắn nút vào document.body thay vì chèn vào video.parentElement.
    // Việc thay đổi position hoặc chèn nút vào cha của video trên TikTok / YouTube Shorts làm vỡ CSS layout
    // khiến khung hình video bị co về 0px (đen màn hình chỉ nghe thấy tiếng)!
    const hostEl = document.body || document.documentElement
    if (hostEl) {
      hostEl.appendChild(bar)
    }

    function updatePosition() {
      if (!isContextValid()) {
        cleanupOnInvalidated()
        return
      }
      if (!video.isConnected) {
        bar.remove()
        activeBars.delete(bar)
        return
      }
      const rect = video.getBoundingClientRect()
      // Nếu video bị ẩn, kích thước quá bé hoặc nằm ngoài khung nhìn viewport
      if (
        rect.width < 120 ||
        rect.height < 80 ||
        rect.bottom <= 0 ||
        rect.top >= window.innerHeight ||
        rect.right <= 0 ||
        rect.left >= window.innerWidth
      ) {
        bar.style.display = 'none'
        return
      }

      if (videoBarEnabled) {
        bar.style.display = 'inline-flex'
      }

      // Đặt vị trí fixed chính xác theo góc trên bên phải của video
      const top = Math.max(8, rect.top + 8)
      const left = Math.max(8, rect.right - (bar.offsetWidth || 135) - 10)
      bar.style.top = `${top}px`
      bar.style.left = `${left}px`
    }

    bar._updatePosition = updatePosition
    activeBars.add(bar)

    let hideTimer = null
    function showBar() {
      if (!isContextValid()) {
        cleanupOnInvalidated()
        return
      }
      clearTimeout(hideTimer)
      updatePosition()
      let src = getVideoSource(video)
      if (!src) {
        const yt = extractYouTubeStream()
        if (yt && yt.url) src = yt.url
      }
      if (!src) {
        const tt = extractTikTokStream()
        if (tt && tt.url) src = tt.url
      }
      if (src) {
        const extName = getMediaExtension(src)
        const tag = bar.querySelector('.mydownloader-floating-tag')
        if (tag) tag.textContent = extName
        bar.classList.remove('idle-hidden')
      }
    }

    function hideBarDelayed() {
      hideTimer = setTimeout(() => {
        bar.classList.add('idle-hidden')
      }, 1800)
    }

    video.addEventListener('mouseenter', () => {
      if (!isContextValid()) { cleanupOnInvalidated(); return }
      showBar()
    })
    video.addEventListener('mousemove', () => {
      if (!isContextValid()) { cleanupOnInvalidated(); return }
      showBar()
    })
    video.addEventListener('play', () => {
      if (!isContextValid()) { cleanupOnInvalidated(); return }
      showBar()
      let src = getVideoSource(video)
      if (!src) {
        const tt = extractTikTokStream()
        if (tt && tt.url) src = tt.url
      }
      if (src) reportMedia(src, 'video')
      hideBarDelayed()
    })
    video.addEventListener('pause', () => {
      if (!isContextValid()) { cleanupOnInvalidated(); return }
      showBar()
    })
    video.addEventListener('mouseleave', hideBarDelayed)

    bar.addEventListener('mouseenter', () => clearTimeout(hideTimer))
    bar.addEventListener('mouseleave', hideBarDelayed)

    // Nhấp nút tải
    bar.addEventListener('click', async (e) => {
      e.preventDefault()
      e.stopPropagation()

      if (!isContextValid()) {
        cleanupOnInvalidated()
        alert('Tiện ích MyDownloader vừa được cập nhật lại trên trình duyệt. Vui lòng tải lại trang web (F5) để tiếp tục tải video!')
        return
      }

      let targetUrl = getVideoSource(video)
      let title = cleanTitle(document.title)
      let extName = 'MP4'

      // Nếu không lấy được src trực tiếp (do dùng blob: trên YouTube hoặc MSE player):
      if (!targetUrl) {
        const yt = extractYouTubeStream()
        if (yt && yt.url) {
          targetUrl = yt.url
          title = yt.title || title
          extName = yt.ext || 'MP4'
        }
      }

      // Trích xuất TikTok stream trực tiếp nếu đang ở TikTok
      if (!targetUrl) {
        const tt = extractTikTokStream()
        if (tt && tt.url) {
          targetUrl = tt.url
          title = tt.title || title
          extName = tt.ext || 'MP4'
        }
      }

      // Nếu vẫn chưa có, hỏi background xem có sniff được luồng media mạng nào không
      if (!targetUrl) {
        const bgRes = await new Promise((resolve) => {
          safeSendMessage({ action: 'get_tab_best_media' }, resolve)
        })
        if (bgRes && bgRes.media && bgRes.media.url) {
          targetUrl = bgRes.media.url
          title = bgRes.media.title || title
          extName = bgRes.media.ext || extName
        }
      }

      if (!targetUrl || /^blob:/i.test(targetUrl)) {
        alert('Trình phát video đang dùng bộ đệm blob nội bộ. Vui lòng bấm phát video thêm 1 giây để Extension bắt luồng HTTP qua mạng!')
        return
      }

      const filename = `${title}.${extName.toLowerCase()}`

      bar.classList.add('success')
      const textSpan = bar.querySelector('.mydownloader-floating-text')
      if (textSpan) textSpan.textContent = 'Đang chuyển vào app...'

      safeSendMessage(
        {
          action: 'download_url',
          url: targetUrl,
          filename,
          referrer: location.href
        },
        (res) => {
          if (res && res.success) {
            if (textSpan) textSpan.textContent = '✓ Đã nhận!'
          }
          setTimeout(() => {
            bar.classList.remove('success')
            if (textSpan) textSpan.textContent = 'Tải video này'
            hideBarDelayed()
          }, 2200)
        }
      )
    })

    // Cập nhật vị trí định kỳ
    const timer = setInterval(() => {
      if (!isContextValid()) {
        clearInterval(timer)
        cleanupOnInvalidated()
        return
      }
      updatePosition()
    }, 2500)
    intervals.add(timer)
  }

  // Quét các thẻ video & audio hiện có
  function scanMedia() {
    if (!isContextValid()) {
      cleanupOnInvalidated()
      return
    }

    document.querySelectorAll('video').forEach((v) => {
      attachFloatingBar(v)
      let src = getVideoSource(v)
      if (!src) {
        const yt = extractYouTubeStream()
        if (yt && yt.url) src = yt.url
      }
      if (!src) {
        const tt = extractTikTokStream()
        if (tt && tt.url) src = tt.url
      }
      if (src && !/^blob:/i.test(src)) reportMedia(src, 'video')
    })

    document.querySelectorAll('audio').forEach((a) => {
      const src = a.currentSrc || a.src
      if (src && !/^blob:/i.test(src) && !/^data:/i.test(src)) reportMedia(src, 'audio')
    })
  }

  // Chạy ngay và quan sát các thẻ video mới được tải thêm (như trên YouTube, TikTok, FB)
  scanMedia()

  // Hỗ trợ chuyển trang mượt trên YouTube (SPA navigation)
  window.addEventListener('yt-navigate-finish', () => {
    if (!isContextValid()) return
    setTimeout(scanMedia, 500)
    setTimeout(scanMedia, 1500)
  })

  let scanDebounceTimer = null
  function debouncedScanMedia() {
    if (scanDebounceTimer) return
    scanDebounceTimer = setTimeout(() => {
      scanDebounceTimer = null
      scanMedia()
    }, 250)
  }

  try {
    observer = new MutationObserver(() => {
      if (!isContextValid()) {
        cleanupOnInvalidated()
        return
      }
      debouncedScanMedia()
    })

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    })
  } catch {}

  // Trả lời yêu cầu từ Extension Popup
  try {
    if (isContextValid() && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
        if (!isContextValid()) return false
        if (req.action === 'get_page_media') {
          scanMedia()
          const mediaList = []
          document.querySelectorAll('video, audio').forEach((el) => {
            let src = getVideoSource(el)
            let title = cleanTitle(document.title)
            if (!src && el.tagName.toLowerCase() === 'video') {
              const yt = extractYouTubeStream()
              if (yt && yt.url) {
                src = yt.url
                title = yt.title || title
              }
            }
            if (src && !/^blob:/i.test(src)) {
              mediaList.push({
                url: src,
                title,
                type: el.tagName.toLowerCase(),
                ext: getMediaExtension(src)
              })
            }
          })
          sendResponse({ mediaList })
        }
        return true
      })
    }
  } catch {}
})()

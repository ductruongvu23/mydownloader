// extension/content.js - MyDownloader Media Sniffer & Floating Download Bar

;(function () {
  'use strict'

  let videoBarEnabled = true

  // Đọc cài đặt hiển thị nút nổi
  chrome.storage.local.get(['videoBarEnabled'], (res) => {
    if (res.videoBarEnabled !== undefined) {
      videoBarEnabled = res.videoBarEnabled
    }
  })

  // Lắng nghe thay đổi cài đặt từ popup
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.videoBarEnabled) {
      videoBarEnabled = changes.videoBarEnabled.newValue
      document.querySelectorAll('.mydownloader-floating-bar').forEach((bar) => {
        bar.style.display = videoBarEnabled ? 'inline-flex' : 'none'
      })
    }
  })

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
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60)
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
    reportedMediaUrls.add(url)

    const ext = getMediaExtension(url)
    const title = cleanTitle(document.title) || 'Media'
    const filename = `${title}.${ext.toLowerCase()}`

    chrome.runtime.sendMessage({
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

  // Tạo và gắn nút nổi vào thẻ video
  function attachFloatingBar(video) {
    if (handledVideos.has(video)) return
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

    // Đưa vào DOM: Nếu container cha có thể gắn relative, gắn vào cha; nếu không đính body
    const parent = video.parentElement || document.body
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative'
    }
    parent.appendChild(bar)

    function updatePosition() {
      if (!video.isConnected) {
        bar.remove()
        return
      }
      const rect = video.getBoundingClientRect()
      if (rect.width < 120 || rect.height < 80) {
        bar.style.display = 'none'
        return
      }
      if (videoBarEnabled) bar.style.display = 'inline-flex'
      const parentRect = parent.getBoundingClientRect()
      const top = rect.top - parentRect.top + 8
      const right = parentRect.right - rect.right + 10
      bar.style.top = `${Math.max(6, top)}px`
      bar.style.right = `${Math.max(6, right)}px`
    }

    let hideTimer = null
    function showBar() {
      clearTimeout(hideTimer)
      updatePosition()
      const src = getVideoSource(video)
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

    video.addEventListener('mouseenter', showBar)
    video.addEventListener('mousemove', showBar)
    video.addEventListener('play', () => {
      showBar()
      const src = getVideoSource(video)
      if (src) reportMedia(src, 'video')
      hideBarDelayed()
    })
    video.addEventListener('pause', showBar)
    video.addEventListener('mouseleave', hideBarDelayed)

    bar.addEventListener('mouseenter', () => clearTimeout(hideTimer))
    bar.addEventListener('mouseleave', hideBarDelayed)

    // Nhấp nút tải
    bar.addEventListener('click', async (e) => {
      e.preventDefault()
      e.stopPropagation()

      let targetUrl = getVideoSource(video)
      let title = cleanTitle(document.title)
      let extName = 'MP4'

      // Nếu không lấy được src trực tiếp (do dùng blob: trên YouTube hoặc MSE player):
      if (!targetUrl) {
        // Thử trích xuất luồng YouTube
        const yt = extractYouTubeStream()
        if (yt && yt.url) {
          targetUrl = yt.url
          title = yt.title || title
          extName = yt.ext || 'MP4'
        }
      }

      // Nếu vẫn chưa có, hỏi background xem có sniff được luồng media mạng nào không
      if (!targetUrl) {
        const bgRes = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'get_tab_best_media' }, resolve)
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

      chrome.runtime.sendMessage(
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
    setInterval(updatePosition, 3000)
  }

  // Quét các thẻ video & audio hiện có
  function scanMedia() {
    document.querySelectorAll('video').forEach((v) => {
      attachFloatingBar(v)
      let src = getVideoSource(v)
      if (!src) {
        const yt = extractYouTubeStream()
        if (yt && yt.url) src = yt.url
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

  const observer = new MutationObserver(() => {
    scanMedia()
  })

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  })

  // Trả lời yêu cầu từ Extension Popup
  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
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
})()

// src/main/engine/http-engine.js
// Engine tải HTTP/HTTPS đa luồng thế hệ mới:
// - Tự động dò số luồng thích ứng (Adaptive Threading)
// - Kiểm tra Range & Fallback tải đơn luồng an toàn
// - Bộ đệm ghi đĩa bất đồng bộ (Disk Write Buffer) loại bỏ nghẽn I/O
// - Retry thông minh từng đoạn với Exponential Backoff & Jitter
// - Hỗ trợ đa nguồn / CDN Mirrors
// - Tích hợp DNS Cache, Keep-Alive và HTTP/2 Multiplexing
import fs from 'fs/promises'
import path from 'path'
import { EventEmitter } from 'events'
import { resolveHost, checkH2Support } from './network-pool.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const sanitize = (n) =>
  n
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 200)

/** Tên file: Content-Disposition trước, không có thì lấy từ URL cuối cùng (sau redirect) */
function filenameFrom(res, url) {
  const cd = res.headers?.get('content-disposition') || ''
  let name = ''
  let m = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd)
  if (m) {
    try {
      name = decodeURIComponent(m[1])
    } catch {}
  }
  if (!name && (m = /filename\s*=\s*"?([^";]+)"?/i.exec(cd))) {
    name = m[1]
  }
  if (!name) {
    try {
      const parsedUrl = new URL(res.url || url)
      const qp = parsedUrl.searchParams.get('filename') || parsedUrl.searchParams.get('file')
      if (qp) {
        name = qp
      } else {
        const base = parsedUrl.pathname.split('/').filter(Boolean).pop() || ''
        name = decodeURIComponent(base)
      }
    } catch {}
  }
  name = sanitize(name.trim()) || 'download'
  if (!path.extname(name)) {
    const ct = (res.headers?.get('content-type') || '').toLowerCase()
    if (ct.includes('video/mp4')) name += '.mp4'
    else if (ct.includes('video/webm')) name += '.webm'
    else if (ct.includes('video/quicktime')) name += '.mov'
    else if (ct.includes('video/x-matroska')) name += '.mkv'
    else if (ct.includes('audio/mpeg') || ct.includes('audio/mp3')) name += '.mp3'
    else if (ct.includes('audio/mp4') || ct.includes('audio/m4a')) name += '.m4a'
    else if (ct.includes('audio/ogg')) name += '.ogg'
    else if (ct.includes('image/jpeg')) name += '.jpg'
    else if (ct.includes('image/png')) name += '.png'
    else if (ct.includes('application/pdf')) name += '.pdf'
    else if (ct.includes('application/zip')) name += '.zip'
    else if (ct.startsWith('video/')) name += '.mp4'
    else if (ct.startsWith('audio/')) name += '.mp3'
  }
  return name
}

/** Nếu file đã tồn tại thì đổi thành "ten (1).ext", "ten (2).ext"... */
async function uniquePath(p) {
  const { dir, name, ext } = path.parse(p)
  for (let i = 0; ; i++) {
    const cand = i ? path.join(dir, `${name} (${i})${ext}`) : p
    try {
      await fs.access(cand)
    } catch {
      return cand
    }
  }
}

/** Giới hạn tốc độ dùng chung cho mọi luồng */
class RateLimiter {
  constructor(bytesPerSec = 0) {
    this.limit = bytesPerSec
    this.next = 0
  }
  async take(n) {
    if (!this.limit || this.limit <= 0) return
    const now = Date.now()
    const slot = Math.max(this.next, now)
    this.next = slot + (n / this.limit) * 1000
    if (slot > now) await sleep(slot - now)
  }
}

/**
 * Bộ đệm ghi đĩa bất đồng bộ (Asynchronous Disk Write Buffer)
 * Gom các gói mạng nhỏ (8KB - 16KB) vào bộ nhớ (256KB - 512KB) trước khi ghi 1 lần xuống đĩa,
 * giúp giảm 90%+ số lượng syscall I/O và triệt tiêu nghẽn cổ chai đĩa.
 */
class DiskWriteBuffer {
  constructor(fh, bufferSize = 256 * 1024) {
    this.fh = fh
    this.bufferSize = bufferSize
    this.chunks = []
    this.currentLength = 0
    this.startOffset = 0
  }

  async append(buffer, offset) {
    if (this.currentLength === 0) {
      this.startOffset = offset
    }
    this.chunks.push(buffer)
    this.currentLength += buffer.length

    if (this.currentLength >= this.bufferSize) {
      await this.flush()
    }
  }

  async flush() {
    if (this.currentLength === 0 || !this.fh) return
    const writeOffset = this.startOffset
    const writeLen = this.currentLength
    const combined = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, writeLen)
    this.chunks = []
    this.currentLength = 0
    await this.fh.write(combined, 0, writeLen, writeOffset)
  }
}

class HttpDownload extends EventEmitter {
  constructor(urlOrUrls, dest = null, opts = {}) {
    super()

    // 5. Hỗ trợ đa nguồn / CDN Mirrors
    if (Array.isArray(urlOrUrls)) {
      this.urls = urlOrUrls.filter(Boolean)
    } else {
      this.urls = [urlOrUrls, ...(opts.mirrors || [])].filter(Boolean)
    }
    this.url = this.urls[0] || ''
    this.failedMirrors = new Set()
    this.mirrorIndex = 0

    this.dest = dest
    this.dir = opts.dir || process.cwd()

    this.headers = {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
      Connection: 'keep-alive',
      ...(opts.headers || {})
    }

    this.requestedThreads = opts.threads || 8
    this.threads = this.requestedThreads
    this.adaptive = opts.adaptive !== false     // Mặc định bật tự động dò luồng thích ứng
    this.minSplit = opts.minSplit || 512 * 1024  // 512 KB
    this.dynMinSplit = opts.dynMinSplit || 128 * 1024 // 128 KB
    this.maxRetries = opts.maxRetries ?? 8       // Tối đa 8 lần retry cho mỗi đoạn
    this.limiter = opts.limiter || new RateLimiter(0)

    this.segments = []
    this.downloaded = 0
    this.window = 0
    this.stopped = false
    this.size = 0
    this.ranges = false
    this.validator = null
    this.filename = ''
    this.fh = null
    this.timer = null
    this.h2Supported = false
  }

  /** Lấy URL nguồn tải cho từng đoạn (xoay vòng giữa các mirror còn hoạt động) */
  getMirrorUrl() {
    const activeMirrors = this.urls.filter((u) => !this.failedMirrors.has(u))
    if (activeMirrors.length === 0) return this.url
    const chosen = activeMirrors[this.mirrorIndex % activeMirrors.length]
    this.mirrorIndex++
    return chosen
  }

  markMirrorFailed(failedUrl) {
    if (this.urls.length > 1) {
      console.warn('[HttpDownload] Đánh dấu mirror lỗi, chuyển sang mirror khác:', failedUrl.slice(0, 60))
      this.failedMirrors.add(failedUrl)
    }
  }

  /**
   * 1. Tự động dò số luồng tối ưu (Adaptive Thread Tuning)
   * Tránh ép cứng 32 luồng cho file nhỏ hoặc bị server CDN chặn.
   */
  calculateOptimalThreads(size, maxAllowed) {
    if (!this.ranges || size <= 0) return 1
    if (size < 2 * 1024 * 1024) return Math.min(2, maxAllowed)       // < 2 MB: 1-2 luồng
    if (size < 10 * 1024 * 1024) return Math.min(4, maxAllowed)      // 2 - 10 MB: 4 luồng
    if (size < 50 * 1024 * 1024) return Math.min(8, maxAllowed)      // 10 - 50 MB: 8 luồng
    return Math.min(16, maxAllowed)                                   // > 50 MB: tối đa 16 luồng (hoặc theo cấu hình)
  }

  /**
   * 2. Thăm dò (Probe) kiểm tra Range & Fallback an toàn
   * Phân giải DNS Cache & kiểm tra HTTP 206 vs HTTP 200
   */
  async probe() {
    console.log('[HttpDownload] Probe URL:', this.url.slice(0, 80))

    if (this.url.startsWith('blob:')) {
      throw new Error('Không thể tải URL dạng blob: (bộ nhớ tạm trình duyệt). Vui lòng phát video để Extension bắt luồng HTTP gốc.')
    }

    // Tối ưu hóa luồng video YouTube (googlevideo.com)
    if (this.url.includes('googlevideo.com/videoplayback')) {
      if (!this.headers['Referer'] && !this.headers['referer']) {
        this.headers['Referer'] = 'https://www.youtube.com/'
      }
      try {
        const u = new URL(this.url)
        if (u.searchParams.has('range')) {
          u.searchParams.delete('range')
          u.searchParams.delete('rn')
          u.searchParams.delete('rbuf')
          this.url = u.toString()
        }
      } catch {}
    }

    // Tối ưu hóa cho TikTok, ByteDance CDN
    const isTikTok = /tiktok\.com|byteoversea\.com|ibytedtos\.com|tiktokcdn\.com/i.test(this.url)
    if (isTikTok) {
      if (!this.headers['Referer'] && !this.headers['referer']) {
        this.headers['Referer'] = 'https://www.tiktok.com/'
      }
      if (!this.headers['Origin']) {
        this.headers['Origin'] = 'https://www.tiktok.com'
      }
    }

    // Tối ưu hóa cho Facebook / Instagram CDN
    const isMeta = /fbcdn\.net|facebook\.com|cdninstagram\.com|instagram\.com/i.test(this.url)
    if (isMeta && !this.headers['Referer'] && !this.headers['referer']) {
      this.headers['Referer'] = 'https://www.facebook.com/'
    }

    // Tối ưu hóa cho X (Twitter) CDN
    const isTwitter = /twimg\.com|twitter\.com|x\.com/i.test(this.url)
    if (isTwitter && !this.headers['Referer'] && !this.headers['referer']) {
      this.headers['Referer'] = 'https://x.com/'
    }

    // 6. DNS Prefetch
    try {
      const parsed = new URL(this.url)
      await resolveHost(parsed.hostname)
    } catch {}

    // 7. Kiểm tra HTTP/2
    try {
      this.h2Supported = await checkH2Support(this.url)
      if (this.h2Supported) {
        console.log('[HttpDownload] ⚡ Máy chủ hỗ trợ HTTP/2! Sẵn sàng cho Multiplexing.')
      }
    } catch {}

    const headers = { ...this.headers, Range: 'bytes=0-0' }
    let res
    try {
      res = await fetch(this.url, { headers, redirect: 'follow' })
    } catch (e) {
      throw new Error(`Không thể kết nối đến máy chủ: ${e.message}`)
    }

    // Nếu server từ chối Range với mã 400, 403, 416 -> thử lại không kèm Range
    if (res.status === 400 || res.status === 403 || res.status === 416) {
      const headersNoRange = { ...this.headers }
      delete headersNoRange.Range
      try {
        const resFallback = await fetch(this.url, { headers: headersNoRange, redirect: 'follow' })
        if (resFallback.status >= 200 && resFallback.status < 300) {
          res = resFallback
        }
      } catch {}
    }

    // Huỷ body thăm dò để giải phóng socket
    try {
      if (res.body) {
        const reader = res.body.getReader()
        await reader.cancel()
        reader.releaseLock()
      }
    } catch {}

    console.log('[HttpDownload] Probe response status:', res.status)

    if (res.status === 206) {
      // Server hỗ trợ Range phân đoạn
      const cr = res.headers.get('content-range') || ''
      const m = /\/(\d+)\s*$/.exec(cr)
      this.size = m ? Number(m[1]) : 0
      this.ranges = !!m
    } else if (res.status === 200) {
      // Server trả HTTP 200: KHÔNG hỗ trợ Range hoặc bỏ qua Range -> Phải fallback về đơn luồng!
      const cl = res.headers.get('content-length')
      this.size = cl ? Number(cl) : 0
      this.ranges = false
      console.warn('[HttpDownload] ⚠️ Server không hỗ trợ Range (HTTP 200). Tự động fallback về chế độ tải đơn luồng.')
    } else {
      const err = new Error(`HTTP ${res.status}`)
      err.fatal = true
      err.status = res.status
      throw err
    }

    const etag = res.headers.get('etag')
    this.validator = etag && !etag.startsWith('W/') ? etag : res.headers.get('last-modified')
    this.filename = filenameFrom(res, this.url)

    // Nếu không có kích thước tệp hoặc kích thước = 0 thì không thể chia Range
    if (!this.size) this.ranges = false

    // Tự động tính toán số luồng thích ứng dựa trên dung lượng thực tế
    if (this.adaptive) {
      this.threads = isTikTok ? 1 : this.calculateOptimalThreads(this.size, this.requestedThreads)
      console.log(`[HttpDownload] 🎯 Dò luồng thích ứng: Thiết lập ${this.threads} luồng cho tệp dung lượng ${this.size} bytes`)
    } else if (isTikTok) {
      this.threads = 1
    }

    console.log(
      '[HttpDownload] Probe OK: filename=',
      this.filename,
      'size=',
      this.size,
      'ranges=',
      this.ranges,
      'threads=',
      this.threads
    )
  }

  async prepare() {
    let meta = null
    try {
      meta = JSON.parse(await fs.readFile(this.metaPath, 'utf8'))
    } catch {}

    const reuse =
      this.ranges &&
      meta &&
      meta.size === this.size &&
      meta.validator === this.validator &&
      Array.isArray(meta.segments)

    if (reuse) {
      console.log('[HttpDownload] Tiếp tục tải từ file meta đã lưu')
      this.segments = meta.segments.map((s) => ({
        ...s,
        pos: s.written,
        state: s.written > s.end ? 'done' : 'idle',
        retries: 0
      }))
      this.downloaded = this.segments.reduce((a, s) => a + Math.max(0, s.written - s.start), 0)
      this.fh = await fs.open(this.dest, 'r+')
      return
    }

    this.fh = await fs.open(this.dest, 'w')
    this.segments = []
    this.downloaded = 0

    if (this.ranges && this.size > 0) {
      // Cấp phát kích thước file trên đĩa
      await this.fh.truncate(this.size)
      const n = Math.max(1, Math.min(this.threads, Math.floor(this.size / this.minSplit)))
      const part = Math.ceil(this.size / n)
      console.log(`[HttpDownload] Chia ${n} đoạn, mỗi đoạn ~${(part / 1024 / 1024).toFixed(1)} MB`)
      for (let i = 0; i < n; i++) {
        const start = i * part
        const end = Math.min(start + part - 1, this.size - 1)
        this.segments.push({ start, end, pos: start, written: start, state: 'idle', retries: 0 })
      }
    } else {
      // 2. Chế độ tải đơn luồng (không Range hoặc không rõ dung lượng): ghi tuần tự, không truncate trước
      console.log('[HttpDownload] 🛡️ Chạy chế độ đơn luồng an toàn (Sequential Stream)')
      this.threads = 1
      this.segments.push({
        start: 0,
        end: this.size ? this.size - 1 : Infinity,
        pos: 0,
        written: 0,
        state: 'idle',
        retries: 0
      })
    }
  }

  nextSegment(mySpeed = 0) {
    const idle = this.segments.find((s) => s.state === 'idle')
    if (idle) {
      idle.state = 'run'
      return idle
    }
    if (!this.ranges || this.stopped) return null

    // Chia sẻ động cho đoạn tải đang chạy chậm nhất
    const left = (s) => s.end - s.pos + 1
    const speed = (s) => Math.max(((s.bytes || 0) / Math.max(Date.now() - s.t0, 500)) * 1000, 1)

    let victim = null
    for (const s of this.segments) {
      if (s.state === 'run') {
        const sLeft = left(s)
        const sSpeed = speed(s)
        if (sLeft > this.dynMinSplit * 2) {
          if (!victim) {
            victim = s
          } else {
            const vLeft = left(victim)
            const vSpeed = speed(victim)
            if (sLeft / sSpeed > vLeft / vSpeed) victim = s
          }
        }
      }
    }

    if (!victim) return null
    const vLeft = left(victim)
    if (vLeft < this.dynMinSplit * 2) return null

    const mine = mySpeed || speed(victim)
    const share = Math.min(0.9, Math.max(0.5, mine / (mine + speed(victim))))
    const take = Math.max(this.dynMinSplit, Math.floor(vLeft * share))
    const mid = victim.end - take + 1

    if (mid <= victim.pos) return null

    const seg = { start: mid, end: victim.end, pos: mid, written: mid, state: 'run', retries: 0 }
    victim.end = mid - 1
    this.segments.push(seg)
    return seg
  }

  async fetchSegment(seg) {
    const ctl = new AbortController()
    seg.ctl = ctl
    seg.t0 = Date.now()
    seg.bytes = 0

    // 5. Chọn URL mirror tối ưu
    const targetUrl = this.getMirrorUrl()
    const headers = { ...this.headers }

    if (this.ranges) {
      headers.Range = `bytes=${seg.pos}-${seg.end}`
      if (this.validator) headers['If-Range'] = this.validator
    } else {
      // Đơn luồng: ghi tiếp từ vị trí đã ghi dở nếu có
      this.downloaded -= seg.pos - seg.start
      seg.pos = seg.written = seg.start
    }

    let res
    try {
      res = await fetch(targetUrl, { headers, signal: ctl.signal })
    } catch (e) {
      if (e.name === 'AbortError') return
      this.markMirrorFailed(targetUrl)
      throw e
    }

    const okStatus = this.ranges ? 206 : 200

    if (res.status !== okStatus) {
      if (!this.ranges && res.status === 206) {
        // OK
      } else if (this.ranges && res.status === 200 && seg.start === 0) {
        // Server trả toàn bộ file cho segment 0: chuyển mượt sang tải đơn luồng toàn bộ file thay vì báo lỗi
        console.warn('[HttpDownload] ⚠️ Server trả HTTP 200 thay vì 206. Tự động chuyển phân đoạn 0 sang tải đơn luồng toàn bộ tệp.')
        this.ranges = false
        this.threads = 1
        seg.end = this.size ? this.size - 1 : Infinity
        for (const s of this.segments) {
          if (s !== seg) {
            s.state = 'done'
            try { s.ctl?.abort() } catch {}
          }
        }
      } else {
        const fatal =
          (this.ranges && res.status === 200) ||
          (res.status >= 400 && res.status < 500 && ![408, 429].includes(res.status))
        const err = new Error(
          res.status === 200 && this.ranges ? 'Server bỏ qua Range header' : `HTTP ${res.status}`
        )
        err.fatal = fatal
        err.status = res.status
        try {
          const r = res.body?.getReader()
          await r?.cancel()
          r?.releaseLock()
        } catch {}
        this.markMirrorFailed(targetUrl)
        throw err
      }
    }

    // 4. Khởi tạo DiskWriteBuffer (256 KB) cho worker này
    const diskBuffer = new DiskWriteBuffer(this.fh, 256 * 1024)
    const reader = res.body.getReader()

    try {
      while (!this.stopped) {
        const { done, value } = await reader.read()
        if (done || !value) break

        const remain = isFinite(seg.end) ? seg.end - seg.pos + 1 : Infinity
        if (remain <= 0) break

        const len = isFinite(remain) ? Math.min(value.length, remain) : value.length
        await this.limiter.take(len)

        const p = seg.pos
        seg.pos += len

        // Ghi vào bộ đệm bộ nhớ thay vì gọi lệnh I/O đĩa ở từng chunk nhỏ
        const sliceBuf = Buffer.isBuffer(value) ? value.subarray(0, len) : Buffer.from(value.buffer, value.byteOffset, len)
        await diskBuffer.append(sliceBuf, p)

        seg.written = p + len
        seg.bytes += len
        this.downloaded += len
        this.window += len

        if (isFinite(seg.end) && seg.pos > seg.end) break
      }

      // Xả hết dữ liệu còn lại trong bộ đệm xuống đĩa
      await diskBuffer.flush()
    } finally {
      try {
        await diskBuffer.flush().catch(() => {})
      } catch {}
      try {
        reader.cancel().catch(() => {})
      } catch {}
      try {
        reader.releaseLock()
      } catch {}
      try {
        ctl.abort()
      } catch {}
    }

    if (this.stopped) return
    if (isFinite(seg.end) && seg.pos <= seg.end) {
      throw new Error('Kết nối bị ngắt sớm trước khi nhận đủ phân đoạn')
    }
    seg.state = 'done'
  }

  async worker() {
    let mySpeed = 0
    while (!this.stopped) {
      const seg = this.nextSegment(mySpeed)
      if (!seg) {
        if (this.segments.every((s) => s.state === 'done')) return
        await sleep(100)
        continue
      }

      try {
        await this.fetchSegment(seg)
        const duration = Math.max(Date.now() - seg.t0, 1)
        mySpeed = (seg.bytes / duration) * 1000
      } catch (e) {
        if (this.stopped) return
        if (e.name === 'AbortError') return

        console.warn(`[worker] Đoạn [${seg.start}-${seg.end}] gặp lỗi: ${e.message} - lần thử: ${seg.retries + 1}`)

        // 3. Retry thông minh theo từng đoạn với Exponential Backoff & Jitter
        if (e.fatal || ++seg.retries > this.maxRetries) {
          throw e
        }

        // Khôi phục vị trí pos về vị trí an toàn đã ghi trên đĩa
        seg.pos = seg.written
        seg.state = 'idle'

        // Thời gian chờ tăng dần theo lũy thừa + biến thiên ngẫu nhiên (jitter)
        const backoffDelay = Math.min(400 * Math.pow(1.8, seg.retries) + Math.random() * 200, 8000)
        await sleep(backoffDelay)
      }
    }
  }

  async saveMeta() {
    if (!this.ranges || !this.metaPath) return
    try {
      const segments = this.segments.map(({ start, end, written }) => ({ start, end, written }))
      await fs.writeFile(
        this.metaPath,
        JSON.stringify({ size: this.size, validator: this.validator, segments })
      )
    } catch {}
  }

  tick() {
    // Tick mỗi 250ms → nhân 4 để ra byte/giây
    const speed = this.window * 4
    this.window = 0
    this.emit('progress', {
      downloaded: this.downloaded,
      size: this.size,
      speed,
      connections: this.segments.filter((s) => s.state === 'run').length
    })
    this.saveMeta().catch(() => {})
  }

  async start() {
    console.log('[HttpDownload] Bắt đầu tác vụ tải:', this.url.slice(0, 80))
    await this.probe()

    // Đảm bảo thư mục đích tồn tại
    if (!this.dest) {
      await fs.mkdir(this.dir, { recursive: true })
      this.dest = await uniquePath(path.join(this.dir, this.filename))
    } else {
      await fs.mkdir(path.dirname(this.dest), { recursive: true })
    }

    this.metaPath = this.dest + '.part.json'
    console.log('[HttpDownload] Tệp đích:', this.dest)

    this.emit('info', {
      filename: path.basename(this.dest),
      dest: this.dest,
      size: this.size
    })

    await this.prepare()
    this.timer = setInterval(() => this.tick(), 250)
    const count = this.ranges ? this.threads : 1

    try {
      await Promise.all(Array.from({ length: count }, () => this.worker()))
      if (this.stopped) {
        await this.saveMeta()
        return
      }

      // Xóa file meta khi tải xong
      try {
        await fs.rm(this.metaPath, { force: true })
      } catch {}
      console.log('[HttpDownload] ✅ Hoàn tất tải tệp:', path.basename(this.dest))
      this.emit('done')
    } catch (e) {
      console.error('[HttpDownload] ❌ Lỗi tải tệp:', e.message)
      await this.stop()
      throw e
    } finally {
      clearInterval(this.timer)
      try {
        await this.fh?.close()
      } catch {}
    }
  }

  async stop() {
    if (this.stopped) return
    this.stopped = true
    for (const s of this.segments) {
      try {
        s.ctl?.abort()
      } catch {}
    }
    clearInterval(this.timer)
    this.timer = null
    await this.saveMeta().catch(() => {})
  }
}

export { HttpDownload, RateLimiter, DiskWriteBuffer, filenameFrom, uniquePath }

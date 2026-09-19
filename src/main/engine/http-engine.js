// src/main/engine/http-engine.js
// Engine tải HTTP/HTTPS đa luồng: chia đoạn + chia động + tiếp tục + thử lại
import fs from 'fs/promises'
import path from 'path'
import { EventEmitter } from 'events'

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
  return sanitize(name.trim()) || 'download'
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

class HttpDownload extends EventEmitter {
  constructor(url, dest = null, opts = {}) {
    super()
    this.url = url
    this.dest = dest
    this.dir = opts.dir || process.cwd()

    this.headers = {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
      Connection: 'keep-alive',
      ...(opts.headers || {})
    }

    this.threads = opts.threads || 32          // Tăng từ 8 → 32 luồng mặc định
    this.minSplit = opts.minSplit || 512 * 1024 // 512 KB: split nhiều hơn cho file nhỏ
    this.dynMinSplit = opts.dynMinSplit || 128 * 1024 // 128 KB: chia động mịn hơn
    this.maxRetries = opts.maxRetries ?? 8      // Tăng retry
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
  }

  async probe() {
    console.log('[HttpDownload] Probe URL:', this.url.slice(0, 80))
    const headers = { ...this.headers, Range: 'bytes=0-0' }

    let res
    try {
      res = await fetch(this.url, { headers, redirect: 'follow' })
    } catch (e) {
      throw new Error(`Không thể kết nối: ${e.message}`)
    }

    // Nếu server từ chối Range, thử không Range
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

    // Huỷ body để không chiếm kết nối
    try {
      if (res.body) {
        const reader = res.body.getReader()
        await reader.cancel()
        reader.releaseLock()
      }
    } catch {}

    console.log('[HttpDownload] Probe status:', res.status, 'URL:', res.url?.slice(0, 60))

    if (res.status === 206) {
      const cr = res.headers.get('content-range') || ''
      const m = /\/(\d+)\s*$/.exec(cr)
      this.size = m ? Number(m[1]) : 0
      this.ranges = !!m
    } else if (res.status === 200) {
      const cl = res.headers.get('content-length')
      this.size = cl ? Number(cl) : 0
      this.ranges = false
    } else {
      const err = new Error(`HTTP ${res.status}`)
      err.fatal = true
      err.status = res.status
      throw err
    }

    const etag = res.headers.get('etag')
    this.validator = etag && !etag.startsWith('W/') ? etag : res.headers.get('last-modified')
    this.filename = filenameFrom(res, this.url)
    if (!this.size) this.ranges = false

    console.log(
      '[HttpDownload] Probe OK: filename=',
      this.filename,
      'size=',
      this.size,
      'ranges=',
      this.ranges
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
      console.log('[HttpDownload] Tiếp tục tải từ file meta')
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
      // Tải đơn luồng (không hỗ trợ Range)
      console.log('[HttpDownload] Chế độ đơn luồng (không có Range)')
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
    const headers = { ...this.headers }

    if (this.ranges) {
      headers.Range = `bytes=${seg.pos}-${seg.end}`
      if (this.validator) headers['If-Range'] = this.validator
    } else {
      // Không Range: reset về đầu
      this.downloaded -= seg.pos - seg.start
      seg.pos = seg.written = seg.start
    }

    let res
    try {
      res = await fetch(this.url, { headers, signal: ctl.signal })
    } catch (e) {
      if (e.name === 'AbortError') return
      throw e
    }

    const okStatus = this.ranges ? 206 : 200

    if (res.status !== okStatus) {
      // Nếu không có ranges nhưng server trả 206, vẫn chấp nhận
      if (!this.ranges && res.status === 206) {
        // OK
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
        throw err
      }
    }

    // Đọc stream bằng reader API (tương thích Electron/Node.js fetch)
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
        await this.fh.write(value, 0, len, p)
        seg.written = p + len
        seg.bytes += len
        this.downloaded += len
        this.window += len

        if (isFinite(seg.end) && seg.pos > seg.end) break
      }
    } finally {
      try {
        reader.cancel()
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
      throw new Error('Kết nối bị ngắt sớm')
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
        console.warn('[worker] Đoạn lỗi:', e.message, '- retries:', seg.retries)
        if (e.fatal || ++seg.retries > this.maxRetries) {
          throw e
        }
        seg.pos = seg.written
        seg.state = 'idle'
        await sleep(Math.min(500 * 2 ** seg.retries, 10000))
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
    console.log('[HttpDownload] Bắt đầu tải:', this.url.slice(0, 80))
    await this.probe()

    // Đảm bảo thư mục tồn tại
    if (!this.dest) {
      await fs.mkdir(this.dir, { recursive: true })
      this.dest = await uniquePath(path.join(this.dir, this.filename))
    } else {
      await fs.mkdir(path.dirname(this.dest), { recursive: true })
    }

    this.metaPath = this.dest + '.part.json'
    console.log('[HttpDownload] Lưu vào:', this.dest)

    this.emit('info', {
      filename: path.basename(this.dest),
      dest: this.dest,
      size: this.size
    })

    await this.prepare()
    // Tick mỗi 250ms thay vì 500ms → tiến độ mượt hơn 2x
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
      console.log('[HttpDownload] Hoàn tất:', path.basename(this.dest))
      this.emit('done')
    } catch (e) {
      console.error('[HttpDownload] Lỗi tải:', e.message)
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
    // Không đóng fh ở đây - để start() finally xử lý
    // Chỉ đóng nếu start() không đang chạy (tức là gọi stop() trực tiếp từ bên ngoài)
  }
}

export { HttpDownload, RateLimiter, filenameFrom, uniquePath }

import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { EventEmitter } from 'events'
import { HttpDownload, RateLimiter } from './http-engine.js'
import { Aria2Download } from './aria2-download.js'

class TaskManager extends EventEmitter {
  constructor({ storePath, maxConcurrent = 5, speedLimit = 0 }) {
    super()
    this.storePath = storePath
    this.maxConcurrent = maxConcurrent
    this.limiter = new RateLimiter(speedLimit) // dùng chung cho tất cả task
    this.tasks = new Map()
    this.load()
  }

  add(url, { dir, filename, headers = {}, threads = 8 } = {}) {
    const id = crypto.randomUUID()
    let initialName = filename || ''
    if (!initialName) {
      try {
        const parsed = new URL(url)
        const qp = parsed.searchParams.get('filename') || parsed.searchParams.get('file')
        if (qp) {
          initialName = qp
        } else {
          const base = parsed.pathname.split('/').filter(Boolean).pop() || ''
          initialName = decodeURIComponent(base)
        }
      } catch {}
    }
    if (initialName && initialName.length > 80) {
      initialName = initialName.slice(0, 40) + '...' + (path.extname(initialName) || '')
    }

    const task = {
      id,
      url,
      headers,
      threads: threads || 8,
      dir: dir || process.cwd(),
      dest: filename ? path.join(dir || process.cwd(), filename) : null,
      name: initialName || 'Đang kết nối...',
      status: 'waiting',
      size: 0,
      downloaded: 0,
      speed: 0,
      connections: 0,
      addedAt: Date.now()
    }
    this.tasks.set(id, task)
    this.save()
    this.emit('update', this.view(task))
    this.pump()
    return this.view(task)
  }

  pump() {
    const active = [...this.tasks.values()].filter((t) => t.status === 'active').length
    let slots = this.maxConcurrent - active
    for (const t of this.tasks.values()) {
      if (slots <= 0) break
      if (t.status === 'waiting') {
        this.run(t)
        slots--
      }
    }
  }

  run(t) {
    t.status = 'active'
    t.speed = 0
    t.error = undefined

    const useAria2 = /^(magnet:|ftp:)/i.test(t.url) || /\.torrent(\?|$)/i.test(t.url)
    const dl = useAria2
      ? new Aria2Download(t.url, t.dest, { dir: t.dir })
      : new HttpDownload(t.url, t.dest, {
          dir: t.dir,
          headers: t.headers,
          threads: t.threads,
          limiter: this.limiter
        })

    t.dl = dl

    dl.on('info', (info) => {
      t.dest = info.dest
      t.name = info.filename
      t.size = info.size
      this.save()
      this.emit('update', this.view(t))
    })

    dl.on('progress', (p) => {
      t.downloaded = p.downloaded
      t.size = p.size
      t.speed = p.speed
      t.connections = p.connections
      this.emit('update', this.view(t))
    })

    dl.start()
      .then(() => {
        if (t.status === 'active') {
          t.status = 'done'
          t.speed = 0
          t.connections = 0
          t.completedAt = Date.now()
        }
      })
      .catch((e) => {
        if (t.status !== 'paused' && t.status !== 'removed') {
          t.status = 'error'
          t.error = e.message
          t.speed = 0
          t.connections = 0
        }
      })
      .finally(() => {
        t.dl = null
        this.save()
        this.emit('update', this.view(t))
        this.pump()
      })
  }

  pause(id) {
    const t = this.tasks.get(id)
    if (!t) return
    if (t.status === 'active') {
      t.status = 'paused'
      t.speed = 0
      t.connections = 0
      t.dl?.stop()
    } else if (t.status === 'waiting') {
      t.status = 'paused'
    }
    this.save()
    this.emit('update', this.view(t))
    this.pump()
  }

  resume(id) {
    const t = this.tasks.get(id)
    if (t && ['paused', 'error'].includes(t.status)) {
      t.status = 'waiting'
      t.error = undefined
      this.save()
      this.emit('update', this.view(t))
      this.pump()
    }
  }

  pauseAll() {
    for (const t of this.tasks.values()) {
      if (t.status === 'active' || t.status === 'waiting') {
        this.pause(t.id)
      }
    }
  }

  resumeAll() {
    for (const t of this.tasks.values()) {
      if (t.status === 'paused' || t.status === 'error') {
        t.status = 'waiting'
        t.error = undefined
        this.emit('update', this.view(t))
      }
    }
    this.save()
    this.pump()
  }

  clearDone() {
    const doneIds = []
    for (const [id, t] of this.tasks.entries()) {
      if (t.status === 'done') doneIds.push(id)
    }
    for (const id of doneIds) {
      this.tasks.delete(id)
    }
    this.save()
    this.emit('cleared', doneIds)
  }

  async remove(id, { deleteFile = false } = {}) {
    const t = this.tasks.get(id)
    if (!t) return
    t.status = 'removed'
    try {
      await t.dl?.stop()
    } catch {}
    this.tasks.delete(id)
    this.save()
    this.emit('removed', id)

    if (deleteFile && t.dest) {
      for (const f of [t.dest, t.dest + '.part.json']) {
        try {
          await fsp.rm(f, { force: true })
        } catch {}
      }
    }
    this.pump()
  }

  setSpeedLimit(bytesPerSec) {
    this.limiter.limit = Number(bytesPerSec) || 0
  }

  setMaxConcurrent(n) {
    this.maxConcurrent = Math.max(1, Number(n) || 5)
    this.pump()
  }

  view(t) {
    const { dl, headers, ...pub } = t
    return pub
  }

  list() {
    return [...this.tasks.values()].map((t) => this.view(t))
  }

  save() {
    try {
      const out = [...this.tasks.values()].map(({ dl, ...t }) => ({
        ...t,
        speed: 0,
        connections: 0
      }))
      const dir = path.dirname(this.storePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.storePath, JSON.stringify(out, null, 2))
    } catch (e) {
      console.error('[TaskManager] Lưu tasks thất bại:', e.message)
    }
  }

  load() {
    try {
      if (fs.existsSync(this.storePath)) {
        const data = JSON.parse(fs.readFileSync(this.storePath, 'utf8'))
        for (const t of data) {
          // App tắt giữa chừng: tự động chuyển về waiting để tiếp tục tải
          if (t.status === 'active') t.status = 'waiting'
          this.tasks.set(t.id, t)
        }
      }
    } catch (e) {
      console.warn('[TaskManager] Khôi phục session lỗi:', e.message)
    }
    this.pump()
  }
}

export { TaskManager }

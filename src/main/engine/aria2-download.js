// src/main/engine/aria2-download.js
// Lớp bọc tải BitTorrent, Magnet, FTP qua aria2 JSON-RPC
import { spawn } from 'child_process'
import crypto from 'crypto'
import { EventEmitter } from 'events'
import path from 'path'

const PORT = 6800
const SECRET = crypto.randomBytes(16).toString('hex')
let proc = null

function startAria2(binPath, sessionFile) {
  try {
    proc = spawn(binPath, [
      '--enable-rpc',
      `--rpc-listen-port=${PORT}`,
      `--rpc-secret=${SECRET}`,
      '--rpc-listen-all=false', // Chỉ nghe trên máy nội bộ
      '--continue=true',
      `--input-file=${sessionFile}`,
      `--save-session=${sessionFile}`,
      '--save-session-interval=30',
      '--enable-dht=true',
      '--bt-save-metadata=true',
      '--check-integrity=true'
    ])
    proc.on('error', (err) => {
      console.warn('[aria2] Process spawn failed:', err.message)
    })
  } catch (err) {
    console.warn('[aria2] Unable to start aria2:', err.message)
  }
}

const stopAria2 = () => {
  if (proc) {
    try {
      proc.kill()
    } catch {}
    proc = null
  }
}

async function rpc(method, params = []) {
  const res = await fetch(`http://127.0.0.1:${PORT}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now().toString(),
      method,
      params: [`token:${SECRET}`, ...params]
    })
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data.result
}

class Aria2Download extends EventEmitter {
  constructor(uri, dest = null, opts = {}) {
    super()
    this.uri = uri
    this.dest = dest
    this.opts = opts
    this.gid = null
    this.timer = null
    this.stopped = false
  }

  async start() {
    try {
      const options = { dir: this.opts.dir }
      if (this.dest) {
        options.out = path.basename(this.dest)
      }
      this.gid = await rpc('aria2.addUri', [[this.uri], options])
    } catch (e) {
      throw new Error(`Không thể kết nối aria2 RPC (${e.message}). Vui lòng đảm bảo aria2 đang chạy.`)
    }

    await new Promise((resolve, reject) => {
      this.timer = setInterval(async () => {
        if (this.stopped) {
          clearInterval(this.timer)
          return resolve()
        }
        try {
          const s = await rpc('aria2.tellStatus', [this.gid])
          const downloaded = Number(s.completedLength) || 0
          const size = Number(s.totalLength) || 0
          const speed = Number(s.downloadSpeed) || 0
          const connections = Number(s.connections) || 0

          this.emit('progress', { downloaded, size, speed, connections })

          if (s.status === 'complete') {
            clearInterval(this.timer)
            this.emit('done')
            resolve()
          } else if (s.status === 'error') {
            clearInterval(this.timer)
            reject(new Error(s.errorMessage || 'Lỗi aria2'))
          }
        } catch (err) {
          clearInterval(this.timer)
          reject(err)
        }
      }, 500)
    })
  }

  async stop() {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    if (this.gid) {
      try {
        await rpc('aria2.pause', [this.gid])
      } catch {}
    }
  }
}

export { startAria2, stopAria2, Aria2Download, rpc }

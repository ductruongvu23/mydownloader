// src/main/engine/network-pool.js
// Module quản lý kết nối hiệu năng cao: DNS Cache, Keep-Alive Agents và HTTP/2 Multiplexing
import http from 'http'
import https from 'https'
import http2 from 'http2'
import dns from 'dns/promises'
import { URL } from 'url'

// 1. DNS Cache trong bộ nhớ (TTL: 5 phút)
const dnsCache = new Map() // hostname -> { ip, expireAt }
const DNS_TTL_MS = 5 * 60 * 1000

async function resolveHost(hostname) {
  const now = Date.now()
  const cached = dnsCache.get(hostname)
  if (cached && cached.expireAt > now) {
    return cached.ip
  }

  try {
    const res = await dns.lookup(hostname)
    dnsCache.set(hostname, { ip: res.address, expireAt: now + DNS_TTL_MS })
    return res.address
  } catch {
    // Nếu lỗi lookup thì trả về chính hostname để hệ thống tự xử lý
    return hostname
  }
}

// 2. Persistent HTTP & HTTPS Agents với kết nối Keep-Alive tối ưu
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 64,
  maxFreeSockets: 32,
  timeout: 30000,
  scheduling: 'fifo'
})

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 64,
  maxFreeSockets: 32,
  timeout: 30000,
  scheduling: 'fifo'
})

// 3. HTTP/2 Session Pool
const h2Sessions = new Map() // origin -> { session, connectedAt }

function getH2Session(origin) {
  const existing = h2Sessions.get(origin)
  if (existing && !existing.session.destroyed && !existing.session.closed) {
    return existing.session
  }

  try {
    const session = http2.connect(origin, {
      settings: {
        enablePush: false,
        initialWindowSize: 4 * 1024 * 1024
      }
    })

    session.on('error', () => {
      h2Sessions.delete(origin)
    })

    session.on('close', () => {
      h2Sessions.delete(origin)
    })

    h2Sessions.set(origin, { session, connectedAt: Date.now() })
    return session
  } catch {
    return null
  }
}

// Kiểm tra nhanh xem server có hỗ trợ HTTP/2 (ALPN h2) không
const h2SupportCache = new Map() // origin -> boolean

async function checkH2Support(targetUrl) {
  try {
    const parsed = new URL(targetUrl)
    if (parsed.protocol !== 'https:') return false
    const origin = parsed.origin

    if (h2SupportCache.has(origin)) {
      return h2SupportCache.get(origin)
    }

    return new Promise((resolve) => {
      const socket = https.request(
        parsed,
        {
          method: 'HEAD',
          agent: httpsAgent,
          timeout: 4000
        },
        (res) => {
          const isH2 = res.httpVersion === '2.0'
          h2SupportCache.set(origin, isH2)
          resolve(isH2)
        }
      )

      socket.on('error', () => {
        h2SupportCache.set(origin, false)
        resolve(false)
      })

      socket.on('timeout', () => {
        socket.destroy()
        h2SupportCache.set(origin, false)
        resolve(false)
      })

      socket.end()
    })
  } catch {
    return false
  }
}

// Dọn dẹp toàn bộ kết nối khi tắt app
function closePool() {
  httpAgent.destroy()
  httpsAgent.destroy()
  for (const { session } of h2Sessions.values()) {
    try {
      session.close()
    } catch {}
  }
  h2Sessions.clear()
}

export {
  resolveHost,
  httpAgent,
  httpsAgent,
  getH2Session,
  checkH2Support,
  closePool
}

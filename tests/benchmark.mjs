// tests/benchmark.mjs
// Benchmark Suite: Đo lường và so sánh hiệu năng thực tế giữa
// MyDownloader Multi-Threaded Engine vs Baseline Single-Threaded Fetch
import http from 'http'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { HttpDownload } from '../src/main/engine/http-engine.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BENCH_DIR = path.join(__dirname, 'temp_benchmarks')
const BENCH_PORT = 9999

// Tệp mẫu 30 MB để đo lường chính xác và nhanh chóng
const FILE_SIZE = 30 * 1024 * 1024 // 30 MB
console.log('⚡ Đang khởi tạo dữ liệu mẫu 30 MB trong RAM...')
const BENCH_DATA = crypto.randomBytes(FILE_SIZE)
const EXPECTED_HASH = crypto.createHash('sha256').update(BENCH_DATA).digest('hex')

// Mô phỏng server thực tế giới hạn băng thông 3 MB/s trên mỗi kết nối TCP
const PER_STREAM_THROTTLE_BPS = 3 * 1024 * 1024 // 3 MB/s per connection

function createBenchmarkServer() {
  return http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('ETag', '"bench-sample-30mb"')

    const range = req.headers.range
    if (!range) {
      res.statusCode = 200
      res.setHeader('Content-Length', FILE_SIZE)
      streamThrottled(res, BENCH_DATA, 0, FILE_SIZE - 1)
      return
    }

    const match = /bytes=(\d+)-(\d+)?/.exec(range)
    if (!match) {
      res.statusCode = 416
      res.end()
      return
    }

    const start = Number(match[1])
    const end = match[2] !== undefined ? Number(match[2]) : FILE_SIZE - 1
    const chunkSize = end - start + 1

    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${FILE_SIZE}`)
    res.setHeader('Content-Length', chunkSize)

    // Trả về probe bytes=0-0 tức thì không bóp băng thông
    if (start === 0 && end === 0) {
      res.end(BENCH_DATA.subarray(0, 1))
      return
    }

    streamThrottled(res, BENCH_DATA, start, end)
  })
}

// Bóp băng thông kết nối mô phỏng giới hạn thực tế của máy chủ CDN / File Host
function streamThrottled(res, fullBuffer, start, end) {
  const chunkSize = end - start + 1
  const slice = fullBuffer.subarray(start, end + 1)
  const packetSize = 64 * 1024 // 64 KB
  const intervalMs = Math.round((packetSize / PER_STREAM_THROTTLE_BPS) * 1000)

  let offset = 0
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(timer)
      return
    }

    const nextChunk = slice.subarray(offset, Math.min(offset + packetSize, chunkSize))
    res.write(nextChunk)
    offset += nextChunk.length

    if (offset >= chunkSize) {
      clearInterval(timer)
      res.end()
    }
  }, Math.max(intervalMs, 10))

  res.on('close', () => clearInterval(timer))
}

async function verifyFile(filePath) {
  const buf = await fsp.readFile(filePath)
  const hash = crypto.createHash('sha256').update(buf).digest('hex')
  return hash === EXPECTED_HASH
}

// 1. Baseline Test: Tải đơn luồng truyền thống qua native fetch stream
async function runBaseline(serverUrl, outPath) {
  const start = Date.now()
  const res = await fetch(serverUrl)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const fileStream = fs.createWriteStream(outPath)
  const reader = res.body.getReader()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    fileStream.write(Buffer.from(value))
  }

  await new Promise((resolve) => fileStream.end(resolve))
  const durationMs = Date.now() - start
  const valid = await verifyFile(outPath)

  return {
    mode: 'Baseline (Đơn luồng Fetch)',
    threads: 1,
    durationMs,
    speedMBs: (FILE_SIZE / (1024 * 1024) / (durationMs / 1000)),
    valid
  }
}

// 2. MyDownloader Multi-threaded Test
async function runMyDownloader(serverUrl, outPath, threads) {
  const start = Date.now()
  const dl = new HttpDownload(serverUrl, outPath, {
    threads,
    adaptive: false // Ép cứng số luồng để đo chính xác scaling
  })

  await dl.start()
  const durationMs = Date.now() - start
  const valid = await verifyFile(outPath)

  return {
    mode: `MyDownloader Engine (${threads}T)`,
    threads,
    durationMs,
    speedMBs: (FILE_SIZE / (1024 * 1024) / (durationMs / 1000)),
    valid
  }
}

async function main() {
  await fsp.mkdir(BENCH_DIR, { recursive: true })
  const server = createBenchmarkServer()

  await new Promise((resolve) => server.listen(BENCH_PORT, '127.0.0.1', resolve))
  const serverUrl = `http://127.0.0.1:${BENCH_PORT}/download-30mb.bin`

  console.log(`\n========================================================================`)
  console.log(`🏁 MYDOWNLOADER BENCHMARK SUITE: SO SÁNH HIỆU NĂNG TẢI ĐA LUỒNG`)
  console.log(`========================================================================`)
  console.log(`- Dung lượng tệp kiểm thử : 30.00 MB`)
  console.log(`- Giới hạn băng thông TCP : 3.00 MB/s / kết nối (Mô phỏng máy chủ CDN)`)
  console.log(`- Server kiểm thử         : ${serverUrl}\n`)

  const results = []

  try {
    // 1. Baseline
    console.log(`[1/4] Đang đo kiểm Baseline (Tải đơn luồng chuẩn qua fetch)...`)
    const baseResult = await runBaseline(serverUrl, path.join(BENCH_DIR, 'baseline.bin'))
    baseResult.speedup = '1.00x (Gốc)'
    results.push(baseResult)
    console.log(`  -> Hoàn thành trong ${(baseResult.durationMs / 1000).toFixed(2)}s | Tốc độ: ${baseResult.speedMBs.toFixed(2)} MB/s`)

    // 2. MyDownloader 4 Threads
    console.log(`\n[2/4] Đang đo kiểm MyDownloader Đa luồng (4 luồng song song)...`)
    const r4 = await runMyDownloader(serverUrl, path.join(BENCH_DIR, 'mydownloader_4t.bin'), 4)
    r4.speedup = `${(r4.speedMBs / baseResult.speedMBs).toFixed(2)}x`
    results.push(r4)
    console.log(`  -> Hoàn thành trong ${(r4.durationMs / 1000).toFixed(2)}s | Tốc độ: ${r4.speedMBs.toFixed(2)} MB/s (${r4.speedup})`)

    // 3. MyDownloader 8 Threads
    console.log(`\n[3/4] Đang đo kiểm MyDownloader Đa luồng (8 luồng song song)...`)
    const r8 = await runMyDownloader(serverUrl, path.join(BENCH_DIR, 'mydownloader_8t.bin'), 8)
    r8.speedup = `${(r8.speedMBs / baseResult.speedMBs).toFixed(2)}x`
    results.push(r8)
    console.log(`  -> Hoàn thành trong ${(r8.durationMs / 1000).toFixed(2)}s | Tốc độ: ${r8.speedMBs.toFixed(2)} MB/s (${r8.speedup})`)

    // 4. MyDownloader 16 Threads
    console.log(`\n[4/4] Đang đo kiểm MyDownloader Đa luồng (16 luồng song song)...`)
    const r16 = await runMyDownloader(serverUrl, path.join(BENCH_DIR, 'mydownloader_16t.bin'), 16)
    r16.speedup = `${(r16.speedMBs / baseResult.speedMBs).toFixed(2)}x`
    results.push(r16)
    console.log(`  -> Hoàn thành trong ${(r16.durationMs / 1000).toFixed(2)}s | Tốc độ: ${r16.speedMBs.toFixed(2)} MB/s (${r16.speedup})`)

    // In bảng kết quả tổng kết
    console.log(`\n========================================================================`)
    console.log(`📊 BẢNG TỔNG HỢP KẾT QUẢ SO SÁNH HIỆU NĂNG THỰC TẾ`)
    console.log(`========================================================================`)

    const displayTable = results.map((r) => ({
      'Phương thức': r.mode,
      'Số luồng': r.threads,
      'Thời gian': `${(r.durationMs / 1000).toFixed(2)} s`,
      'Tốc độ': `${r.speedMBs.toFixed(2)} MB/s`,
      'Tăng tốc (Speedup)': r.speedup,
      'Toàn vẹn SHA-256': r.valid ? '✅ Khớp 100%' : '❌ Lỗi'
    }))

    console.table(displayTable)

    const maxSpeedup = (r16.speedMBs / baseResult.speedMBs).toFixed(1)
    console.log(`🏆 KẾT LUẬN: Động cơ đa luồng MyDownloader tăng tốc gấp ${maxSpeedup} LẦN so với tải đơn luồng thông thường!`)
    console.log(`========================================================================\n`)
  } finally {
    server.close()
    await fsp.rm(BENCH_DIR, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((err) => {
  console.error('[!] Lỗi thực thi benchmark:', err)
  process.exit(1)
})

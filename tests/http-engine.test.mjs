// tests/http-engine.test.mjs
// Bộ kiểm thử tự động toàn diện cho HttpDownload Engine với server giả lập localhost
import http from 'http'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { HttpDownload, RateLimiter, filenameFrom, uniquePath } from '../src/main/engine/http-engine.js'
import { expandPattern } from '../src/main/engine/batch.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const TEST_DIR = path.join(__dirname, 'temp_downloads')
const PORT = 9988

// Tạo dữ liệu ngẫu nhiên 8 MB để test nhanh và chính xác
const TEST_SIZE = 8 * 1024 * 1024
const TEST_DATA = crypto.randomBytes(TEST_SIZE)
const EXPECTED_HASH = crypto.createHash('sha256').update(TEST_DATA).digest('hex')

let server
let simulateSlowConnection = false
let slowThreshold = 0
let simulateDropCount = 0
let simulateNoRange = false
let currentDropCount = 0

function createMockServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`)

    // 1. Giả lập URL có Content-Disposition Unicode
    if (url.pathname === '/unicode-file') {
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader(
        'Content-Disposition',
        "attachment; filename*=UTF-8''t%E1%BB%87p%20m%E1%BA%ABu%20%C4%91%E1%BA%B7c%20bi%E1%BB%87t.bin"
      )
      res.setHeader('ETag', '"mock-etag-strong-123"')
      res.setHeader('Accept-Ranges', 'bytes')
    } else {
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('ETag', '"mock-etag-strong-123"')
      res.setHeader('Accept-Ranges', 'bytes')
    }

    // Giả lập server không hỗ trợ Range
    if (simulateNoRange) {
      res.statusCode = 200
      res.setHeader('Content-Length', TEST_SIZE)
      res.end(TEST_DATA)
      return
    }

    const range = req.headers.range
    if (!range) {
      res.statusCode = 200
      res.setHeader('Content-Length', TEST_SIZE)
      res.end(TEST_DATA)
      return
    }

    // Xử lý Range: bytes=X-Y
    const match = /bytes=(\d+)-(\d+)?/.exec(range)
    if (!match) {
      res.statusCode = 416
      res.end()
      return
    }

    const start = Number(match[1])
    const end = match[2] !== undefined ? Number(match[2]) : TEST_SIZE - 1
    const chunkSize = end - start + 1

    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${TEST_SIZE}`)
    res.setHeader('Content-Length', chunkSize)

    // Thăm dò probe bytes=0-0
    if (start === 0 && end === 0) {
      res.end(TEST_DATA.subarray(0, 1))
      return
    }

    // Giả lập ngắt kết nối giữa chừng
    if (simulateDropCount > 0 && currentDropCount < simulateDropCount) {
      currentDropCount++
      const half = Math.floor(chunkSize / 4)
      res.write(TEST_DATA.subarray(start, start + half))
      // Đóng kết nối đột ngột
      setTimeout(() => req.socket.destroy(), 30)
      return
    }

    // Giả lập 1 kết nối bị chậm bất thường để test chia động
    if (simulateSlowConnection && start < slowThreshold) {
      let offset = start
      const interval = setInterval(() => {
        if (offset > end) {
          clearInterval(interval)
          res.end()
          return
        }
        const sendLen = Math.min(16 * 1024, end - offset + 1)
        res.write(TEST_DATA.subarray(offset, offset + sendLen))
        offset += sendLen
      }, 50)
      req.on('close', () => clearInterval(interval))
      return
    }

    // Trả về bình thường
    res.end(TEST_DATA.subarray(start, end + 1))
  })
}

function sha256File(filePath) {
  const data = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(data).digest('hex')
}

async function runTests() {
  console.log('=== BẮT ĐẦU BỘ KIỂM THỬ HTTP DOWNLOAD ENGINE ===')
  await fsp.mkdir(TEST_DIR, { recursive: true })

  server = createMockServer()
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
  console.log(`[Mock Server] Đang chạy tại http://127.0.0.1:${PORT}`)

  try {
    // ----------------------------------------------------
    // Test 1: Tải đa luồng (8 luồng) và so sánh SHA-256
    // ----------------------------------------------------
    console.log('\n[Test 1] Tải đa luồng 8 kết nối và kiểm tra mã băm SHA-256...')
    const file1 = path.join(TEST_DIR, 'test_8_threads.bin')
    const dl1 = new HttpDownload(`http://127.0.0.1:${PORT}/file`, file1, {
      threads: 8,
      minSplit: 512 * 1024
    })
    const t0 = Date.now()
    await dl1.start()
    const t1 = Date.now()
    const hash1 = sha256File(file1)
    if (hash1 !== EXPECTED_HASH) throw new Error(`Test 1 Thất bại: SHA-256 không khớp!`)
    if (fs.existsSync(file1 + '.part.json')) throw new Error('Test 1 Thất bại: .part.json chưa xóa!')
    console.log(`✓ Test 1 ĐẠT: Tải xong ${TEST_SIZE} bytes trong ${t1 - t0}ms, SHA-256 khớp chuẩn!`)

    // ----------------------------------------------------
    // Test 2: Chia động (Dynamic splitting cứu đoạn chậm)
    // ----------------------------------------------------
    console.log('\n[Test 2] Kiểm tra chia động (Dynamic split) khi có luồng bị chậm...')
    simulateSlowConnection = true
    slowThreshold = 2 * 1024 * 1024 // Đoạn đầu bị làm chậm
    const file2 = path.join(TEST_DIR, 'test_dynamic_split.bin')
    const dl2 = new HttpDownload(`http://127.0.0.1:${PORT}/file`, file2, {
      threads: 4,
      minSplit: 512 * 1024,
      dynMinSplit: 64 * 1024
    })
    await dl2.start()
    const hash2 = sha256File(file2)
    if (hash2 !== EXPECTED_HASH) throw new Error('Test 2 Thất bại: SHA-256 không khớp sau khi chia động!')
    console.log('✓ Test 2 ĐẠT: Thuật toán chia động hoạt động chính xác, dữ liệu toàn vẹn!')
    simulateSlowConnection = false

    // ----------------------------------------------------
    // Test 3: Server không hỗ trợ Range (Fallback về 200 single thread)
    // ----------------------------------------------------
    console.log('\n[Test 3] Kiểm tra Server không hỗ trợ Range (200 OK Fallback)...')
    simulateNoRange = true
    const file3 = path.join(TEST_DIR, 'test_no_range.bin')
    const dl3 = new HttpDownload(`http://127.0.0.1:${PORT}/file`, file3, { threads: 8 })
    await dl3.start()
    const hash3 = sha256File(file3)
    if (hash3 !== EXPECTED_HASH) throw new Error('Test 3 Thất bại: Dữ liệu tải không khớp khi không có Range!')
    console.log('✓ Test 3 ĐẠT: Tải fallback 1 luồng thành công khi không có Range!')
    simulateNoRange = false

    // ----------------------------------------------------
    // Test 4: Server ngắt kết nối đột ngột (Tự động retry)
    // ----------------------------------------------------
    console.log('\n[Test 4] Kiểm tra tự động thử lại (Retry with backoff) khi đứt mạng...')
    simulateDropCount = 2
    currentDropCount = 0
    const file4 = path.join(TEST_DIR, 'test_retry.bin')
    const dl4 = new HttpDownload(`http://127.0.0.1:${PORT}/file`, file4, {
      threads: 4,
      minSplit: 512 * 1024,
      maxRetries: 5
    })
    await dl4.start()
    const hash4 = sha256File(file4)
    if (hash4 !== EXPECTED_HASH) throw new Error('Test 4 Thất bại: Dữ liệu sau retry không toàn vẹn!')
    console.log('✓ Test 4 ĐẠT: Tự động retry thành công sau các lần đứt kết nối!')
    simulateDropCount = 0

    // ----------------------------------------------------
    // Test 5: Tạm dừng và Tiếp tục (Pause & Resume từ .part.json)
    // ----------------------------------------------------
    console.log('\n[Test 5] Kiểm tra Tạm dừng (stop) và Tiếp tục (resume) với .part.json...')
    const file5 = path.join(TEST_DIR, 'test_resume.bin')
    const dl5a = new HttpDownload(`http://127.0.0.1:${PORT}/file`, file5, {
      threads: 4,
      minSplit: 512 * 1024,
      limiter: new RateLimiter(512 * 1024) // Chạy chậm lại để kịp pause
    })

    const startPromise = dl5a.start()
    // Chờ tải được 1 phần rồi stop
    await new Promise((r) => setTimeout(r, 400))
    await dl5a.stop()
    await startPromise.catch(() => {})

    if (!fs.existsSync(file5 + '.part.json')) {
      throw new Error('Test 5 Thất bại: File .part.json không được tạo khi stop!')
    }
    console.log('  -> Đã tạm dừng giữa chừng, .part.json đã được lưu.')

    // Resume với đối tượng tải mới
    const dl5b = new HttpDownload(`http://127.0.0.1:${PORT}/file`, file5, {
      threads: 4,
      minSplit: 512 * 1024
    })
    await dl5b.start()
    const hash5 = sha256File(file5)
    if (hash5 !== EXPECTED_HASH) throw new Error('Test 5 Thất bại: Dữ liệu resume không khớp!')
    console.log('✓ Test 5 ĐẠT: Tiếp tục tải thành công, SHA-256 hoàn toàn trùng khớp!')

    // ----------------------------------------------------
    // Test 6: Giới hạn tốc độ (RateLimiter)
    // ----------------------------------------------------
    console.log('\n[Test 6] Kiểm tra Giới hạn tốc độ (RateLimiter 2 MB/s)...')
    const file6 = path.join(TEST_DIR, 'test_ratelimit.bin')
    const limitBps = 2 * 1024 * 1024 // 2 MB/s
    const limiter = new RateLimiter(limitBps)
    const dl6 = new HttpDownload(`http://127.0.0.1:${PORT}/file`, file6, {
      threads: 4,
      minSplit: 512 * 1024,
      limiter
    })
    const rlT0 = Date.now()
    await dl6.start()
    const rlDuration = (Date.now() - rlT0) / 1000
    const expectedMinDuration = TEST_SIZE / limitBps - 0.5
    console.log(`  -> Thời gian tải: ${rlDuration.toFixed(2)}s (kỳ vọng >= ${expectedMinDuration.toFixed(1)}s)`)
    if (rlDuration < expectedMinDuration) {
      throw new Error('Test 6 Thất bại: RateLimiter không giới hạn đúng tốc độ!')
    }
    console.log('✓ Test 6 ĐẠT: Giới hạn tốc độ RateLimiter hoạt động chính xác!')

    // ----------------------------------------------------
    // Test 7: Tên file Unicode & uniquePath không ghi đè
    // ----------------------------------------------------
    console.log('\n[Test 7] Kiểm tra tên file Unicode từ Content-Disposition và uniquePath...')
    const dl7a = new HttpDownload(`http://127.0.0.1:${PORT}/unicode-file`, null, {
      dir: TEST_DIR,
      threads: 2,
      minSplit: 1024 * 1024
    })
    await dl7a.start()
    const expectedName1 = path.join(TEST_DIR, 'tệp mẫu đặc biệt.bin')
    if (!fs.existsSync(expectedName1)) {
      throw new Error(`Test 7 Thất bại: Không tìm thấy ${expectedName1}`)
    }

    // Tải lần 2 cùng tên -> phải ra "tệp mẫu đặc biệt (1).bin"
    const dl7b = new HttpDownload(`http://127.0.0.1:${PORT}/unicode-file`, null, {
      dir: TEST_DIR,
      threads: 2,
      minSplit: 1024 * 1024
    })
    await dl7b.start()
    const expectedName2 = path.join(TEST_DIR, 'tệp mẫu đặc biệt (1).bin')
    if (!fs.existsSync(expectedName2)) {
      throw new Error(`Test 7 Thất bại: Không tìm thấy ${expectedName2}`)
    }
    console.log('✓ Test 7 ĐẠT: Tên file Unicode và chống ghi đè uniquePath chính xác!')

    // ----------------------------------------------------
    // Test 8: Batch URL Pattern Expander
    // ----------------------------------------------------
    console.log('\n[Test 8] Kiểm tra mở rộng mẫu URL batch: [001-003]...')
    const urls = expandPattern('https://example.com/item_[008-010].zip')
    if (
      urls.length !== 3 ||
      urls[0] !== 'https://example.com/item_008.zip' ||
      urls[1] !== 'https://example.com/item_009.zip' ||
      urls[2] !== 'https://example.com/item_010.zip'
    ) {
      throw new Error(`Test 8 Thất bại: Kết quả expandPattern sai: ${JSON.stringify(urls)}`)
    }
    console.log('✓ Test 8 ĐẠT: Mở rộng mẫu URL hoạt động chuẩn xác!')

    console.log('\n======================================================')
    console.log('🎉 TẤT CẢ 8 BÀI KIỂM THỬ ENGINE ĐÃ VƯỢT QUA 100% THÀNH CÔNG!')
    console.log('======================================================')
  } finally {
    if (server) server.close()
    // Dọn dẹp thư mục test
    try {
      await fsp.rm(TEST_DIR, { recursive: true, force: true })
    } catch {}
  }
}

runTests().catch((err) => {
  console.error('\n❌ KIỂM THỬ THẤT BẠI:', err)
  process.exit(1)
})

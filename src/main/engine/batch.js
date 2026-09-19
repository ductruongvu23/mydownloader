// src/main/engine/batch.js
/**
 * Mở rộng mẫu URL: http://x/img[001-003].jpg -> img001.jpg, img002.jpg, img003.jpg
 * Hỗ trợ nhiều mẫu lồng nhau trong 1 URL và giữ định dạng số đệm (padding)
 */
function expandPattern(url, limit = 5000) {
  if (!url || typeof url !== 'string') return []
  const m = /\[(\d+)-(\d+)\]/.exec(url)
  if (!m) return [url]
  const [token, a, b] = m
  const start = Number(a)
  const end = Number(b)
  const out = []
  const step = start <= end ? 1 : -1
  for (let i = start; (step > 0 ? i <= end : i >= end) && out.length < limit; i += step) {
    out.push(url.replace(token, String(i).padStart(a.length, '0')))
  }
  return out.flatMap((u) => expandPattern(u, limit))
}

export { expandPattern }

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crcBuf]);
}

function createPng(width, height, pixelFn) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  
  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bit depth
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk('IHDR', ihdrData);

  // Scanlines
  const rowBytes = width * 4 + 1;
  const rawData = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    rawData[rowOffset] = 0; // Filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idat = makeChunk('IDAT', compressed);
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// Generate rounded rectangle app icon with download arrow
function iconDrawer(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const radius = w * 0.22;
  
  // Rounded rect check
  const dx = Math.max(Math.abs(x - cx) - (cx - radius), 0);
  const dy = Math.max(Math.abs(y - cy) - (cy - radius), 0);
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  if (dist > radius) {
    return [0, 0, 0, 0]; // Transparent outside
  }

  const alpha = dist > radius - 1 ? Math.max(0, Math.min(1, radius - dist)) * 255 : 255;

  // Background gradient: #2563eb to #4f46e5
  const t = y / h;
  const bgR = Math.round(37 * (1 - t) + 79 * t);
  const bgG = Math.round(99 * (1 - t) + 70 * t);
  const bgB = Math.round(235 * (1 - t) + 229 * t);

  // Arrow & plate
  const nx = (x - cx) / (w * 0.35);
  const ny = (y - cy) / (h * 0.35);

  let isArrow = false;
  if (Math.abs(nx) <= 0.22 && ny >= -0.55 && ny <= 0.1) isArrow = true;
  if (ny >= 0.05 && ny <= 0.6) {
    const headW = (0.6 - ny) / 0.55 * 0.65;
    if (Math.abs(nx) <= headW) isArrow = true;
  }
  if (Math.abs(nx) <= 0.55 && ny >= 0.68 && ny <= 0.84) isArrow = true;

  if (isArrow) return [255, 255, 255, alpha];
  return [bgR, bgG, bgB, alpha];
}

// Tray icon: crisp 32x32 download icon
function trayDrawer(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const nx = (x - cx) / (w * 0.42);
  const ny = (y - cy) / (h * 0.42);

  let isShape = false;
  if (Math.abs(nx) <= 0.26 && ny >= -0.7 && ny <= 0.1) isShape = true;
  if (ny >= 0.05 && ny <= 0.65) {
    const headW = (0.65 - ny) / 0.6 * 0.75;
    if (Math.abs(nx) <= headW) isShape = true;
  }
  if (Math.abs(nx) <= 0.75 && ny >= 0.72 && ny <= 0.92) isShape = true;

  if (isShape) return [59, 130, 246, 255]; // #3b82f6
  return [0, 0, 0, 0];
}

// Generate icon.png (256x256)
const iconBuf = createPng(256, 256, iconDrawer);
fs.writeFileSync('resources/icon.png', iconBuf);
console.log('Written resources/icon.png, size:', iconBuf.length);

// Generate tray.png (32x32)
const trayBuf = createPng(32, 32, trayDrawer);
fs.writeFileSync('resources/tray.png', trayBuf);
console.log('Written resources/tray.png, size:', trayBuf.length);

// Generate icon.ico containing 256x256, 64x64, 32x32, 16x16
function createIco(images) {
  // images: array of { width, height, buf (png) }
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  let offset = 6 + count * 16;

  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry[0] = img.width >= 256 ? 0 : img.width;
    entry[1] = img.height >= 256 ? 0 : img.height;
    entry[2] = 0; // color count
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(img.buf.length, 8); // size
    entry.writeUInt32LE(offset, 12); // offset
    dirEntries.push(entry);
    offset += img.buf.length;
  }

  const buffers = [header, ...dirEntries, ...images.map(img => img.buf)];
  return Buffer.concat(buffers);
}

const icon64 = createPng(64, 64, iconDrawer);
const icon32 = createPng(32, 32, iconDrawer);
const icon16 = createPng(16, 16, iconDrawer);

const icoBuf = createIco([
  { width: 256, height: 256, buf: iconBuf },
  { width: 64, height: 64, buf: icon64 },
  { width: 32, height: 32, buf: icon32 },
  { width: 16, height: 16, buf: icon16 }
]);

fs.writeFileSync('resources/icon.ico', icoBuf);
console.log('Written resources/icon.ico, size:', icoBuf.length);

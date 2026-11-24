#!/usr/bin/env node
/**
 * 生成桌面客户端图标（不依赖任何第三方库）
 *
 *   node scripts/make-icon.mjs
 *
 * 读 desktop/build/icon-src.png（原图，越大越好，最好是透明底的方形图），
 * 按 Windows 需要的尺寸重采样，输出：
 *   desktop/build/icon.png   256×256，窗口 / 关于窗口用
 *   desktop/build/icon.ico   16/24/32/48/64/128/256，exe 和安装包用
 *
 * 为什么要自己写：这机器上没有 sharp / jimp，Pillow 也没装，
 * 而 PNG 解码 + 面积平均缩放 + ICO 封装本身都不复杂，够用就行。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'desktop', 'build');

const SRC = process.argv[2] || path.join(BUILD, 'icon-src.png');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/* ---------------- CRC32 ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ---------------- PNG 解码 ---------------- */

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG 文件');

  let off = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];

  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);

    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }

    off += 12 + len;
  }

  if (!w || !h) throw new Error('PNG 头损坏');
  if (bitDepth !== 8) throw new Error('只支持 8 位深度的 PNG，当前 ' + bitDepth + ' 位');
  if (colorType !== 6 && colorType !== 2) throw new Error('只支持 RGB / RGBA 的 PNG，当前色彩类型 ' + colorType);
  if (interlace) throw new Error('不支持隔行扫描（interlaced）的 PNG，请重新另存为普通 PNG');

  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const rgba = new Uint8Array(w * h * 4);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < h; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    const row = raw.subarray(start + 1, start + 1 + stride);
    const cur = Buffer.alloc(stride);

    for (let i = 0; i < stride; i++) {
      const x = row[i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v;

      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error('未知的行过滤器 ' + filter);
      }

      cur[i] = v & 0xff;
    }

    for (let x = 0; x < w; x++) {
      const s = x * bpp;
      const d = (y * w + x) * 4;
      rgba[d] = cur[s];
      rgba[d + 1] = cur[s + 1];
      rgba[d + 2] = cur[s + 2];
      rgba[d + 3] = bpp === 4 ? cur[s + 3] : 255;
    }

    prev = cur;
  }

  return { w, h, rgba };
}

/* ---------------- 缩放（面积平均，带 alpha 预乘） ---------------- */

function resize(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  const sx = sw / dw;
  const sy = sh / dh;

  for (let y = 0; y < dh; y++) {
    const y0 = y * sy;
    const y1 = (y + 1) * sy;
    const jy0 = Math.floor(y0);
    const jy1 = Math.min(sh, Math.ceil(y1));

    for (let x = 0; x < dw; x++) {
      const x0 = x * sx;
      const x1 = (x + 1) * sx;
      const ix0 = Math.floor(x0);
      const ix1 = Math.min(sw, Math.ceil(x1));

      let sa = 0, sr = 0, sg = 0, sb = 0, wsum = 0;

      for (let j = jy0; j < jy1; j++) {
        const wy = Math.min(y1, j + 1) - Math.max(y0, j);
        if (wy <= 0) continue;

        for (let i = ix0; i < ix1; i++) {
          const wx = Math.min(x1, i + 1) - Math.max(x0, i);
          if (wx <= 0) continue;

          const weight = wx * wy;
          const o = (j * sw + i) * 4;
          const a = src[o + 3] / 255;

          sa += a * weight;
          sr += src[o] * a * weight;
          sg += src[o + 1] * a * weight;
          sb += src[o + 2] * a * weight;
          wsum += weight;
        }
      }

      const d = (y * dw + x) * 4;
      if (wsum === 0 || sa === 0) continue;   // 全透明，留 0

      out[d] = Math.round(sr / sa);
      out[d + 1] = Math.round(sg / sa);
      out[d + 2] = Math.round(sb / sa);
      out[d + 3] = Math.round((sa / wsum) * 255);
    }
  }

  return out;
}

/* ---------------- PNG 编码 ---------------- */

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // no interlace

  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- ICO 封装 ---------------- */

/* 32 位 BMP 帧：兼容性最好，老 NSIS / rcedit 也不会认错 */
function bmpFrame(rgba, size) {
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4;   // BMP 自下而上
    for (let x = 0; x < size; x++) {
      const s = srcRow + x * 4;
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2];       // B
      xor[d + 1] = rgba[s + 1];   // G
      xor[d + 2] = rgba[s];       // R
      xor[d + 3] = rgba[s + 3];   // A
    }
  }

  const maskRow = ((size + 31) >> 5) * 4;
  const mask = Buffer.alloc(maskRow * size);  // 全 0：不透明性交给 alpha 通道

  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(xor.length + mask.length, 20);

  return Buffer.concat([header, xor, mask]);
}

function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  const dir = Buffer.alloc(16 * frames.length);
  let offset = header.length + dir.length;

  frames.forEach((f, i) => {
    const p = i * 16;
    dir[p] = f.size >= 256 ? 0 : f.size;
    dir[p + 1] = f.size >= 256 ? 0 : f.size;
    dir[p + 2] = 0;
    dir[p + 3] = 0;
    dir.writeUInt16LE(1, p + 4);
    dir.writeUInt16LE(32, p + 6);
    dir.writeUInt32LE(f.data.length, p + 8);
    dir.writeUInt32LE(offset, p + 12);
    offset += f.data.length;
  });

  return Buffer.concat([header, dir, ...frames.map((f) => f.data)]);
}

/* ---------------- 主流程 ---------------- */

if (!fs.existsSync(SRC)) {
  console.error('\n  ✗ 找不到原图：' + SRC + '\n');
  process.exit(1);
}

const src = decodePng(fs.readFileSync(SRC));
console.log('  原图 ' + src.w + '×' + src.h + '  ' + SRC);

// 正方形化：非正方形的先按短边居中裁切，否则图标会被拉扁
let square = src;
if (src.w !== src.h) {
  const side = Math.min(src.w, src.h);
  const ox = Math.floor((src.w - side) / 2);
  const oy = Math.floor((src.h - side) / 2);
  const buf = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    const from = ((y + oy) * src.w + ox) * 4;
    buf.set(src.rgba.subarray(from, from + side * 4), y * side * 4);
  }
  square = { w: side, h: side, rgba: buf };
  console.log('  非正方形，居中裁切为 ' + side + '×' + side);
}

fs.mkdirSync(BUILD, { recursive: true });

const frames = SIZES.map((size) => {
  const data = resize(square.rgba, square.w, square.h, size, size);
  if (size === 256) {
    fs.writeFileSync(path.join(BUILD, 'icon.png'), encodePng(data, 256, 256));
  }
  return { size, data: bmpFrame(data, size), rgba: data };
});

fs.writeFileSync(path.join(BUILD, 'icon.ico'), buildIco(frames));

console.log('  ✓ desktop/build/icon.png  256×256');
console.log('  ✓ desktop/build/icon.ico  ' + SIZES.join('/') + '  ' +
  (fs.statSync(path.join(BUILD, 'icon.ico')).size / 1024).toFixed(0) + ' KB\n');

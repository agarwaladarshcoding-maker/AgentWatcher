#!/usr/bin/env node
/**
 * Generate simple solid-Iris square PNG icons (16/48/128) so the extension has
 * a valid action/toolbar icon without shipping binary assets in the repo.
 * Minimal hand-rolled PNG encoder (truecolor+alpha) using Node's zlib.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "icons");
mkdirSync(outDir, { recursive: true });

// Iris accent #7F77DD.
const R = 0x7f;
const G = 0x77;
const B = 0xdd;

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function makePng(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Raw image: each row prefixed with filter byte 0.
  const rowLen = size * 4;
  const raw = Buffer.alloc((rowLen + 1) * size);
  const radius = size * 0.18;
  for (let y = 0; y < size; y++) {
    const rowStart = y * (rowLen + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      // Rounded-corner alpha for a softer square.
      const inCorner =
        (x < radius && y < radius && dist(x, y, radius, radius) > radius) ||
        (x > size - radius && y < radius && dist(x, y, size - radius, radius) > radius) ||
        (x < radius && y > size - radius && dist(x, y, radius, size - radius) > radius) ||
        (x > size - radius && y > size - radius && dist(x, y, size - radius, size - radius) > radius);
      const a = inCorner ? 0 : 255;
      const o = rowStart + 1 + x * 4;
      raw[o] = R;
      raw[o + 1] = G;
      raw[o + 2] = B;
      raw[o + 3] = a;
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function dist(x, y, cx, cy) {
  return Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
}

for (const size of [16, 48, 128]) {
  writeFileSync(join(outDir, `icon${size}.png`), makePng(size));
}
console.log("✓ Generated icons/icon{16,48,128}.png");

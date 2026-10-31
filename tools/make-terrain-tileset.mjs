#!/usr/bin/env node
/** 生成 Tiled 用的地形图块 public/maps/terrain.png：三种草地、泥路、岩石。 */
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const TILE_W = 64;
const TILE_H = 32;
const COLORS = [
  [0x4a, 0x5a, 0x34],
  [0x46, 0x55, 0x2f],
  [0x4f, 0x60, 0x38],
  [0x7a, 0x6a, 0x4a],
  [0x5c, 0x58, 0x4f],
];

const width = TILE_W * COLORS.length;
const raw = Buffer.alloc((width * 4 + 1) * TILE_H);
for (let y = 0; y < TILE_H; y++) {
  const row = y * (width * 4 + 1);
  for (let x = 0; x < width; x++) {
    const tile = Math.floor(x / TILE_W);
    const dx = Math.abs((x % TILE_W) + 0.5 - TILE_W / 2) / (TILE_W / 2);
    const dy = Math.abs(y + 0.5 - TILE_H / 2) / (TILE_H / 2);
    const inside = dx + dy <= 1;
    const [r, g, b] = COLORS[tile];
    raw.set([r, g, b, inside ? 255 : 0], row + 1 + x * 4);
  }
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(TILE_H, 4);
header.set([8, 6, 0, 0, 0], 8);
writeFileSync(
  new URL('../public/maps/terrain.png', import.meta.url),
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);

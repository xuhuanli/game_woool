#!/usr/bin/env node
/**
 * 把生图产出的 1024×1024 PNG 收成游戏用的 256×256 JPG，并去掉右下角的
 * 「AI生成 / WORKBUDDY」水印。
 *
 * 水印每张图的位置和像素完全一样，所以做法是：
 *   1. 12 张图都转成 BMP（无压缩，好改像素）；
 *   2. 逐像素取十二张的最小值——艺术图各不相同，水印白字始终最亮，
 *      最小值里就只剩水印（金色边框饱和度太高，会被过滤掉）；
 *   3. 用扩散修补把掩码区域填成周围的颜色；
 *   4. sips 缩到 256×256、压成质量 85 的 jpg。
 *
 * 用法：node tools/finish-skill-icons.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'output/icons/new-skills';
const OUT = 'public/assets/icons/hd';
const TMP = 'output/icons/new-skills/.tmp';

/** 生图文件名里的时间戳 → 功法 id。 */
const FILES = {
  'Chinese_xianxia_RPG_skill_icon_2026-11-05T09-04-34.png': 'body-charge-3',
  'Chinese_xianxia_RPG_skill_icon_2026-11-05T09-06-17.png': 'body-mingwang-3',
  'Chinese_xianxia_RPG_skill_icon_2026-11-05T09-05-18.png': 'body-brahma-3',
  'Chinese_xianxia_RPG_skill_icon_2026-11-05T09-06-33.png': 'body-yuanci',
  'Chinese_xianxia_RPG_skill_icon_2026-11-05T09-06-54.png': 'spell-firewall-3',
  'Chinese_xianxia_RPG_skill_icon_2026-11-05T09-07-08.png': 'spell-qingyuan-3',
  'Chinese_xianxia_RPG_skill_icon_2026-11-05T09-07-33.png': 'spell-bixie-3',
  'Chinese_xianxia_RPG_skill_icon_2026-11-05T09-07-47.png': 'spell-yuanci',
  'Chinese_xianxia_RPG_skill_icon_2026-11-05T09-08-17.png': 'spirit-miasma-3',
  'Chinese_xianxia_RPG_skill_icon_2026-11-05T09-08-31.png': 'spirit-corrosion-3',
  'Chinese_xianxia_RPG_skill_icon_2026-11-05T09-08-56.png': 'spirit-puppet-3',
  'Chinese_xianxia_RPG_skill_icon_2026-11-05T09-09-18.png': 'spirit-yuanci',
};

function toBmp(input, output) {
  execFileSync('sips', ['-s', 'format', 'bmp', input, '--out', output], { stdio: 'ignore' });
}

function toJpg(input, output) {
  execFileSync(
    'sips',
    ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-z', '256', '256', input, '--out', output],
    { stdio: 'ignore' },
  );
}

/** 24 位、自顶向下的 BMP。 */
function loadBmp(path) {
  const buffer = readFileSync(path);
  const width = buffer.readInt32LE(18);
  const heightField = buffer.readInt32LE(22);
  const bpp = buffer.readUInt16LE(28);
  if (bpp !== 24) throw new Error(`只处理 24 位 BMP，实际 ${bpp}`);
  if (heightField > 0) throw new Error('只处理自顶向下的 BMP');
  const offset = buffer.readUInt32LE(10);
  const height = -heightField;
  const stride = Math.ceil((width * 3) / 4) * 4;
  return { buffer, width, height, stride, offset };
}

const at = (image, x, y) => image.offset + y * image.stride + x * 3;

const brightness = (image, index) =>
  Math.max(image.buffer[index], image.buffer[index + 1], image.buffer[index + 2]);
const saturation = (image, index) => {
  const b = image.buffer[index];
  const g = image.buffer[index + 1];
  const r = image.buffer[index + 2];
  return Math.max(b, g, r) - Math.min(b, g, r);
};

/**
 * 十二张对齐的图逐像素取最小值，右下角里「十二张都很亮且不偏色」的就是水印。
 * 之后膨胀两圈，避免文字的抗锯齿边缘残留。
 */
function buildMask(images) {
  const { width, height } = images[0];
  const mask = new Uint8Array(width * height);
  const x0 = Math.floor(width * 0.78);
  const y0 = Math.floor(height * 0.82);
  for (let y = y0; y < height; y++) {
    for (let x = x0; x < width; x++) {
      let min = 255;
      let maxSat = 0;
      for (const image of images) {
        const index = at(image, x, y);
        min = Math.min(min, brightness(image, index));
        maxSat = Math.max(maxSat, saturation(image, index));
      }
      if (min > 95 && maxSat < 70) mask[y * width + x] = 1;
    }
  }
  const dilated = Uint8Array.from(mask);
  for (let y = y0; y < height; y++) {
    for (let x = x0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) dilated[ny * width + nx] = 1;
        }
      }
    }
  }
  return dilated;
}

/**
 * 扩散修补：先把掩码像素填成左右邻居的均值，再反复用四邻域平均替换，
 * 颜色从边界慢慢渗进来，看不出补丁。
 */
function inpaint(image, mask) {
  const { buffer, width, height } = image;
  const inside = (x, y) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] === 1;

  for (let y = 0; y < height; y++) {
    let last = -1;
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) {
        last = x;
        continue;
      }
      const left = last >= 0 ? at(image, last, y) : -1;
      let right = -1;
      for (let nx = x + 1; nx < width; nx++) {
        if (!inside(nx, y)) {
          right = at(image, nx, y);
          break;
        }
      }
      for (let channel = 0; channel < 3; channel++) {
        const l = left >= 0 ? buffer[left + channel] : null;
        const r = right >= 0 ? buffer[right + channel] : null;
        buffer[at(image, x, y) + channel] =
          l !== null && r !== null ? Math.round((l + r) / 2) : (l ?? r ?? buffer[at(image, x, y) + channel]);
      }
    }
  }

  const scratch = Buffer.alloc(3);
  for (let pass = 0; pass < 900; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!inside(x, y)) continue;
        const up = at(image, x, Math.max(0, y - 1));
        const down = at(image, x, Math.min(height - 1, y + 1));
        const left = at(image, Math.max(0, x - 1), y);
        const right = at(image, Math.min(width - 1, x + 1), y);
        for (let channel = 0; channel < 3; channel++) {
          scratch[channel] = Math.round(
            (buffer[up + channel] + buffer[down + channel] + buffer[left + channel] + buffer[right + channel]) / 4,
          );
        }
        for (let channel = 0; channel < 3; channel++) buffer[at(image, x, y) + channel] = scratch[channel];
      }
    }
  }
}

mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const entries = Object.entries(FILES);
const images = entries.map(([file, id]) => {
  const bmp = join(TMP, `${id}.bmp`);
  toBmp(join(SRC, file), bmp);
  return { id, path: bmp, image: loadBmp(bmp) };
});

const mask = buildMask(images.map((entry) => entry.image));
const masked = mask.reduce((sum, value) => sum + value, 0);
console.log(`水印掩码 ${masked} 像素`);

for (const { id, path, image } of images) {
  inpaint(image, mask);
  writeFileSync(path, image.buffer);
  toJpg(path, join(OUT, `${id}.jpg`));
  console.log(`✓ ${id}`);
}

rmSync(TMP, { recursive: true, force: true });
console.log('完成', entries.length, '张 →', OUT);

import type Phaser from 'phaser';
import type { DecorDef, MapDef } from '../game/config';
import { Rng } from '../game/rng';
import { TILE_H, TILE_W, toScreen } from './iso';

/** 地形编号，和 tools/make-map.ts 一致。 */
const TILE = {
  grassA: 1,
  grassB: 2,
  grassC: 3,
  dirt: 4,
  stone: 5,
  water: 6,
  sand: 7,
  bridge: 8,
  paved: 9,
  /** 崖外，不画地面 */
  void: 10,
} as const;

/** 一套地表配色：底色、柔化层和斑点。地图配置里的 palette 选用哪套。 */
interface Palette {
  grass: [string, string, string];
  grassB: string;
  grassC: string;
  grassSpeckle: string[];
  sand: string;
  sandSpeckle: string[];
  dirt: string;
  dirtSpeckle: string[];
  stone: string;
  stoneSpeckle: string[];
  paved: string;
  water: [string, string];
}

const PALETTES: Record<string, Palette> = {
  grass: {
    grass: ['#55663a', '#4c5d34', '#5e7040'],
    grassB: 'rgba(70, 90, 44, 0.75)',
    grassC: 'rgba(120, 132, 62, 0.6)',
    grassSpeckle: ['#6d8246', '#46562f', '#7c8f4e'],
    sand: '#b3a276',
    sandSpeckle: ['#94855e', '#cdbd92'],
    dirt: '#806d4b',
    dirtSpeckle: ['#665639', '#97845c'],
    stone: '#5f5a50',
    stoneSpeckle: ['#46423a', '#77726a'],
    paved: '#6f6a5c',
    water: ['#2f6e8c', '#25597a'],
  },
  // 雪原：草地换成积雪，沙地是冰面，泥路是踩实的雪道
  snow: {
    grass: ['#d6dfe4', '#c7d2d9', '#e2e9ec'],
    grassB: 'rgba(178, 196, 208, 0.7)',
    grassC: 'rgba(236, 242, 246, 0.7)',
    grassSpeckle: ['#f4f8fa', '#b4c4ce', '#cfdbe2'],
    sand: '#b8d4e4',
    sandSpeckle: ['#98bcd0', '#dcecf4'],
    dirt: '#9aa8b2',
    dirtSpeckle: ['#7e8c96', '#b8c4cc'],
    stone: '#76828c',
    stoneSpeckle: ['#5a6670', '#96a2aa'],
    paved: '#8794a0',
    water: ['#3a7a9c', '#2c6688'],
  },
};

const LAYER_SCALE = 0.5;

export interface PaintedGround {
  key: string;
  shimmerKey: string;
  x: number;
  y: number;
}

interface Painter {
  map: MapDef;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, context: canvas.getContext('2d')! };
}

function diamondPath(context: CanvasRenderingContext2D, x: number, y: number, grow: number): void {
  const halfW = TILE_W / 2 + grow;
  const halfH = TILE_H / 2 + grow / 2;
  context.beginPath();
  context.moveTo(x, y - halfH);
  context.lineTo(x + halfW, y);
  context.lineTo(x, y + halfH);
  context.lineTo(x - halfW, y);
  context.closePath();
}

function forEachTile(
  { map, offsetX, offsetY }: Painter,
  visit: (tile: number, sx: number, sy: number, x: number, y: number) => void,
): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const { x: sx, y: sy } = toScreen({ x, y });
      visit(map.ground![y * map.width + x]!, sx + offsetX, sy + offsetY, x, y);
    }
  }
}

/** 把某些地形画成模糊遮罩再上色，得到自然的边缘过渡。 */
function softLayer(
  target: CanvasRenderingContext2D,
  painter: Painter,
  tiles: number[],
  color: string,
  blur: number,
  grow: number,
): void {
  const width = Math.ceil(painter.width * LAYER_SCALE);
  const height = Math.ceil(painter.height * LAYER_SCALE);
  const shape = createCanvas(width, height);
  shape.context.scale(LAYER_SCALE, LAYER_SCALE);
  shape.context.fillStyle = '#fff';
  forEachTile(painter, (tile, sx, sy) => {
    if (!tiles.includes(tile)) return;
    diamondPath(shape.context, sx, sy, grow);
    shape.context.fill();
  });

  const soft = createCanvas(width, height);
  soft.context.filter = `blur(${blur}px)`;
  soft.context.drawImage(shape.canvas, 0, 0);
  soft.context.filter = 'none';
  soft.context.globalCompositeOperation = 'source-in';
  soft.context.fillStyle = color;
  soft.context.fillRect(0, 0, width, height);
  target.drawImage(soft.canvas, 0, 0, painter.width, painter.height);
}

function speckle(
  context: CanvasRenderingContext2D,
  painter: Painter,
  rng: Rng,
  tiles: number[],
  count: number,
  colors: string[],
  length: number,
): void {
  forEachTile(painter, (tile, sx, sy) => {
    if (!tiles.includes(tile)) return;
    for (let i = 0; i < count; i++) {
      const px = sx + (rng.next() - 0.5) * TILE_W * 0.8;
      const py = sy + (rng.next() - 0.5) * TILE_H * 0.7;
      context.strokeStyle = colors[rng.int(0, colors.length - 1)]!;
      context.lineWidth = 1 + rng.next();
      context.beginPath();
      context.moveTo(px, py);
      context.lineTo(px + (rng.next() - 0.5) * length, py - rng.next() * length * 0.6);
      context.stroke();
    }
  });
}

function paintBridge(context: CanvasRenderingContext2D, painter: Painter): void {
  forEachTile(painter, (tile, sx, sy) => {
    if (tile !== TILE.bridge) return;
    diamondPath(context, sx, sy, 1);
    context.fillStyle = '#7a5533';
    context.fill();
    context.strokeStyle = '#4e3520';
    context.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      context.beginPath();
      context.moveTo(sx - TILE_W / 2 + (i + 2) * 12, sy - 6 + i * 2);
      context.lineTo(sx - TILE_W / 2 + (i + 2) * 12 + 22, sy + 6 + i * 2);
      context.stroke();
    }
  });
}

/** 石板地：每格一块，砖缝和深浅都有变化。 */
function paintPaved(context: CanvasRenderingContext2D, painter: Painter, rng: Rng): void {
  forEachTile(painter, (tile, sx, sy) => {
    if (tile !== TILE.paved) return;
    diamondPath(context, sx, sy, -1);
    const shade = 132 + rng.int(-9, 9);
    context.fillStyle = `rgb(${shade + 6}, ${shade + 2}, ${shade - 10})`;
    context.fill();
    context.strokeStyle = 'rgba(70, 64, 54, 0.55)';
    context.lineWidth = 1;
    context.stroke();
  });
}

/**
 * 崖壁：崖外没有地面，正面两条边向下拉出一段岩壁，地图看起来是一块高地而不是一张纸。
 * 高度沿崖线缓慢起伏，避免出现整齐的围边。
 */
function paintCliff(context: CanvasRenderingContext2D, painter: Painter): void {
  const { map, offsetX, offsetY } = painter;
  const tileAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= map.width || y >= map.height ? TILE.void : (map.ground?.[y * map.width + x] ?? TILE.void);

  const face = (ax: number, ay: number, bx: number, by: number, drop: number) => {
    const top = Math.min(ay, by);
    const bottom = Math.max(ay, by) + drop;
    const gradient = context.createLinearGradient(0, top, 0, bottom);
    gradient.addColorStop(0, 'rgba(74, 66, 54, 1)');
    gradient.addColorStop(0.5, 'rgba(44, 38, 30, 1)');
    gradient.addColorStop(0.85, 'rgba(24, 20, 15, 0.85)');
    gradient.addColorStop(1, 'rgba(12, 10, 8, 0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(ax, ay);
    context.lineTo(bx, by);
    context.lineTo(bx, by + drop);
    context.lineTo(ax, ay + drop);
    context.closePath();
    context.fill();
    // 岩层纹理
    context.strokeStyle = 'rgba(14, 12, 9, 0.22)';
    context.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      const t = i / 3;
      context.beginPath();
      context.moveTo(ax, ay + drop * t);
      context.lineTo(bx, by + drop * t);
      context.stroke();
    }
    // 崖口的一道亮边
    context.strokeStyle = 'rgba(126, 116, 96, 0.45)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(ax, ay);
    context.lineTo(bx, by);
    context.stroke();
  };

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = tileAt(x, y);
      // 水面没有崖壁，直接暗下去
      if (tile === TILE.void || tile === TILE.water) continue;
      const front = tileAt(x + 1, y) === TILE.void;
      const side = tileAt(x, y + 1) === TILE.void;
      if (!front && !side) continue;
      const { x: sx, y: sy } = toScreen({ x, y });
      const px = sx + offsetX;
      const py = sy + offsetY;
      const wave = Math.sin(x * 0.31 + y * 0.17) + Math.sin(x * 0.11 - y * 0.37);
      const drop = 64 + wave * 10;
      if (front) face(px + TILE_W / 2, py, px, py + TILE_H / 2, drop);
      if (side) face(px - TILE_W / 2, py, px, py + TILE_H / 2, drop);
    }
  }
}

function paintShimmer(painter: Painter, rng: Rng): HTMLCanvasElement {
  const shimmer = createCanvas(Math.ceil(painter.width / 2), Math.ceil(painter.height / 2));
  const { context } = shimmer;
  context.scale(0.5, 0.5);
  context.lineCap = 'round';
  forEachTile(painter, (tile, sx, sy) => {
    if (tile !== TILE.water) return;
    for (let i = 0; i < 2; i++) {
      const px = sx + (rng.next() - 0.5) * TILE_W * 0.7;
      const py = sy + (rng.next() - 0.5) * TILE_H * 0.6;
      const length = 10 + rng.next() * 16;
      context.strokeStyle = `rgba(214, 240, 255, ${0.35 + rng.next() * 0.4})`;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(px - length / 2, py);
      context.quadraticCurveTo(px, py - 2, px + length / 2, py);
      context.stroke();
    }
  });
  return shimmer.canvas;
}

/** 景观按脚底宽度取阴影尺寸；返回 0 表示这件不画阴影。 */
export type ShadowWidth = (item: DecorDef) => number;

let stamp: HTMLCanvasElement | null = null;

/** 复用同一张软边椭圆，画几千件景观时只算一次渐变。 */
function shadowStamp(): HTMLCanvasElement {
  if (stamp) return stamp;
  const size = 128;
  const { canvas, context } = createCanvas(size, size / 2);
  context.translate(size / 2, size / 4);
  context.scale(1, 0.5);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, size / 2);
  gradient.addColorStop(0, 'rgba(16, 12, 8, 0.46)');
  gradient.addColorStop(0.5, 'rgba(16, 12, 8, 0.3)');
  gradient.addColorStop(1, 'rgba(16, 12, 8, 0)');
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, size / 2, 0, Math.PI * 2);
  context.fill();
  stamp = canvas;
  return canvas;
}

/**
 * 把全部景观的接触阴影烘进地表贴图。
 * 一张图上千件树石，逐个加精灵会拖累每帧的深度排序，画进地面是零开销的。
 */
function paintDecorShadows(
  context: CanvasRenderingContext2D,
  painter: Painter,
  map: MapDef,
  width: ShadowWidth,
): void {
  const image = shadowStamp();
  for (const item of map.decor ?? []) {
    const w = width(item);
    if (w <= 0) continue;
    const { x, y } = toScreen(item);
    context.drawImage(image, x + painter.offsetX - w / 2, y + painter.offsetY - w / 4, w, w / 2);
  }
}

/** 预渲染一张地图的地表和水面波光，贴图按地图缓存。 */
export function paintGround(scene: Phaser.Scene, map: MapDef, shadowWidth?: ShadowWidth): PaintedGround {
  const key = `ground-${map.id}`;
  const shimmerKey = `${key}-shimmer`;
  const painted = { key, shimmerKey, x: -map.height * (TILE_W / 2), y: -TILE_H };
  if (scene.textures.exists(key)) return painted;

  const span = map.width + map.height;
  const painter: Painter = {
    map,
    width: span * (TILE_W / 2),
    // 底部多留一段，崖壁要画到地图外面
    height: span * (TILE_H / 2) + TILE_H * 2 + 96,
    offsetX: map.height * (TILE_W / 2),
    offsetY: TILE_H,
  };
  const rng = new Rng(map.width * 7 + map.height);
  const { canvas, context } = createCanvas(painter.width, painter.height);

  const palette = PALETTES[map.palette ?? 'grass'] ?? PALETTES.grass!;
  const base: Record<number, string> = {
    [TILE.grassA]: palette.grass[0],
    [TILE.grassB]: palette.grass[1],
    [TILE.grassC]: palette.grass[2],
  };
  forEachTile(painter, (tile, sx, sy) => {
    // 崖外没有地面，留空露出背景
    if (tile === TILE.void) return;
    diamondPath(context, sx, sy, 1);
    context.fillStyle = base[tile] ?? palette.grass[0];
    context.fill();
  });
  softLayer(context, painter, [TILE.grassB], palette.grassB, 12, 4);
  softLayer(context, painter, [TILE.grassC], palette.grassC, 12, 4);
  speckle(context, painter, rng, [TILE.grassA, TILE.grassB, TILE.grassC], 4, palette.grassSpeckle, 9);

  softLayer(context, painter, [TILE.sand, TILE.water, TILE.bridge], palette.sand, 6, 4);
  speckle(context, painter, rng, [TILE.sand], 3, palette.sandSpeckle, 6);
  softLayer(context, painter, [TILE.dirt], palette.dirt, 5, 3);
  speckle(context, painter, rng, [TILE.dirt], 3, palette.dirtSpeckle, 7);
  softLayer(context, painter, [TILE.stone], palette.stone, 7, 5);
  speckle(context, painter, rng, [TILE.stone], 3, palette.stoneSpeckle, 12);
  softLayer(context, painter, [TILE.paved], palette.paved, 3, 3);
  paintPaved(context, painter, rng);
  softLayer(context, painter, [TILE.water, TILE.bridge], palette.water[0], 4, 2);
  softLayer(context, painter, [TILE.water, TILE.bridge], palette.water[1], 9, -8);
  paintBridge(context, painter);
  // 崖口内侧压一层暗影，让地面和崖外自然过渡
  softLayer(context, painter, [TILE.void], 'rgba(10, 8, 6, 0.5)', 7, 1);
  paintCliff(context, painter);
  if (shadowWidth) paintDecorShadows(context, painter, map, shadowWidth);

  scene.textures.addCanvas(key, canvas);
  scene.textures.addCanvas(shimmerKey, paintShimmer(painter, rng));
  return painted;
}

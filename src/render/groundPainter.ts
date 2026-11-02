import type Phaser from 'phaser';
import type { MapDef } from '../game/config';
import { Rng } from '../game/rng';
import { TILE_H, TILE_W, toScreen } from './iso';

/** 地形编号，和 tools/make-map.ts 一致。 */
const TILE = { grassA: 1, grassB: 2, grassC: 3, dirt: 4, stone: 5, water: 6, sand: 7, bridge: 8, paved: 9 } as const;

const GRASS: Record<number, string> = {
  [TILE.grassA]: '#55663a',
  [TILE.grassB]: '#4c5d34',
  [TILE.grassC]: '#5e7040',
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

/** 预渲染一张地图的地表和水面波光，贴图按地图缓存。 */
export function paintGround(scene: Phaser.Scene, map: MapDef): PaintedGround {
  const key = `ground-${map.id}`;
  const shimmerKey = `${key}-shimmer`;
  const painted = { key, shimmerKey, x: -map.height * (TILE_W / 2), y: -TILE_H };
  if (scene.textures.exists(key)) return painted;

  const span = map.width + map.height;
  const painter: Painter = {
    map,
    width: span * (TILE_W / 2),
    height: span * (TILE_H / 2) + TILE_H * 2,
    offsetX: map.height * (TILE_W / 2),
    offsetY: TILE_H,
  };
  const rng = new Rng(map.width * 7 + map.height);
  const { canvas, context } = createCanvas(painter.width, painter.height);

  forEachTile(painter, (tile, sx, sy) => {
    diamondPath(context, sx, sy, 1);
    context.fillStyle = GRASS[tile] ?? GRASS[TILE.grassA]!;
    context.fill();
  });
  softLayer(context, painter, [TILE.grassB], 'rgba(70, 90, 44, 0.75)', 12, 4);
  softLayer(context, painter, [TILE.grassC], 'rgba(120, 132, 62, 0.6)', 12, 4);
  speckle(context, painter, rng, [TILE.grassA, TILE.grassB, TILE.grassC], 4, ['#6d8246', '#46562f', '#7c8f4e'], 9);

  softLayer(context, painter, [TILE.sand, TILE.water, TILE.bridge], '#b3a276', 6, 4);
  speckle(context, painter, rng, [TILE.sand], 3, ['#94855e', '#cdbd92'], 6);
  softLayer(context, painter, [TILE.dirt], '#806d4b', 5, 3);
  speckle(context, painter, rng, [TILE.dirt], 3, ['#665639', '#97845c'], 7);
  softLayer(context, painter, [TILE.stone], '#5f5a50', 7, 5);
  speckle(context, painter, rng, [TILE.stone], 3, ['#46423a', '#77726a'], 12);
  softLayer(context, painter, [TILE.paved], '#6f6a5c', 3, 3);
  paintPaved(context, painter, rng);
  softLayer(context, painter, [TILE.water, TILE.bridge], '#2f6e8c', 4, 2);
  softLayer(context, painter, [TILE.water, TILE.bridge], '#25597a', 9, -8);
  paintBridge(context, painter);

  scene.textures.addCanvas(key, canvas);
  scene.textures.addCanvas(shimmerKey, paintShimmer(painter, rng));
  return painted;
}

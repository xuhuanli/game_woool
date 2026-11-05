/**
 * 生成带景观的 Tiled 地图，输出到 public/maps/。
 * 路线、河流、建筑和怪区在 MAPS 里手工规划，地形细节和树石按固定种子生成，结果可重复。
 * 用法：npx tsx tools/make-map.ts
 * 重新生成会覆盖在 Tiled 里做的手工修改。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Rng } from '../src/game/rng';

const GROUND = {
  grassA: 1,
  grassB: 2,
  grassC: 3,
  dirt: 4,
  stone: 5,
  water: 6,
  sand: 7,
  bridge: 8,
  paved: 9,
  /** 崖外，不外露地面，渲染时留空 */
  void: 10,
} as const;
const TILE_COUNT = 10;

type Point = [number, number];

interface Zone {
  monster: string;
  x: number;
  y: number;
  radius: number;
  count: number;
}

interface Pond {
  x: number;
  y: number;
  radius: number;
}

interface Circle {
  x: number;
  y: number;
  radius: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface PortalPlan {
  cell: Point;
  label: string;
  toMap: string;
  to: Point;
  requires?: string;
}

interface Building {
  prop: string;
  /** 占地的最小格 */
  x: number;
  y: number;
  /** 翻转后长边沿 y 轴，正面朝 +x */
  flip?: boolean;
}

interface MapPlan {
  id: string;
  size: number;
  seed: number;
  start: Point;
  portals: PortalPlan[];
  roads: Point[][];
  roadTile: number;
  /** 道路半径，可随噪声变化 */
  roadWidth: [number, number];
  river?: Point[];
  ponds?: Pond[];
  zones?: Zone[];
  /** 同一怪区里怪物的最小间距 */
  monsterGap?: number;
  clearings: Circle[];
  /** 铺石地面的范围 */
  paved?: Rect[];
  buildings?: Building[];
  /** 必须走得到的格子，比如 NPC 身边 */
  required?: Point[];
  /** outcrops 是石坡的噪声阈值，越小石坡越多，0 表示没有 */
  edge: { base: number; spread: number; outcrops: number };
  /** 崖线深浅，1 是默认，0 保留方阵（有城墙的主城用） */
  rim?: number;
  /** 树的密度：factor 随噪声变化，least 是最低密度 */
  forest: { factor: number; least?: number; denseArea?: Circle };
  foliage: number[];
  /** 雪原：不长绿色的灌木和草丛（染色盖不住绿色），只留石头和枯树 */
  snow?: boolean;
  /** 树的种类，缺省是常绿树 */
  trees?: string[];
}

/** 建筑占地（格），要和 tools/bake/buildings.ts 的模型一致。 */
const FOOTPRINTS: Record<string, [number, number]> = {
  'bld-hall': [9, 6],
  'bld-house': [6, 4],
  'bld-tower': [5, 5],
  'bld-pavilion': [3, 3],
  'bld-tent': [4, 4],
  'bld-gate': [7, 1],
  'bld-wall': [2, 1],
  'obj-lantern': [1, 1],
  'obj-cauldron': [2, 2],
  'obj-rack': [3, 1],
  'obj-stall': [3, 2],
};
/** 这些建筑按占地判断前后关系，人走到后面时淡化 */
const SOLID = ['bld-hall', 'bld-house', 'bld-tower', 'bld-pavilion', 'bld-tent'];

const footprintOf = (prop: string) => {
  const key = Object.keys(FOOTPRINTS).find((candidate) => prop.startsWith(candidate));
  if (!key) throw new Error(`未知的建筑 ${prop}`);
  return FOOTPRINTS[key]!;
};

const wallRow = (prop: string, y: number, from: number, to: number): Building[] =>
  Array.from({ length: Math.floor((to - from + 1) / 2) }, (_, i) => ({ prop, x: from + i * 2, y }));

const lanterns = (...cells: Point[]): Building[] =>
  cells.map(([x, y]) => ({ prop: 'obj-lantern', x, y }));

const MAPLES = ['maple-1', 'maple-2', 'maple-3', 'maple-4', 'maple-1', 'maple-2', 'maple-3', 'tree-5'];

const MAPS: MapPlan[] = [
  {
    id: 'starter-field',
    size: 120,
    seed: 20261101,
    start: [12, 12],
    portals: [
      { cell: [9, 9], label: '七玄门', toMap: 'qixuan-gate', to: [20, 33] },
      { cell: [15, 8], label: '黄枫谷', toMap: 'huangfeng-valley', to: [20, 33], requires: 'ch2-token' },
      { cell: [111, 111], label: '太南山', toMap: 'taina-mountain', to: [12, 12], requires: 'ch1-boss' },
    ],
    roads: [
      [[12, 12], [30, 21], [51, 30], [66, 45], [78, 63], [90, 81], [105, 105], [111, 111]],
      [[42, 27], [36, 42], [24, 51]],
      [[81, 68], [93, 63], [99, 57]],
      [[87, 77], [72, 87], [60, 93]],
    ],
    roadTile: GROUND.dirt,
    roadWidth: [0.9, 0.9],
    river: [[102, -3], [90, 18], [75, 33], [60, 51], [45, 63], [30, 81], [15, 96], [-3, 108]],
    ponds: [{ x: 33, y: 81, radius: 10 }],
    zones: [
      { monster: 'ash-rat', x: 33, y: 24, radius: 13, count: 10 },
      { monster: 'ash-rat', x: 57, y: 21, radius: 10, count: 6 },
      { monster: 'venom-spider', x: 24, y: 51, radius: 12, count: 10 },
      { monster: 'thorn-sprite', x: 60, y: 93, radius: 13, count: 9 },
      { monster: 'wolf-rider', x: 99, y: 57, radius: 10, count: 8 },
      { monster: 'golden-master', x: 102, y: 99, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 8 },
      { x: 99, y: 57, radius: 10 },
      { x: 102, y: 99, radius: 10 },
      { x: 111, y: 111, radius: 5 },
    ],
    edge: { base: 3, spread: 5, outcrops: 0.76 },
    forest: { factor: 0.6, denseArea: { x: 60, y: 93, radius: 24 } },
    foliage: [0xffffff, 0xffffff, 0xdff0b0, 0xffd27a, 0xffa86a, 0xff8a6a],
  },
  {
    id: 'taina-mountain',
    size: 120,
    seed: 20261104,
    start: [12, 12],
    portals: [
      { cell: [9, 9], label: '彩霞山', toMap: 'starter-field', to: [108, 108] },
      { cell: [58, 58], label: '太南谷', toMap: 'taina-valley', to: [20, 33], requires: 'ch2-enter' },
    ],
    roads: [
      [[12, 12], [26, 18], [40, 32], [50, 46], [58, 58], [62, 74], [62, 88]],
      [[34, 26], [52, 22], [72, 20]],
      [[58, 62], [74, 70], [92, 80], [104, 100]],
      [[44, 40], [30, 54], [20, 72]],
    ],
    roadTile: GROUND.dirt,
    roadWidth: [0.9, 0.9],
    river: [[-3, 40], [14, 42], [30, 38], [46, 54], [66, 62], [86, 58], [104, 66], [123, 62]],
    ponds: [{ x: 92, y: 34, radius: 9 }],
    zones: [
      { monster: 'mountain-ape', x: 30, y: 20, radius: 13, count: 10 },
      { monster: 'green-snake', x: 62, y: 22, radius: 13, count: 9 },
      { monster: 'night-bat', x: 22, y: 74, radius: 13, count: 7 },
      { monster: 'mountain-ape', x: 40, y: 72, radius: 9, count: 6 },
      { monster: 'ape-shaman', x: 82, y: 76, radius: 11, count: 8 },
      { monster: 'wolf-rider', x: 78, y: 96, radius: 9, count: 4 },
      { monster: 'qingwen-daoren', x: 62, y: 93, radius: 0, count: 1 },
      { monster: 'flood-serpent', x: 105, y: 102, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 8 },
      { x: 58, y: 58, radius: 6 },
      { x: 62, y: 92, radius: 10 },
      { x: 105, y: 102, radius: 9 },
    ],
    paved: [{ x0: 55, y0: 85, x1: 69, y1: 99 }],
    buildings: [
      { prop: 'bld-pavilion-plain', x: 51, y: 84 },
      { prop: 'obj-rack', x: 57, y: 83 },
      { prop: 'obj-rack', x: 65, y: 83 },
      ...lanterns([55, 85], [69, 85], [55, 99], [69, 99]),
    ],
    required: [[62, 85], [15, 13]],
    edge: { base: 3, spread: 6, outcrops: 0.68 },
    forest: { factor: 0.45, denseArea: { x: 24, y: 76, radius: 18 } },
    foliage: [0xffffff, 0xffffff, 0xd8f0d8, 0xc8e8e0],
  },
  {
    id: 'taina-valley',
    size: 40,
    seed: 20261105,
    start: [20, 24],
    portals: [{ cell: [20, 36], label: '太南山', toMap: 'taina-mountain', to: [60, 56] }],
    roads: [[[20, 37], [20, 12]]],
    roadTile: GROUND.dirt,
    roadWidth: [1.5, 0.4],
    ponds: [{ x: 31, y: 33, radius: 3 }],
    clearings: [{ x: 20, y: 36, radius: 3 }],
    paved: [{ x0: 12, y0: 12, x1: 28, y1: 23 }],
    buildings: [
      { prop: 'bld-house-plain', x: 8, y: 5 },
      { prop: 'bld-house-plain', x: 26, y: 5 },
      { prop: 'bld-pavilion-plain', x: 19, y: 7 },
      { prop: 'bld-house-plain', x: 7, y: 15, flip: true },
      { prop: 'bld-house-plain', x: 7, y: 22, flip: true },
      { prop: 'bld-house-plain', x: 30, y: 13 },
      { prop: 'bld-house-plain', x: 30, y: 19 },
      { prop: 'bld-gate-taina', x: 17, y: 29 },
      { prop: 'obj-stall', x: 13, y: 15 },
      { prop: 'obj-stall', x: 13, y: 21 },
      { prop: 'obj-stall', x: 25, y: 15 },
      { prop: 'obj-stall', x: 25, y: 21 },
      ...lanterns([12, 12], [28, 12], [17, 25], [23, 25], [17, 32], [23, 32]),
    ],
    required: [[20, 14], [27, 20], [13, 20]],
    edge: { base: 2, spread: 2.5, outcrops: 0 },
    forest: { factor: 1, least: 0.05 },
    foliage: [0xffffff, 0xffffff, 0xd8f0d8, 0xffd27a],
  },
  {
    id: 'blood-forbidden',
    size: 100,
    seed: 20261106,
    start: [12, 12],
    portals: [{ cell: [8, 8], label: '黄枫谷', toMap: 'huangfeng-valley', to: [20, 33] }],
    roads: [
      [[12, 12], [26, 22], [40, 34], [50, 50], [54, 66], [52, 74]],
      [[30, 26], [34, 14], [58, 14], [76, 22]],
      [[42, 38], [24, 50], [20, 70]],
      [[50, 52], [70, 56], [80, 72]],
    ],
    roadTile: GROUND.dirt,
    roadWidth: [0.8, 0.8],
    ponds: [{ x: 76, y: 40, radius: 6 }, { x: 22, y: 86, radius: 5 }],
    zones: [
      { monster: 'blood-spider', x: 34, y: 18, radius: 12, count: 10 },
      { monster: 'red-snake', x: 70, y: 22, radius: 12, count: 10 },
      { monster: 'rival-disciple', x: 22, y: 62, radius: 12, count: 8 },
      { monster: 'rival-disciple', x: 70, y: 60, radius: 9, count: 5 },
      { monster: 'feng-yue', x: 82, y: 76, radius: 0, count: 1 },
      { monster: 'mo-jiao', x: 50, y: 77, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 82, y: 76, radius: 8 },
      { x: 61, y: 80, radius: 3 },
    ],
    paved: [{ x0: 44, y0: 72, x1: 60, y1: 82 }],
    buildings: [
      { prop: 'bld-hall-stone', x: 48, y: 63 },
      ...wallRow('bld-wall-stone', 71, 40, 43),
      ...wallRow('bld-wall-stone', 71, 61, 64),
      { prop: 'obj-lantern-stone', x: 44, y: 72 },
      { prop: 'obj-lantern-stone', x: 60, y: 72 },
      { prop: 'obj-lantern-stone', x: 44, y: 82 },
      { prop: 'obj-lantern-stone', x: 60, y: 82 },
    ],
    required: [[13, 11], [61, 80]],
    edge: { base: 3, spread: 5, outcrops: 0.7 },
    forest: { factor: 0.5 },
    foliage: [0xc87a6a, 0xb86a5a, 0xa85a4a, 0xd89a7a],
    trees: ['bare-1', 'bare-2', 'bare-1', 'tree-5', 'tree-7', 'bare-2'],
  },
  {
    id: 'yanling-fort',
    size: 100,
    seed: 20261107,
    start: [12, 12],
    portals: [{ cell: [8, 8], label: '黄枫谷', toMap: 'huangfeng-valley', to: [20, 33] }],
    roads: [
      [[12, 12], [24, 22], [36, 30], [46, 40], [50, 52]],
      [[30, 26], [24, 48], [20, 70]],
      [[50, 62], [52, 78], [70, 86]],
      [[56, 52], [76, 50], [88, 40]],
    ],
    roadTile: GROUND.dirt,
    roadWidth: [0.9, 0.8],
    river: [[-3, 60], [16, 58], [32, 64], [46, 72], [64, 70], [80, 76], [103, 72]],
    zones: [
      { monster: 'yin-soul', x: 26, y: 40, radius: 12, count: 12 },
      { monster: 'yin-soul', x: 80, y: 26, radius: 10, count: 8 },
      { monster: 'ghost-disciple', x: 76, y: 52, radius: 10, count: 8 },
      { monster: 'ghost-disciple', x: 28, y: 82, radius: 11, count: 8 },
      { monster: 'wang-chan', x: 76, y: 86, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 76, y: 86, radius: 8 },
    ],
    paved: [{ x0: 40, y0: 44, x1: 60, y1: 58 }],
    buildings: [
      { prop: 'bld-hall-yan', x: 46, y: 36 },
      { prop: 'bld-house-plain', x: 36, y: 40, flip: true },
      { prop: 'bld-house-plain', x: 61, y: 40, flip: true },
      { prop: 'bld-tower-plain', x: 62, y: 48 },
      { prop: 'bld-gate-yan', x: 47, y: 59 },
      ...wallRow('bld-wall-plain', 59, 36, 46),
      ...wallRow('bld-wall-plain', 59, 54, 64),
      ...lanterns([40, 44], [60, 44], [46, 57], [54, 57]),
    ],
    required: [[15, 13], [12, 16], [50, 50]],
    edge: { base: 3, spread: 5, outcrops: 0.74 },
    forest: { factor: 0.6 },
    foliage: [0xffffff, 0xd8d0e8, 0xc8c0d8, 0xffe0c0],
  },
  {
    id: 'spirit-mine',
    size: 100,
    seed: 20261108,
    start: [12, 12],
    portals: [{ cell: [8, 8], label: '黄枫谷', toMap: 'huangfeng-valley', to: [20, 33] }],
    roads: [
      [[12, 12], [28, 26], [44, 30], [60, 44], [70, 62], [76, 80]],
      [[30, 28], [22, 50], [26, 74]],
      [[60, 44], [82, 34]],
    ],
    roadTile: GROUND.dirt,
    roadWidth: [1.1, 0.6],
    ponds: [{ x: 50, y: 70, radius: 5 }],
    zones: [
      { monster: 'corpse-puppet', x: 36, y: 22, radius: 12, count: 12 },
      { monster: 'demon-cultist', x: 76, y: 32, radius: 11, count: 12 },
      { monster: 'blood-bat', x: 24, y: 64, radius: 12, count: 12 },
      { monster: 'blood-guardian', x: 76, y: 84, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 76, y: 84, radius: 8 },
    ],
    paved: [{ x0: 70, y0: 78, x1: 82, y1: 90 }],
    buildings: [
      { prop: 'bld-house-plain', x: 16, y: 4 },
      ...lanterns([70, 78], [82, 78], [70, 90], [82, 90]),
    ],
    required: [[14, 12]],
    edge: { base: 3, spread: 6, outcrops: 0.62 },
    forest: { factor: 0.3 },
    foliage: [0xc8c8d0, 0xb8b8c8, 0xd8d8e0],
    trees: ['bare-1', 'bare-2', 'tree-5', 'tree-7'],
  },
  {
    id: 'jingu-plain',
    size: 120,
    seed: 20261109,
    start: [12, 12],
    portals: [{ cell: [8, 8], label: '黄枫谷', toMap: 'huangfeng-valley', to: [20, 33] }],
    roads: [
      [[12, 12], [30, 24], [52, 40], [70, 58], [88, 78], [104, 100]],
      [[40, 32], [26, 60], [30, 92]],
      [[70, 58], [96, 46]],
    ],
    roadTile: GROUND.dirt,
    roadWidth: [1.2, 0.8],
    river: [[50, -3], [56, 20], [48, 44], [58, 70], [52, 96], [60, 123]],
    zones: [
      { monster: 'demon-swordsman', x: 30, y: 42, radius: 14, count: 13 },
      { monster: 'poison-toad', x: 30, y: 84, radius: 14, count: 13 },
      { monster: 'demon-sorcerer', x: 90, y: 40, radius: 13, count: 13 },
      { monster: 'demon-swordsman', x: 82, y: 72, radius: 10, count: 6 },
      { monster: 'demon-commander', x: 100, y: 96, radius: 0, count: 1 },
    ],
    monsterGap: 6,
    clearings: [
      { x: 12, y: 12, radius: 9 },
      { x: 100, y: 96, radius: 10 },
    ],
    paved: [{ x0: 8, y0: 6, x1: 20, y1: 18 }],
    buildings: [
      { prop: 'obj-stall', x: 7, y: 20 },
      { prop: 'obj-stall', x: 18, y: 20 },
      { prop: 'obj-rack', x: 21, y: 9 },
      { prop: 'obj-rack', x: 21, y: 14 },
      ...wallRow('bld-wall-plain', 22, 4, 13),
      { prop: 'obj-stall', x: 96, y: 88 },
      { prop: 'obj-stall', x: 104, y: 88 },
      { prop: 'obj-rack', x: 92, y: 94 },
      ...lanterns([94, 92], [106, 92], [94, 102], [106, 102]),
    ],
    required: [[15, 12], [11, 16]],
    edge: { base: 3, spread: 4, outcrops: 0.8 },
    forest: { factor: 0.35 },
    foliage: [0xffffff, 0xe8e0b0, 0xffd27a, 0xd8e0a0],
  },
  {
    id: 'outer-sea',
    size: 120,
    seed: 20261110,
    start: [12, 12],
    portals: [{ cell: [8, 8], label: '天星城', toMap: 'tianxing-city', to: [20, 33] }],
    roads: [
      [[12, 12], [28, 28], [44, 40], [62, 36], [80, 46], [96, 74], [102, 100]],
      [[28, 28], [32, 60], [40, 74]],
      [[44, 40], [70, 20]],
    ],
    roadTile: GROUND.sand,
    roadWidth: [1.1, 0.7],
    ponds: [
      { x: 52, y: 38, radius: 6 },
      { x: 14, y: 44, radius: 11 },
      { x: 62, y: 62, radius: 15 },
      { x: 100, y: 26, radius: 14 },
      { x: 30, y: 98, radius: 15 },
      { x: 76, y: 96, radius: 10 },
      { x: 108, y: 58, radius: 9 },
      { x: 50, y: 10, radius: 7 },
    ],
    zones: [
      { monster: 'sea-squid', x: 26, y: 30, radius: 12, count: 12 },
      { monster: 'sea-squid', x: 72, y: 20, radius: 9, count: 6 },
      { monster: 'fish-demon', x: 36, y: 66, radius: 12, count: 13 },
      { monster: 'flying-ray', x: 84, y: 48, radius: 12, count: 13 },
      { monster: 'fish-demon', x: 96, y: 80, radius: 8, count: 5 },
      { monster: 'sea-king', x: 102, y: 102, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 8 },
      { x: 102, y: 102, radius: 10 },
    ],
    required: [[15, 12]],
    edge: { base: 3, spread: 5, outcrops: 0.8 },
    forest: { factor: 0.3 },
    foliage: [0xffffff, 0xd8f0e0, 0xc8e8d8, 0xe8f0b0],
  },
  {
    id: 'xutian-mist',
    size: 100,
    seed: 20261111,
    start: [12, 12],
    portals: [
      { cell: [8, 8], label: '天星城', toMap: 'tianxing-city', to: [20, 33] },
      { cell: [90, 90], label: '冰火道', toMap: 'xutian-hall', to: [12, 12], requires: 'ch5-skull' },
    ],
    roads: [
      [[12, 12], [26, 24], [40, 30], [52, 46], [66, 62], [80, 78], [90, 90]],
      [[26, 24], [24, 50], [30, 74]],
      [[52, 46], [74, 28]],
    ],
    roadTile: GROUND.dirt,
    roadWidth: [0.9, 0.7],
    ponds: [{ x: 48, y: 72, radius: 6 }],
    zones: [
      { monster: 'mist-ghost', x: 32, y: 34, radius: 12, count: 12 },
      { monster: 'mist-ghost', x: 74, y: 26, radius: 10, count: 7 },
      { monster: 'skull-ghost', x: 28, y: 72, radius: 11, count: 9 },
      { monster: 'skull-ghost', x: 74, y: 70, radius: 10, count: 9 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 90, y: 90, radius: 5 },
    ],
    paved: [{ x0: 84, y0: 84, x1: 95, y1: 95 }],
    buildings: [
      ...wallRow('bld-wall-stone', 83, 76, 83),
      ...lanterns([84, 84], [95, 84], [84, 95]),
    ],
    required: [[15, 12]],
    edge: { base: 3, spread: 5, outcrops: 0.7 },
    forest: { factor: 0.7 },
    foliage: [0xa8b0b8, 0x98a0a8, 0xb8c0c8],
    trees: ['bare-1', 'bare-2', 'bare-1', 'tree-5', 'bare-2', 'tree-7'],
  },
  {
    id: 'xutian-hall',
    size: 90,
    seed: 20261112,
    start: [12, 12],
    portals: [
      { cell: [8, 8], label: '鬼雾', toMap: 'xutian-mist', to: [86, 86] },
      { cell: [82, 82], label: '鼎殿', toMap: 'xutian-core', to: [12, 12], requires: 'ch5-jiyin' },
    ],
    roads: [
      [[12, 12], [26, 26], [44, 30], [48, 48], [56, 64], [70, 72], [82, 82]],
      [[26, 26], [24, 50], [28, 70]],
      [[44, 30], [68, 28]],
    ],
    roadTile: GROUND.paved,
    roadWidth: [1.2, 0.4],
    river: [[-3, 40], [18, 42], [36, 38], [60, 46], [76, 44], [93, 50]],
    zones: [
      { monster: 'palace-puppet', x: 30, y: 26, radius: 11, count: 12 },
      { monster: 'palace-puppet', x: 68, y: 26, radius: 8, count: 5 },
      { monster: 'treasure-seeker', x: 28, y: 66, radius: 11, count: 12 },
      { monster: 'treasure-seeker', x: 52, y: 60, radius: 8, count: 5 },
      { monster: 'jiyin', x: 68, y: 74, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 68, y: 74, radius: 8 },
      { x: 82, y: 82, radius: 4 },
    ],
    paved: [{ x0: 60, y0: 66, x1: 76, y1: 80 }],
    buildings: [
      { prop: 'bld-hall-stone', x: 40, y: 50 },
      ...wallRow('bld-wall-stone', 64, 22, 33),
      { prop: 'obj-lantern-stone', x: 60, y: 66 },
      { prop: 'obj-lantern-stone', x: 76, y: 66 },
      { prop: 'obj-lantern-stone', x: 60, y: 80 },
      { prop: 'obj-lantern-stone', x: 76, y: 80 },
    ],
    required: [[15, 12]],
    edge: { base: 3, spread: 4, outcrops: 0.66 },
    forest: { factor: 0.25 },
    foliage: [0xc8e0ff, 0xb0d0f0, 0xffb08a, 0xe0f0ff],
    trees: ['bare-1', 'bare-2', 'tree-5'],
  },
  {
    id: 'xutian-core',
    size: 70,
    seed: 20261113,
    start: [12, 12],
    portals: [{ cell: [8, 8], label: '冰火道', toMap: 'xutian-hall', to: [80, 80] }],
    roads: [
      [[12, 12], [24, 26], [34, 38], [46, 48], [54, 54]],
      [[24, 26], [50, 20]],
      [[34, 38], [22, 52]],
    ],
    roadTile: GROUND.paved,
    roadWidth: [1.3, 0.3],
    zones: [
      { monster: 'heavenly-demon', x: 28, y: 44, radius: 10, count: 11 },
      { monster: 'shadow-demon', x: 48, y: 22, radius: 10, count: 11 },
      { monster: 'xuangu', x: 54, y: 54, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 54, y: 54, radius: 9 },
    ],
    paved: [{ x0: 46, y0: 46, x1: 62, y1: 62 }],
    buildings: [
      { prop: 'obj-cauldron', x: 57, y: 57 },
      { prop: 'obj-lantern-stone', x: 46, y: 46 },
      { prop: 'obj-lantern-stone', x: 62, y: 46 },
      { prop: 'obj-lantern-stone', x: 46, y: 62 },
      { prop: 'obj-lantern-stone', x: 62, y: 62 },
    ],
    required: [[15, 12]],
    edge: { base: 3, spread: 4, outcrops: 0.72 },
    forest: { factor: 0.2 },
    foliage: [0xc87a8a, 0xa85a6a, 0xd89aaa],
    trees: ['bare-1', 'bare-2'],
  },
  {
    id: 'zhuomo-outer',
    size: 120,
    seed: 20261115,
    start: [12, 12],
    portals: [
      { cell: [8, 8], label: '落云宗', toMap: 'luoyun-sect', to: [20, 33] },
      { cell: [108, 108], label: '内谷', toMap: 'zhuomo-inner', to: [12, 12], requires: 'ch6-warden' },
    ],
    roads: [
      [[12, 12], [30, 26], [48, 40], [62, 58], [80, 76], [96, 94], [108, 108]],
      [[30, 26], [24, 56], [32, 86]],
      [[48, 40], [80, 26], [100, 36]],
    ],
    roadTile: GROUND.dirt,
    roadWidth: [1, 0.7],
    river: [[-3, 70], [20, 66], [42, 74], [58, 92], [70, 123]],
    ponds: [{ x: 84, y: 54, radius: 7 }],
    zones: [
      { monster: 'demon-beast', x: 34, y: 30, radius: 13, count: 13 },
      { monster: 'demon-beast', x: 84, y: 28, radius: 10, count: 7 },
      { monster: 'valley-wraith', x: 30, y: 86, radius: 13, count: 12 },
      { monster: 'valley-wraith', x: 72, y: 64, radius: 10, count: 7 },
      { monster: 'valley-warden', x: 98, y: 98, radius: 0, count: 1 },
    ],
    monsterGap: 6,
    clearings: [
      { x: 12, y: 12, radius: 8 },
      { x: 98, y: 98, radius: 9 },
      { x: 108, y: 108, radius: 4 },
    ],
    required: [[15, 12]],
    edge: { base: 3, spread: 6, outcrops: 0.7 },
    forest: { factor: 0.45 },
    foliage: [0xa898a8, 0x988898, 0xb8a0b0, 0x8a7a8a],
    trees: ['bare-1', 'bare-2', 'tree-5', 'tree-7', 'bare-1'],
  },
  {
    id: 'zhuomo-inner',
    size: 100,
    seed: 20261116,
    start: [12, 12],
    portals: [
      { cell: [8, 8], label: '外谷', toMap: 'zhuomo-outer', to: [104, 104] },
      { cell: [90, 90], label: '血咒之门', toMap: 'blood-gate', to: [12, 12], requires: 'ch6-gate' },
    ],
    roads: [
      [[12, 12], [26, 26], [40, 34], [52, 50], [66, 66], [80, 80], [90, 90]],
      [[26, 26], [22, 54], [30, 78]],
      [[52, 50], [76, 34]],
    ],
    roadTile: GROUND.dirt,
    roadWidth: [0.9, 0.7],
    ponds: [{ x: 50, y: 74, radius: 6 }, { x: 72, y: 18, radius: 5 }],
    zones: [
      { monster: 'blood-ape', x: 32, y: 36, radius: 12, count: 12 },
      { monster: 'curse-spirit', x: 28, y: 72, radius: 11, count: 12 },
      { monster: 'demon-cultivator', x: 74, y: 42, radius: 11, count: 12 },
      { monster: 'curse-spirit', x: 76, y: 72, radius: 8, count: 5 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 90, y: 90, radius: 5 },
    ],
    paved: [{ x0: 84, y0: 84, x1: 95, y1: 95 }],
    buildings: [
      ...wallRow('bld-wall-stone', 83, 76, 83),
      { prop: 'obj-lantern-stone', x: 84, y: 84 },
      { prop: 'obj-lantern-stone', x: 95, y: 84 },
      { prop: 'obj-lantern-stone', x: 84, y: 95 },
    ],
    required: [[15, 12], [13, 16]],
    edge: { base: 3, spread: 5, outcrops: 0.68 },
    forest: { factor: 0.5 },
    foliage: [0xb87a7a, 0xa86a6a, 0x986a7a],
    trees: ['bare-1', 'bare-2', 'bare-1', 'tree-7'],
  },
  {
    id: 'blood-gate',
    size: 70,
    seed: 20261117,
    start: [12, 12],
    portals: [{ cell: [8, 8], label: '内谷', toMap: 'zhuomo-inner', to: [86, 86] }],
    roads: [
      [[12, 12], [24, 24], [36, 34], [48, 46], [54, 54]],
      [[24, 24], [50, 18]],
      [[36, 34], [20, 52]],
    ],
    roadTile: GROUND.paved,
    roadWidth: [1.3, 0.3],
    zones: [
      { monster: 'ancient-shade', x: 44, y: 22, radius: 10, count: 10 },
      { monster: 'ancient-shade', x: 24, y: 46, radius: 10, count: 10 },
      { monster: 'demon-nanlong', x: 54, y: 54, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 54, y: 54, radius: 9 },
    ],
    paved: [{ x0: 46, y0: 46, x1: 62, y1: 62 }],
    buildings: [
      { prop: 'bld-gate-stone', x: 51, y: 61 },
      { prop: 'obj-lantern-stone', x: 46, y: 46 },
      { prop: 'obj-lantern-stone', x: 62, y: 46 },
      { prop: 'obj-lantern-stone', x: 46, y: 60 },
      { prop: 'obj-lantern-stone', x: 62, y: 60 },
    ],
    required: [[15, 12]],
    edge: { base: 3, spread: 4, outcrops: 0.72 },
    forest: { factor: 0.2 },
    foliage: [0xc85a5a, 0xa84a4a, 0xd87a6a],
    trees: ['bare-1', 'bare-2'],
  },
  {
    id: 'luoyun-sect',
    size: 40,
    seed: 20261118,
    start: [20, 24],
    portals: [{ cell: [20, 36], label: '坠魔谷', toMap: 'zhuomo-outer', to: [12, 12], requires: 'ch6-invite' }],
    roads: [[[20, 37], [20, 12]]],
    roadTile: GROUND.paved,
    roadWidth: [1.6, 0],
    river: [[42, 27], [30, 29], [20, 28], [10, 30], [-2, 28]],
    clearings: [{ x: 20, y: 36, radius: 3 }],
    paved: [
      { x0: 12, y0: 12, x1: 28, y1: 26 },
      { x0: 9, y0: 19, x1: 15, y1: 22 },
    ],
    buildings: [
      { prop: 'bld-hall-luoyun', x: 16, y: 4 },
      { prop: 'bld-tower-sect', x: 6, y: 9 },
      { prop: 'bld-house-sect', x: 29, y: 12 },
      { prop: 'bld-house-sect', x: 29, y: 5 },
      { prop: 'bld-house-sect', x: 4, y: 3 },
      { prop: 'bld-gate-luoyun', x: 17, y: 32 },
      ...wallRow('bld-wall-sect', 32, 3, 16),
      ...wallRow('bld-wall-sect', 32, 24, 37),
      { prop: 'bld-pavilion-sect', x: 31, y: 21 },
      { prop: 'obj-cauldron', x: 25, y: 23 },
      { prop: 'obj-stall', x: 28, y: 17 },
      ...lanterns([12, 12], [28, 12], [17, 26], [23, 26], [17, 35], [23, 35]),
    ],
    required: [[20, 16], [24, 14], [27, 20], [13, 20], [24, 26]],
    edge: { base: 2, spread: 2.5, outcrops: 0 },
    forest: { factor: 1.5, least: 0.1 },
    foliage: [0xffffff, 0xe0f0ff, 0xd0e0f8],
  },
  {
    id: 'mulan-border',
    size: 70,
    seed: 20261119,
    start: [12, 12],
    portals: [{ cell: [8, 8], label: '落云宗', toMap: 'luoyun-sect', to: [20, 33] }],
    roads: [
      [[12, 12], [26, 22], [40, 34], [54, 54]],
      [[26, 22], [52, 16]],
      [[40, 34], [18, 52]],
    ],
    roadTile: GROUND.dirt,
    roadWidth: [1, 0.6],
    zones: [
      { monster: 'mulan-rider', x: 44, y: 18, radius: 10, count: 12 },
      { monster: 'mulan-mage', x: 20, y: 46, radius: 10, count: 12 },
      { monster: 'le-shangshi', x: 54, y: 54, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 54, y: 54, radius: 8 },
    ],
    required: [[15, 12]],
    edge: { base: 3, spread: 4, outcrops: 0.8 },
    forest: { factor: 0.15 },
    foliage: [0xf0e0a0, 0xd8d08a, 0xe8c87a],
    trees: ['tree-3', 'tree-6', 'bare-1'],
  },
  {
    id: 'cangl-tribe',
    size: 40,
    seed: 20261120,
    start: [20, 24],
    portals: [{ cell: [20, 36], label: '天澜草原', toMap: 'tianlan-grass', to: [14, 14] }],
    roads: [[[20, 37], [20, 12]]],
    roadTile: GROUND.dirt,
    roadWidth: [1.4, 0],
    ponds: [{ x: 33, y: 33, radius: 2 }],
    clearings: [{ x: 20, y: 36, radius: 3 }, { x: 20, y: 20, radius: 9 }],
    buildings: [
      { prop: 'bld-tent-grass', x: 18, y: 6 },
      { prop: 'bld-tent-grass', x: 9, y: 9 },
      { prop: 'bld-tent-grass', x: 27, y: 9 },
      { prop: 'bld-tent-grass', x: 6, y: 24 },
      { prop: 'bld-tent-grass', x: 29, y: 25 },
      { prop: 'bld-tent-grass', x: 8, y: 30 },
      { prop: 'obj-stall', x: 24, y: 17 },
      { prop: 'obj-rack', x: 14, y: 15 },
      { prop: 'obj-cauldron', x: 22, y: 22 },
    ],
    required: [[20, 16], [27, 20], [13, 20], [24, 26]],
    edge: { base: 2, spread: 2.5, outcrops: 0 },
    forest: { factor: 0.4, least: 0.02 },
    foliage: [0xf0e0a0, 0xe8d890, 0xd8e0a0],
    trees: ['tree-3', 'tree-6'],
  },
  {
    id: 'tianlan-grass',
    size: 120,
    seed: 20261121,
    start: [14, 14],
    portals: [
      { cell: [8, 8], label: '苍鹭部', toMap: 'cangl-tribe', to: [20, 33] },
      { cell: [108, 108], label: '突兀营地', toMap: 'tuwu-camp', to: [12, 12], requires: 'ch7-fengyue' },
    ],
    roads: [
      [[12, 12], [30, 24], [50, 40], [66, 60], [82, 78], [98, 96], [108, 108]],
      [[30, 24], [22, 56], [30, 90]],
      [[50, 40], [86, 26], [104, 38]],
    ],
    roadTile: GROUND.dirt,
    roadWidth: [0.9, 0.6],
    river: [[-3, 64], [22, 60], [46, 70], [62, 88], [74, 123]],
    ponds: [{ x: 88, y: 56, radius: 6 }],
    zones: [
      { monster: 'grass-beast', x: 34, y: 30, radius: 13, count: 13 },
      { monster: 'grass-beast', x: 86, y: 26, radius: 10, count: 7 },
      { monster: 'tuwu-rider', x: 28, y: 86, radius: 13, count: 12 },
      { monster: 'tuwu-rider', x: 70, y: 46, radius: 9, count: 6 },
      { monster: 'tuwu-archer', x: 96, y: 76, radius: 12, count: 12 },
      { monster: 'tuwu-archer', x: 58, y: 100, radius: 9, count: 6 },
    ],
    monsterGap: 6,
    clearings: [
      { x: 14, y: 14, radius: 8 },
      { x: 108, y: 108, radius: 4 },
    ],
    required: [[15, 12]],
    edge: { base: 3, spread: 6, outcrops: 0.82 },
    forest: { factor: 0.12 },
    foliage: [0xf0e0a0, 0xd8d08a, 0xe8c87a, 0xc8d890],
    trees: ['tree-3', 'tree-6', 'tree-3', 'bare-1'],
  },
  {
    id: 'tuwu-camp',
    size: 100,
    seed: 20261122,
    start: [12, 12],
    portals: [
      { cell: [8, 8], label: '天澜草原', toMap: 'tianlan-grass', to: [104, 104] },
      { cell: [90, 90], label: '圣兽降临之地', toMap: 'beast-altar', to: [12, 12], requires: 'ch7-hu' },
    ],
    roads: [
      [[12, 12], [26, 26], [40, 34], [52, 50], [66, 66], [80, 80], [90, 90]],
      [[26, 26], [22, 54], [30, 78]],
      [[52, 50], [76, 34]],
    ],
    roadTile: GROUND.dirt,
    roadWidth: [1, 0.6],
    ponds: [{ x: 50, y: 76, radius: 5 }],
    zones: [
      { monster: 'tuwu-shaman', x: 32, y: 36, radius: 12, count: 12 },
      { monster: 'totem-golem', x: 28, y: 72, radius: 11, count: 12 },
      { monster: 'tuwu-acolyte', x: 74, y: 42, radius: 11, count: 12 },
      { monster: 'tuwu-shaman', x: 74, y: 70, radius: 7, count: 5 },
      { monster: 'hu-xianshi', x: 62, y: 20, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 62, y: 20, radius: 8 },
      { x: 86, y: 88, radius: 6 },
    ],
    buildings: [
      { prop: 'bld-tent-grass', x: 56, y: 12 },
      { prop: 'bld-tent-grass', x: 66, y: 12 },
      { prop: 'bld-tent-grass', x: 40, y: 56 },
      { prop: 'bld-tent-grass', x: 84, y: 54 },
      { prop: 'obj-rack', x: 60, y: 26 },
    ],
    required: [[84, 88]],
    edge: { base: 3, spread: 5, outcrops: 0.78 },
    forest: { factor: 0.15 },
    foliage: [0xe8c87a, 0xd8b06a, 0xf0d890],
    trees: ['tree-3', 'bare-1', 'bare-2'],
  },
  {
    id: 'beast-altar',
    size: 70,
    seed: 20261123,
    start: [12, 12],
    portals: [{ cell: [8, 8], label: '突兀营地', toMap: 'tuwu-camp', to: [86, 86] }],
    roads: [
      [[12, 12], [24, 24], [36, 34], [48, 46], [54, 54]],
      [[24, 24], [50, 18]],
      [[36, 34], [20, 52]],
    ],
    roadTile: GROUND.paved,
    roadWidth: [1.3, 0.3],
    zones: [
      { monster: 'tuwu-acolyte', x: 44, y: 22, radius: 10, count: 9 },
      { monster: 'totem-golem', x: 24, y: 46, radius: 10, count: 9 },
      { monster: 'tianlan-beast', x: 54, y: 54, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 54, y: 54, radius: 9 },
    ],
    paved: [{ x0: 46, y0: 46, x1: 62, y1: 62 }],
    buildings: [
      { prop: 'obj-lantern-stone', x: 46, y: 46 },
      { prop: 'obj-lantern-stone', x: 62, y: 46 },
      { prop: 'obj-lantern-stone', x: 46, y: 60 },
      { prop: 'obj-lantern-stone', x: 62, y: 60 },
    ],
    edge: { base: 3, spread: 4, outcrops: 0.72 },
    forest: { factor: 0.1 },
    foliage: [0xfff0c8, 0xf0e0a0, 0xffffff],
    trees: ['tree-3', 'bare-1'],
  },
  {
    id: 'tianxing-city',
    size: 40,
    seed: 20261114,
    start: [20, 24],
    portals: [
      { cell: [20, 36], label: '外星海', toMap: 'outer-sea', to: [12, 12], requires: 'ch5-arrive' },
      { cell: [35, 20], label: '虚天殿', toMap: 'xutian-mist', to: [12, 12], requires: 'ch5-map' },
    ],
    roads: [
      [[20, 37], [20, 12]],
      [[20, 20], [37, 20]],
    ],
    roadTile: GROUND.paved,
    roadWidth: [1.6, 0],
    ponds: [{ x: 4, y: 34, radius: 2 }],
    clearings: [{ x: 20, y: 36, radius: 3 }, { x: 35, y: 20, radius: 3 }],
    paved: [{ x0: 12, y0: 12, x1: 28, y1: 27 }],
    buildings: [
      { prop: 'bld-hall-tianxing', x: 16, y: 5 },
      { prop: 'bld-tower-plain', x: 28, y: 5 },
      { prop: 'bld-house-plain', x: 6, y: 6 },
      { prop: 'bld-house-plain', x: 7, y: 13, flip: true },
      { prop: 'bld-house-plain', x: 7, y: 22, flip: true },
      { prop: 'bld-house-plain', x: 30, y: 13 },
      { prop: 'bld-house-plain', x: 30, y: 24 },
      { prop: 'bld-gate-tianxing', x: 17, y: 30 },
      ...wallRow('bld-wall-plain', 30, 3, 16),
      ...wallRow('bld-wall-plain', 30, 24, 37),
      { prop: 'obj-stall', x: 23, y: 14 },
      { prop: 'obj-stall', x: 14, y: 14 },
      { prop: 'obj-stall', x: 25, y: 24 },
      ...lanterns([12, 12], [28, 12], [17, 28], [23, 28], [17, 33], [23, 33]),
    ],
    required: [[20, 16], [27, 20], [13, 20], [24, 26]],
    edge: { base: 2, spread: 2.5, outcrops: 0 },
    forest: { factor: 1, least: 0.05 },
    foliage: [0xffffff, 0xd8f0e0, 0xc8e8f0],
  },
  {
    id: 'qixuan-gate',
    size: 40,
    seed: 20261102,
    start: [20, 22],
    portals: [{ cell: [20, 36], label: '彩霞山', toMap: 'starter-field', to: [12, 12] }],
    roads: [[[20, 37], [20, 14]]],
    roadTile: GROUND.paved,
    roadWidth: [1.6, 0],
    ponds: [{ x: 8, y: 34, radius: 3 }],
    clearings: [{ x: 20, y: 36, radius: 3 }],
    paved: [
      { x0: 13, y0: 13, x1: 27, y1: 24 },
      { x0: 26, y0: 25, x1: 34, y1: 28 },
    ],
    buildings: [
      { prop: 'bld-hall-plain', x: 16, y: 6 },
      { prop: 'bld-tower-plain', x: 28, y: 6 },
      { prop: 'bld-house-plain', x: 6, y: 7 },
      { prop: 'bld-house-plain', x: 7, y: 15, flip: true },
      { prop: 'bld-house-plain', x: 7, y: 22, flip: true },
      { prop: 'bld-house-plain', x: 29, y: 13 },
      { prop: 'bld-house-plain', x: 29, y: 19 },
      { prop: 'bld-gate-plain', x: 17, y: 29 },
      ...wallRow('bld-wall-plain', 29, 3, 16),
      ...wallRow('bld-wall-plain', 29, 24, 37),
      { prop: 'bld-pavilion-plain', x: 14, y: 33 },
      { prop: 'obj-rack', x: 28, y: 25 },
      { prop: 'obj-rack', x: 32, y: 27 },
      { prop: 'obj-stall', x: 15, y: 20 },
      ...lanterns([15, 13], [25, 13], [17, 25], [23, 25], [17, 32], [23, 32]),
    ],
    required: [[10, 12], [20, 16], [30, 26]],
    edge: { base: 2, spread: 2.5, outcrops: 0 },
    forest: { factor: 1, least: 0.05 },
    foliage: [0xffffff, 0xffffff, 0xdff0b0, 0xffd27a, 0xffa86a],
  },
  {
    id: 'huangfeng-valley',
    size: 40,
    seed: 20261103,
    start: [20, 24],
    portals: [{ cell: [20, 36], label: '彩霞山', toMap: 'starter-field', to: [12, 12] }],
    roads: [[[20, 37], [20, 13]]],
    roadTile: GROUND.paved,
    roadWidth: [1.6, 0],
    river: [[42, 25], [30, 27], [20, 26], [10, 28], [-2, 26]],
    clearings: [{ x: 20, y: 36, radius: 3 }],
    paved: [
      { x0: 13, y0: 12, x1: 27, y1: 23 },
      { x0: 9, y0: 21, x1: 15, y1: 24 },
    ],
    buildings: [
      { prop: 'bld-hall-sect', x: 16, y: 5 },
      { prop: 'bld-tower-sect', x: 7, y: 11 },
      { prop: 'bld-house-sect', x: 28, y: 12 },
      { prop: 'bld-house-sect', x: 29, y: 5 },
      { prop: 'bld-house-sect', x: 5, y: 5 },
      { prop: 'bld-gate-sect', x: 17, y: 31 },
      ...wallRow('bld-wall-sect', 31, 3, 16),
      ...wallRow('bld-wall-sect', 31, 24, 37),
      { prop: 'bld-pavilion-sect', x: 31, y: 21 },
      { prop: 'obj-cauldron', x: 25, y: 18 },
      { prop: 'obj-stall', x: 28, y: 17 },
      ...lanterns([15, 12], [25, 12], [17, 23], [23, 23], [17, 29], [23, 29], [17, 34], [23, 34]),
    ],
    required: [[20, 15], [30, 19], [10, 18], [13, 23]],
    edge: { base: 2, spread: 2.5, outcrops: 0 },
    forest: { factor: 2, least: 0.14 },
    foliage: [0xffffff, 0xfff0d0, 0xffe0b0],
    trees: MAPLES,
  },
  // ---- 第 8 章：大晋 ----
  {
    id: 'jinxi-market',
    size: 40,
    seed: 20261124,
    start: [20, 24],
    portals: [{ cell: [20, 36], label: '方尖山', toMap: 'fangjian-mountain', to: [14, 14] }],
    roads: [
      [[20, 37], [20, 10]],
      [[20, 20], [3, 20]],
    ],
    roadTile: GROUND.paved,
    roadWidth: [1.6, 0],
    ponds: [{ x: 35, y: 34, radius: 2 }],
    clearings: [{ x: 20, y: 36, radius: 3 }],
    paved: [{ x0: 11, y0: 11, x1: 29, y1: 28 }],
    buildings: [
      { prop: 'bld-hall-yan', x: 16, y: 3 },
      { prop: 'bld-tower-plain', x: 5, y: 3 },
      { prop: 'bld-house-plain', x: 29, y: 4 },
      { prop: 'bld-house-plain', x: 5, y: 11, flip: true },
      { prop: 'bld-house-plain', x: 31, y: 13 },
      { prop: 'bld-house-plain', x: 31, y: 22 },
      { prop: 'bld-pavilion-plain', x: 6, y: 25 },
      { prop: 'bld-gate-yan', x: 17, y: 31 },
      ...wallRow('bld-wall-plain', 31, 3, 16),
      ...wallRow('bld-wall-plain', 31, 24, 37),
      { prop: 'obj-stall', x: 13, y: 14 },
      { prop: 'obj-stall', x: 25, y: 23 },
      { prop: 'obj-stall', x: 13, y: 23 },
      { prop: 'obj-rack', x: 26, y: 12 },
      { prop: 'obj-cauldron', x: 21, y: 27 },
      ...lanterns([11, 11], [29, 11], [17, 29], [23, 29], [17, 34], [23, 34]),
    ],
    required: [[20, 16], [27, 20], [13, 20], [24, 26], [16, 26], [24, 14]],
    edge: { base: 2, spread: 2.5, outcrops: 0 },
    forest: { factor: 1, least: 0.05 },
    foliage: [0xffffff, 0xf0e8c8, 0xd8e8c0],
  },
  {
    id: 'fangjian-mountain',
    size: 120,
    seed: 20261125,
    start: [14, 14],
    portals: [{ cell: [8, 8], label: '晋西坊市', toMap: 'jinxi-market', to: [20, 33] }],
    roads: [
      [[12, 12], [28, 26], [44, 34], [60, 52], [76, 66], [90, 82], [102, 98]],
      [[28, 26], [24, 58], [34, 92]],
      [[60, 52], [92, 34]],
    ],
    roadTile: GROUND.dirt,
    roadWidth: [1, 0.6],
    river: [[123, 44], [96, 52], [72, 46], [50, 64], [44, 90], [56, 123]],
    zones: [
      { monster: 'rock-beast', x: 36, y: 32, radius: 15, count: 13 },
      { monster: 'rock-beast', x: 92, y: 30, radius: 9, count: 6 },
      { monster: 'mountain-ogre', x: 28, y: 80, radius: 15, count: 13 },
      { monster: 'jin-demon', x: 80, y: 68, radius: 15, count: 13 },
      { monster: 'jin-demon', x: 64, y: 100, radius: 8, count: 5 },
      { monster: 'yin-mo', x: 94, y: 84, radius: 0, count: 1 },
      { monster: 'fangjian-elder', x: 100, y: 100, radius: 0, count: 1 },
      { monster: 'fangjian-younger', x: 106, y: 96, radius: 0, count: 1 },
    ],
    monsterGap: 6,
    clearings: [
      { x: 14, y: 14, radius: 8 },
      { x: 94, y: 84, radius: 3 },
      { x: 102, y: 98, radius: 10 },
    ],
    required: [[15, 12]],
    edge: { base: 3, spread: 6, outcrops: 0.7 },
    forest: { factor: 0.45 },
    foliage: [0xd8e8b0, 0xc8d8a0, 0xe8e0b0, 0xb8d098],
    trees: ['tree-5', 'tree-7', 'tree-3', 'bare-2'],
  },
  {
    id: 'fengjia-cave',
    size: 100,
    seed: 20261126,
    start: [12, 12],
    portals: [{ cell: [8, 8], label: '晋西坊市', toMap: 'jinxi-market', to: [20, 33] }],
    roads: [
      [[12, 12], [26, 24], [40, 30], [56, 44], [68, 62], [78, 80]],
      [[26, 24], [20, 52], [28, 78]],
      [[56, 44], [82, 30]],
    ],
    roadTile: GROUND.stone,
    roadWidth: [1.2, 0.6],
    ponds: [{ x: 50, y: 70, radius: 5 }],
    zones: [
      { monster: 'ward-puppet', x: 36, y: 24, radius: 14, count: 13 },
      { monster: 'feng-ghost', x: 78, y: 32, radius: 14, count: 13 },
      { monster: 'cave-lizard', x: 24, y: 66, radius: 14, count: 13 },
      { monster: 'feng-ghost', x: 74, y: 80, radius: 8, count: 5 },
    ],
    monsterGap: 5,
    clearings: [{ x: 12, y: 12, radius: 7 }],
    paved: [{ x0: 70, y0: 74, x1: 84, y1: 88 }],
    buildings: [
      { prop: 'bld-gate-stone', x: 9, y: 2 },
      ...lanterns([70, 74], [84, 74], [70, 88], [84, 88]),
    ],
    required: [[15, 12]],
    edge: { base: 3, spread: 6, outcrops: 0.62 },
    forest: { factor: 0.25 },
    foliage: [0x8a9ab8, 0x7a8aa8, 0x9aa8c0],
    trees: ['bare-1', 'bare-2', 'tree-5'],
  },
  {
    id: 'kuzhu-island',
    size: 70,
    seed: 20261127,
    start: [12, 12],
    portals: [{ cell: [8, 8], label: '晋西坊市', toMap: 'jinxi-market', to: [20, 33] }],
    roads: [
      [[12, 12], [24, 24], [36, 34], [48, 46], [54, 54]],
      [[24, 24], [50, 18]],
      [[36, 34], [20, 52]],
    ],
    roadTile: GROUND.sand,
    roadWidth: [1.1, 0.4],
    ponds: [
      { x: 64, y: 8, radius: 9 },
      { x: 6, y: 64, radius: 9 },
      { x: 36, y: 62, radius: 5 },
    ],
    zones: [
      { monster: 'ward-puppet', x: 44, y: 22, radius: 10, count: 9 },
      { monster: 'cave-lizard', x: 22, y: 46, radius: 10, count: 9 },
      { monster: 'kuzhu-elder', x: 54, y: 54, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 54, y: 54, radius: 9 },
    ],
    paved: [{ x0: 47, y0: 47, x1: 61, y1: 61 }],
    buildings: [
      { prop: 'bld-pavilion-plain', x: 58, y: 48 },
      { prop: 'obj-lantern-stone', x: 47, y: 47 },
      { prop: 'obj-lantern-stone', x: 47, y: 61 },
      { prop: 'obj-lantern-stone', x: 61, y: 61 },
    ],
    edge: { base: 3, spread: 4, outcrops: 0.8 },
    forest: { factor: 1.2, least: 0.08 },
    foliage: [0xb4e87a, 0x9ad86a, 0xc8f08a],
    trees: ['tree-6', 'tree-3', 'tree-6', 'tree-7'],
  },
  // ---- 第 9 章：昆吾山 ----
  {
    id: 'nanjiang-market',
    size: 40,
    seed: 20261128,
    start: [20, 24],
    portals: [{ cell: [20, 36], label: '万毒谷', toMap: 'yinyang-cave', to: [14, 14] }],
    roads: [[[20, 37], [20, 12]]],
    roadTile: GROUND.dirt,
    roadWidth: [1.5, 0],
    ponds: [{ x: 35, y: 35, radius: 2 }],
    clearings: [{ x: 20, y: 36, radius: 3 }],
    paved: [{ x0: 12, y0: 13, x1: 28, y1: 28 }],
    buildings: [
      { prop: 'bld-hall-stone', x: 16, y: 4 },
      { prop: 'bld-house-plain', x: 5, y: 5 },
      { prop: 'bld-house-plain', x: 29, y: 5 },
      { prop: 'bld-house-plain', x: 5, y: 13, flip: true },
      { prop: 'bld-house-plain', x: 31, y: 14 },
      { prop: 'bld-pavilion-plain', x: 31, y: 23 },
      { prop: 'bld-gate-stone', x: 17, y: 31 },
      ...wallRow('bld-wall-stone', 31, 3, 16),
      ...wallRow('bld-wall-stone', 31, 24, 37),
      { prop: 'obj-stall', x: 13, y: 15 },
      { prop: 'obj-stall', x: 25, y: 23 },
      { prop: 'obj-rack', x: 23, y: 11 },
      { prop: 'obj-cauldron', x: 15, y: 24 },
      ...lanterns([12, 13], [28, 13], [17, 29], [23, 29], [17, 34], [23, 34]),
    ],
    required: [[20, 16], [27, 20], [13, 20], [24, 26]],
    edge: { base: 2, spread: 2.5, outcrops: 0 },
    forest: { factor: 1.4, least: 0.08 },
    foliage: [0xa8d07a, 0x8ac06a, 0xc8d88a],
    trees: ['tree-6', 'tree-7', 'tree-6'],
  },
  {
    id: 'yinyang-cave',
    size: 120,
    seed: 20261129,
    start: [14, 14],
    portals: [{ cell: [8, 8], label: '南疆坊市', toMap: 'nanjiang-market', to: [20, 33] }],
    roads: [
      [[12, 12], [30, 26], [48, 36], [64, 54], [80, 70], [96, 86], [104, 100]],
      [[30, 26], [24, 60], [34, 94]],
      [[64, 54], [96, 34]],
    ],
    roadTile: GROUND.stone,
    roadWidth: [1.1, 0.6],
    ponds: [
      { x: 56, y: 76, radius: 8 },
      { x: 84, y: 20, radius: 6 },
      { x: 14, y: 80, radius: 6 },
      { x: 70, y: 104, radius: 7 },
    ],
    zones: [
      { monster: 'venom-scorpion', x: 36, y: 34, radius: 15, count: 13 },
      { monster: 'venom-scorpion', x: 96, y: 40, radius: 10, count: 6 },
      { monster: 'yin-wraith', x: 28, y: 84, radius: 15, count: 13 },
      { monster: 'yin-wraith', x: 82, y: 66, radius: 12, count: 9 },
      { monster: 'yinzhi-horse', x: 60, y: 50, radius: 14, count: 4 },
      { monster: 'silverwing-yaksha', x: 102, y: 100, radius: 0, count: 1 },
    ],
    monsterGap: 6,
    clearings: [
      { x: 14, y: 14, radius: 8 },
      { x: 102, y: 100, radius: 10 },
    ],
    required: [[15, 12]],
    edge: { base: 3, spread: 6, outcrops: 0.66 },
    forest: { factor: 0.4 },
    foliage: [0x7a6a9a, 0x6a8a6a, 0x8a7aaa, 0x5a7a5a],
    trees: ['bare-1', 'bare-2', 'tree-5', 'tree-7'],
  },
  {
    id: 'kunwu-mountain',
    size: 100,
    seed: 20261130,
    start: [12, 12],
    portals: [
      { cell: [8, 8], label: '南疆坊市', toMap: 'nanjiang-market', to: [20, 33] },
      { cell: [90, 90], label: '镇魔塔', toMap: 'zhenmo-tower', to: [12, 12], requires: 'ch9-qian' },
    ],
    roads: [
      [[12, 12], [26, 26], [40, 34], [52, 50], [66, 66], [80, 80], [90, 90]],
      [[26, 26], [22, 54], [30, 78]],
      [[52, 50], [78, 32]],
    ],
    roadTile: GROUND.paved,
    roadWidth: [1.2, 0.4],
    zones: [
      { monster: 'kunwu-golem', x: 34, y: 30, radius: 14, count: 13 },
      { monster: 'kunwu-demon', x: 26, y: 70, radius: 14, count: 13 },
      { monster: 'kunwu-golem', x: 78, y: 54, radius: 9, count: 6 },
      { monster: 'qian-laomo', x: 72, y: 20, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 72, y: 20, radius: 9 },
      { x: 86, y: 88, radius: 6 },
    ],
    paved: [{ x0: 64, y0: 12, x1: 80, y1: 28 }],
    buildings: [
      { prop: 'bld-hall-stone', x: 68, y: 3 },
      ...lanterns([64, 12], [80, 12], [64, 28], [80, 28]),
      { prop: 'obj-lantern-stone', x: 84, y: 84 },
      { prop: 'obj-lantern-stone', x: 92, y: 84 },
    ],
    required: [[15, 12], [84, 88]],
    edge: { base: 3, spread: 5, outcrops: 0.62 },
    forest: { factor: 0.35 },
    foliage: [0xd8d0b0, 0xc8c8a0, 0xe0d8c0],
    trees: ['tree-5', 'tree-7', 'bare-2'],
  },
  {
    id: 'zhenmo-tower',
    size: 70,
    seed: 20261131,
    start: [12, 12],
    portals: [
      { cell: [8, 8], label: '昆吾山', toMap: 'kunwu-mountain', to: [86, 86] },
      { cell: [58, 58], label: '二层', toMap: 'zhenmo-tower-2', to: [12, 12], requires: 'ch9-shades' },
    ],
    roads: [
      [[12, 12], [24, 24], [36, 34], [48, 46], [58, 58]],
      [[24, 24], [50, 18]],
      [[36, 34], [20, 52]],
    ],
    roadTile: GROUND.paved,
    roadWidth: [1.4, 0.3],
    zones: [
      { monster: 'tower-shade', x: 44, y: 22, radius: 11, count: 10 },
      { monster: 'tower-shade', x: 22, y: 46, radius: 11, count: 8 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 56, y: 56, radius: 6 },
    ],
    paved: [
      { x0: 50, y0: 50, x1: 64, y1: 64 },
      { x0: 6, y0: 6, x1: 18, y1: 18 },
    ],
    buildings: [
      { prop: 'obj-lantern-stone', x: 50, y: 50 },
      { prop: 'obj-lantern-stone', x: 64, y: 50 },
      { prop: 'obj-lantern-stone', x: 50, y: 64 },
    ],
    required: [[15, 12]],
    edge: { base: 3, spread: 4, outcrops: 0.7 },
    forest: { factor: 0.15 },
    foliage: [0x8a3a4a, 0x6a2a3a, 0xa84a5a],
    trees: ['bare-1', 'bare-2'],
  },
  {
    id: 'zhenmo-tower-2',
    size: 60,
    seed: 20261132,
    start: [12, 12],
    portals: [
      { cell: [8, 8], label: '一层', toMap: 'zhenmo-tower', to: [55, 55] },
      { cell: [50, 50], label: '三层', toMap: 'zhenmo-tower-3', to: [12, 12], requires: 'ch9-skeletons' },
    ],
    roads: [
      [[12, 12], [22, 24], [32, 30], [42, 42], [50, 50]],
      [[22, 24], [42, 16]],
      [[32, 30], [16, 44]],
    ],
    roadTile: GROUND.paved,
    roadWidth: [1.4, 0.3],
    zones: [
      { monster: 'tower-skeleton', x: 38, y: 20, radius: 10, count: 10 },
      { monster: 'tower-skeleton', x: 20, y: 40, radius: 10, count: 8 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 6 },
      { x: 48, y: 48, radius: 6 },
    ],
    paved: [
      { x0: 42, y0: 42, x1: 55, y1: 55 },
      { x0: 6, y0: 6, x1: 17, y1: 17 },
    ],
    buildings: [
      { prop: 'obj-lantern-stone', x: 42, y: 42 },
      { prop: 'obj-lantern-stone', x: 55, y: 42 },
      { prop: 'obj-lantern-stone', x: 42, y: 55 },
    ],
    required: [[13, 10]],
    edge: { base: 3, spread: 4, outcrops: 0.7 },
    forest: { factor: 0.12 },
    foliage: [0x7a2a4a, 0x5a1a3a, 0x9a3a5a],
    trees: ['bare-1', 'bare-2'],
  },
  {
    id: 'zhenmo-tower-3',
    size: 60,
    seed: 20261133,
    start: [12, 12],
    portals: [
      { cell: [8, 8], label: '二层', toMap: 'zhenmo-tower-2', to: [47, 47] },
      { cell: [52, 52], label: '第九层', toMap: 'zhenmo-tower-9', to: [12, 12], requires: 'ch9-xueyan' },
    ],
    roads: [
      [[12, 12], [22, 22], [32, 32], [42, 42], [52, 52]],
      [[22, 22], [40, 14]],
      [[22, 22], [14, 40]],
    ],
    roadTile: GROUND.paved,
    roadWidth: [1.4, 0.3],
    zones: [
      { monster: 'tower-shade', x: 40, y: 16, radius: 8, count: 5 },
      { monster: 'tower-skeleton', x: 16, y: 40, radius: 8, count: 5 },
      { monster: 'xueyan', x: 42, y: 42, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 6 },
      { x: 42, y: 42, radius: 9 },
    ],
    paved: [
      { x0: 34, y0: 34, x1: 54, y1: 54 },
      { x0: 6, y0: 6, x1: 17, y1: 17 },
    ],
    buildings: [
      { prop: 'obj-lantern-stone', x: 34, y: 34 },
      { prop: 'obj-lantern-stone', x: 54, y: 34 },
      { prop: 'obj-lantern-stone', x: 34, y: 54 },
      { prop: 'obj-cauldron', x: 46, y: 46 },
    ],
    required: [[13, 10]],
    edge: { base: 3, spread: 4, outcrops: 0.72 },
    forest: { factor: 0.1 },
    foliage: [0x8a1a2a, 0x6a0a1a, 0xa82a3a],
    trees: ['bare-1', 'bare-2'],
  },
  {
    id: 'zhenmo-tower-9',
    size: 50,
    seed: 20261134,
    start: [12, 12],
    portals: [{ cell: [8, 8], label: '三层', toMap: 'zhenmo-tower-3', to: [49, 49] }],
    roads: [[[12, 12], [22, 22], [34, 34]]],
    roadTile: GROUND.paved,
    roadWidth: [1.6, 0.2],
    zones: [{ monster: 'yuansha-avatar', x: 34, y: 34, radius: 0, count: 1 }],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 6 },
      { x: 34, y: 34, radius: 10 },
    ],
    paved: [
      { x0: 24, y0: 24, x1: 44, y1: 44 },
      { x0: 6, y0: 6, x1: 17, y1: 17 },
    ],
    buildings: [
      { prop: 'obj-lantern-stone', x: 24, y: 24 },
      { prop: 'obj-lantern-stone', x: 44, y: 24 },
      { prop: 'obj-lantern-stone', x: 24, y: 44 },
      { prop: 'obj-lantern-stone', x: 44, y: 44 },
    ],
    required: [[13, 10]],
    edge: { base: 3, spread: 3, outcrops: 0.8 },
    forest: { factor: 0.05 },
    foliage: [0x4a0a3a, 0x3a0a2a, 0x6a1a4a],
    trees: ['bare-1', 'bare-2'],
  },
  // ---- 第 10 章：北夜小极宫（雪原配色见 maps.json 的 palette） ----
  {
    id: 'xiaoji-palace',
    size: 40,
    seed: 20261135,
    start: [20, 24],
    portals: [{ cell: [20, 36], label: '雪连山', toMap: 'xuelian-mountain', to: [14, 14] }],
    roads: [
      [[20, 37], [20, 10]],
      [[20, 20], [36, 20]],
    ],
    roadTile: GROUND.paved,
    roadWidth: [1.6, 0],
    ponds: [{ x: 5, y: 6, radius: 2 }],
    clearings: [{ x: 20, y: 36, radius: 3 }],
    paved: [{ x0: 11, y0: 12, x1: 29, y1: 28 }],
    buildings: [
      { prop: 'bld-hall-sect', x: 16, y: 3 },
      { prop: 'bld-tower-sect', x: 29, y: 3 },
      { prop: 'bld-house-sect', x: 4, y: 11, flip: true },
      { prop: 'bld-house-sect', x: 31, y: 12 },
      { prop: 'bld-pavilion-sect', x: 5, y: 23 },
      { prop: 'bld-gate-sect', x: 17, y: 31 },
      ...wallRow('bld-wall-sect', 31, 3, 16),
      ...wallRow('bld-wall-sect', 31, 24, 37),
      { prop: 'obj-stall', x: 13, y: 14 },
      { prop: 'obj-stall', x: 25, y: 23 },
      { prop: 'obj-cauldron', x: 15, y: 24 },
      ...lanterns([11, 12], [29, 12], [17, 29], [23, 29], [17, 34], [23, 34]),
    ],
    required: [[20, 16], [27, 20], [13, 20], [24, 26]],
    edge: { base: 2, spread: 2.5, outcrops: 0 },
    forest: { factor: 0.8, least: 0.04 },
    foliage: [0xffffff, 0xe8f4ff, 0xd8ecff],
    trees: ['bare-1', 'bare-2'],
    snow: true,
  },
  {
    id: 'xuelian-mountain',
    size: 120,
    seed: 20261136,
    start: [14, 14],
    portals: [{ cell: [8, 8], label: '北夜小极宫', toMap: 'xiaoji-palace', to: [20, 33] }],
    roads: [
      [[12, 12], [30, 26], [48, 36], [64, 54], [80, 70], [96, 86], [104, 100]],
      [[30, 26], [24, 60], [34, 94]],
      [[64, 54], [96, 34]],
    ],
    roadTile: GROUND.dirt,
    roadWidth: [1, 0.6],
    ponds: [
      { x: 70, y: 100, radius: 7 },
      { x: 100, y: 60, radius: 6 },
    ],
    zones: [
      { monster: 'snow-fox', x: 38, y: 34, radius: 15, count: 13 },
      { monster: 'snow-fox', x: 96, y: 34, radius: 10, count: 6 },
      { monster: 'snow-ogre', x: 28, y: 84, radius: 15, count: 13 },
      { monster: 'xiaoji-traitor', x: 80, y: 74, radius: 15, count: 13 },
      { monster: 'xiaoji-traitor', x: 56, y: 104, radius: 8, count: 5 },
    ],
    monsterGap: 6,
    clearings: [{ x: 14, y: 14, radius: 8 }],
    required: [[15, 12]],
    edge: { base: 3, spread: 6, outcrops: 0.66 },
    forest: { factor: 0.4 },
    foliage: [0xffffff, 0xe8f4ff, 0xd8ecff, 0xf0f8ff],
    trees: ['bare-1', 'bare-2'],
    snow: true,
  },
  {
    id: 'ice-sea',
    size: 100,
    seed: 20261137,
    start: [12, 12],
    portals: [{ cell: [8, 8], label: '北夜小极宫', toMap: 'xiaoji-palace', to: [20, 33] }],
    roads: [
      [[12, 12], [28, 28], [44, 36], [60, 52], [74, 70], [86, 86]],
      [[28, 28], [24, 60], [34, 84]],
      [[60, 52], [84, 30]],
    ],
    roadTile: GROUND.sand,
    roadWidth: [1.1, 0.7],
    ponds: [
      { x: 52, y: 22, radius: 8 },
      { x: 14, y: 44, radius: 8 },
      { x: 56, y: 76, radius: 9 },
      { x: 90, y: 56, radius: 7 },
    ],
    zones: [
      { monster: 'ice-shark', x: 30, y: 30, radius: 13, count: 13 },
      { monster: 'ice-toad', x: 30, y: 72, radius: 13, count: 13 },
      { monster: 'frost-spirit', x: 74, y: 36, radius: 13, count: 13 },
      { monster: 'ice-sea-chief', x: 86, y: 86, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 86, y: 86, radius: 9 },
    ],
    required: [[15, 12]],
    edge: { base: 3, spread: 5, outcrops: 0.78 },
    forest: { factor: 0.2 },
    foliage: [0xffffff, 0xd8ecff, 0xc8e4f8],
    trees: ['bare-1', 'bare-2'],
    snow: true,
  },
  {
    id: 'xuanyu-cave',
    size: 70,
    seed: 20261138,
    start: [12, 12],
    portals: [{ cell: [8, 8], label: '北夜小极宫', toMap: 'xiaoji-palace', to: [20, 33] }],
    roads: [
      [[12, 12], [24, 24], [36, 34], [48, 46], [54, 54]],
      [[24, 24], [48, 16]],
      [[36, 34], [18, 50]],
    ],
    roadTile: GROUND.paved,
    roadWidth: [1.3, 0.3],
    zones: [
      { monster: 'frost-spirit', x: 40, y: 22, radius: 9, count: 7 },
      { monster: 'xiaoji-traitor', x: 22, y: 42, radius: 9, count: 7 },
      { monster: 'bai-mengxin', x: 58, y: 22, radius: 0, count: 1 },
      { monster: 'ouyang-elder', x: 30, y: 56, radius: 0, count: 1 },
      { monster: 'hanli-boss', x: 54, y: 54, radius: 0, count: 1 },
    ],
    monsterGap: 5,
    clearings: [
      { x: 12, y: 12, radius: 7 },
      { x: 58, y: 22, radius: 3 },
      { x: 30, y: 56, radius: 3 },
      { x: 54, y: 54, radius: 9 },
    ],
    paved: [{ x0: 46, y0: 46, x1: 62, y1: 62 }],
    buildings: [
      { prop: 'obj-lantern-stone', x: 46, y: 46 },
      { prop: 'obj-lantern-stone', x: 62, y: 46 },
      { prop: 'obj-lantern-stone', x: 46, y: 62 },
      { prop: 'obj-cauldron', x: 58, y: 58 },
    ],
    required: [[13, 10]],
    edge: { base: 3, spread: 4, outcrops: 0.7 },
    forest: { factor: 0.1 },
    foliage: [0xd8ecff, 0xc8e4f8, 0xffffff],
    trees: ['bare-1', 'bare-2'],
    snow: true,
  },

];

interface Decor {
  prop: string;
  x: number;
  y: number;
  scale: number;
  flip: boolean;
  tint: number;
  foot?: Rect;
}

/** 已经配好的 NPC 位置，切崖线时让开，免得人站在崖外。 */
const NPC_CELLS: { map: string; x: number; y: number }[] = (() => {
  try {
    const data = JSON.parse(readFileSync(new URL('../public/data/npcs.json', import.meta.url), 'utf8')) as Record<
      string,
      { map?: string; x?: number; y?: number }
    >;
    return Object.values(data)
      .filter((npc) => typeof npc.map === 'string' && Number.isFinite(npc.x) && Number.isFinite(npc.y))
      .map((npc) => ({ map: npc.map!, x: npc.x!, y: npc.y! }));
  } catch {
    return [];
  }
})();

function generate(plan: MapPlan): void {
  const { size: SIZE } = plan;
  const OUTPUT = `public/maps/${plan.id}.tmj`;
  const rng = new Rng(plan.seed);

  const lattice = Array.from({ length: 64 * 64 }, () => rng.next());
  const valueNoise = (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => lattice[((j & 63) << 6) + (i & 63)]!;
    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bottom * sy;
  };
  const noise = (x: number, y: number, scale: number) =>
    valueNoise(x / scale, y / scale) * 0.65 + valueNoise((x / scale) * 2 + 9, (y / scale) * 2 + 9) * 0.35;

  const index = (x: number, y: number) => y * SIZE + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

  const ground = new Array<number>(SIZE * SIZE).fill(0);
  const blocked = new Array<boolean>(SIZE * SIZE).fill(false);
  /** 建筑和铺石范围，不长树也不长山 */
  const built = new Set<number>();
  /** 离路多远，用来给路边留空 */
  const roadDistance = new Array<number>(SIZE * SIZE).fill(Infinity);

  const stamp = (path: Point[], radius: (x: number, y: number) => number, visit: (x: number, y: number) => void) => {
    for (const [px, py] of path) {
      const reach = Math.ceil(radius(px, py));
      for (let y = Math.floor(py) - reach; y <= Math.ceil(py) + reach; y++) {
        for (let x = Math.floor(px) - reach; x <= Math.ceil(px) + reach; x++) {
          if (inside(x, y) && Math.hypot(x - px, y - py) <= radius(px, py)) visit(x, y);
        }
      }
    }
  };

  // 底层草地
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const value = noise(x, y, 7);
      ground[index(x, y)] = value < 0.42 ? GROUND.grassB : value > 0.58 ? GROUND.grassC : GROUND.grassA;
    }
  }

  // 河岸和水面
  const river = plan.river ? smooth(plan.river) : [];
  const water = new Set<number>();
  stamp(river, (x, y) => 2.4 + noise(x, y, 6) * 2, (x, y) => (ground[index(x, y)] = GROUND.sand));
  stamp(river, (x, y) => 0.9 + noise(x, y, 6) * 1.7, (x, y) => water.add(index(x, y)));
  for (const pond of plan.ponds ?? []) {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const distance = Math.hypot(x - pond.x, y - pond.y) + (noise(x, y, 5) - 0.5) * 5;
        if (distance < pond.radius + 1.8) ground[index(x, y)] = GROUND.sand;
        if (distance < pond.radius) water.add(index(x, y));
      }
    }
  }
  for (const cell of water) {
    ground[cell] = GROUND.water;
    blocked[cell] = true;
  }

  // 铺石地面和道路，过河的地方是桥
  for (const area of plan.paved ?? []) {
    for (let y = area.y0; y <= area.y1; y++) {
      for (let x = area.x0; x <= area.x1; x++) {
        const cell = index(x, y);
        if (ground[cell] === GROUND.water) continue;
        ground[cell] = GROUND.paved;
        built.add(cell);
      }
    }
  }
  const [roadBase, roadSpread] = plan.roadWidth;
  for (const road of plan.roads) {
    const path = smooth(road);
    stamp(
      path,
      (x, y) => roadBase + noise(x, y, 4) * roadSpread,
      (x, y) => {
        const cell = index(x, y);
        if (ground[cell] === GROUND.water || ground[cell] === GROUND.bridge) {
          ground[cell] = GROUND.bridge;
          blocked[cell] = false;
        } else {
          ground[cell] = plan.roadTile;
        }
      },
    );
    stamp(path, () => 4, (x, y) => {
      const cell = index(x, y);
      const nearest = Math.min(...path.map(([px, py]) => Math.hypot(px - x, py - y)).filter((_, i) => i % 6 === 0));
      roadDistance[cell] = Math.min(roadDistance[cell]!, nearest);
    });
  }

  // 建筑
  const decor: Decor[] = [];
  for (const building of plan.buildings ?? []) {
    const [length, width] = footprintOf(building.prop);
    const w = building.flip ? width : length;
    const d = building.flip ? length : width;
    const { x, y } = building;
    const gate = building.prop.startsWith('bld-gate');
    for (let cy = y; cy < y + d; cy++) {
      for (let cx = x; cx < x + w; cx++) {
        const cell = index(cx, cy);
        if (!inside(cx, cy) || blocked[cell]) throw new Error(`${plan.id} 的 ${building.prop} 压到了 ${cx},${cy}`);
        built.add(cell);
        // 牌楼中间三格可以穿过
        if (gate && cx >= x + 2 && cx <= x + w - 3) continue;
        blocked[cell] = true;
        if (!gate && ground[cell] !== GROUND.water) ground[cell] = GROUND.paved;
      }
    }
    for (let cy = y - 1; cy <= y + d; cy++) {
      for (let cx = x - 1; cx <= x + w; cx++) {
        if (inside(cx, cy)) built.add(index(cx, cy));
      }
    }
    const solid = SOLID.some((prefix) => building.prop.startsWith(prefix));
    decor.push({
      prop: building.prop,
      x: x + (w - 1) / 2,
      y: y + (d - 1) / 2,
      scale: 1,
      flip: !!building.flip,
      tint: 0xffffff,
      foot: solid ? { x0: x, y0: y, x1: x + w - 1, y1: y + d - 1 } : undefined,
    });
  }

  const edgeDistance = (x: number, y: number) => Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
  const mountainDepth = (x: number, y: number) => plan.edge.base + noise(x, y, 9) * plan.edge.spread;
  const inClearing = (x: number, y: number) =>
    plan.clearings.some((clearing) => Math.hypot(x - clearing.x, y - clearing.y) < clearing.radius);
  const open = (x: number, y: number) =>
    !inClearing(x, y) &&
    roadDistance[index(x, y)]! > 2.5 &&
    ground[index(x, y)] !== GROUND.water &&
    !built.has(index(x, y));

  // 边缘的山体和内部的石坡
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const cell = index(x, y);
      if (ground[cell] === GROUND.water || ground[cell] === GROUND.bridge) continue;
      const onEdge = edgeDistance(x, y) < mountainDepth(x, y);
      const outcrop = plan.edge.outcrops > 0 && noise(x + 31, y + 17, 6) > plan.edge.outcrops && edgeDistance(x, y) > 8;
      if ((onEdge || outcrop) && open(x, y)) {
        ground[cell] = GROUND.stone;
        blocked[cell] = true;
      }
    }
  }

  /** 建筑周围留两格地面，免得墙脚悬在崖外 */
  const nearBuilt = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (inside(x + dx, y + dy) && built.has(index(x + dx, y + dy))) return true;
      }
    }
    return false;
  };

  // 崖线：按噪声削掉最外圈，地图轮廓从规整的菱形变成带着海湾和岬角的山崖。
  // 先只记掩码，等树石和怪位排完再落地，这样已有的随机序列完全不受影响。
  const rimScale = plan.rim ?? (SIZE <= 40 ? 0 : 1);
  const voidMask = new Uint8Array(SIZE * SIZE);
  if (rimScale > 0) {
    // 传送点、任务点、怪区、空地、道路、建筑和 NPC 所在的位置不切，免得把内容切掉
    const reserved = new Uint8Array(SIZE * SIZE);
    const reserve = (cx: number, cy: number, r: number) => {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (inside(cx + dx, cy + dy)) reserved[index(cx + dx, cy + dy)] = 1;
        }
      }
    };
    for (const [x, y] of [plan.start, ...(plan.required ?? []), ...plan.portals.map((portal) => portal.cell)]) reserve(x, y, 3);
    for (const zone of plan.zones ?? []) reserve(zone.x, zone.y, zone.radius + 2);
    for (const clearing of plan.clearings) reserve(clearing.x, clearing.y, clearing.radius + 1);
    for (const cell of built) reserved[cell] = 1;
    for (let i = 0; i < SIZE * SIZE; i++) if (roadDistance[i]! <= 3) reserved[i] = 1;
    for (const npc of NPC_CELLS) if (npc.map === plan.id) reserve(npc.x, npc.y, 3);

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const cell = index(x, y);
        if (reserved[cell] || nearBuilt(x, y)) continue;
        if (ground[cell] === GROUND.bridge) continue;
        const wave = noise(x + 17, y + 29, 9) * 0.55 + noise(x + 61, y + 7, 23) * 0.45;
        const depth = 0.6 + wave * 13 * rimScale;
        if (edgeDistance(x, y) >= depth) continue;
        // 深湾只削石头和草，路面和水面保持原样，免得路断在水里
        if (ground[cell] === GROUND.dirt || ground[cell] === GROUND.paved) continue;
        voidMask[cell] = 1;
      }
    }
  }

  // 崖外没有地面，也走不过去。这里先只算掩码，等树石排完再并进障碍层，
  // 免得打乱随机序列把已有地图的树和怪位全挪一遍。

  /** 靠近崖口的石头，用来沿崖线摆山，把切边藏进山影里 */
  const nearRim = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (inside(x + dx, y + dy) && voidMask[index(x + dx, y + dy)]) return true;
      }
    }
    return false;
  };

  // 树石
  const pick = (options: string[]) => options[rng.int(0, options.length - 1)]!;
  const pickTint = (options: number[]) => options[rng.int(0, options.length - 1)]!;
  const ROCK_TINT = [0xffffff, 0xe8dccb, 0xd8c8b4];
  const add = (prop: string, x: number, y: number, scale: number, tint = 0xffffff) =>
    decor.push({
      prop,
      x: Number((x + 0.5).toFixed(2)),
      y: Number((y + 0.5).toFixed(2)),
      scale: Number(scale.toFixed(2)),
      flip: rng.chance(0.5),
      tint,
    });

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (ground[index(x, y)] !== GROUND.stone || built.has(index(x, y))) continue;
      const deep = edgeDistance(x, y) < 3;
      if (((x % 2 === 0 && y % 2 === 0) || deep) && rng.chance(deep ? 0.32 : 0.6)) {
        add(pick(['peak-1', 'peak-2', 'peak-3', 'peak-4', 'peak-5']), x, y, 0.55 + rng.next() * 0.4, pickTint(ROCK_TINT));
      }
    }
  }

  const canPlant = (x: number, y: number) => {
    const cell = index(x, y);
    return (
      inside(x, y) &&
      !blocked[cell] &&
      open(x, y) &&
      ground[cell] !== GROUND.dirt &&
      ground[cell] !== GROUND.bridge &&
      ground[cell] !== GROUND.sand &&
      ground[cell] !== GROUND.paved
    );
  };

  const { factor, least = 0.01, denseArea } = plan.forest;
  for (let y = 2; y < SIZE - 2; y++) {
    for (let x = 2; x < SIZE - 2; x++) {
      if (!canPlant(x, y)) continue;
      const forest = noise(x + 11, y + 5, 11);
      const dense = !!denseArea && Math.hypot(x - denseArea.x, y - denseArea.y) < denseArea.radius;
      const density = Math.max(least, (forest - 0.42) * (dense ? 1.1 : factor));
      const roll = rng.next();
      if (roll < density) {
        const bare = dense && rng.chance(0.25);
        add(
          bare ? pick(['bare-1', 'bare-2']) : plan.trees ? pick(plan.trees) : `tree-${rng.int(1, 8)}`,
          x,
          y,
          0.6 + rng.next() * 0.3,
          bare ? 0xffffff : pickTint(plan.foliage),
        );
        blocked[index(x, y)] = true;
      } else if (roll < density + 0.015) {
        add(pick(['rock-1', 'rock-2', 'rock-3', 'rock-4']), x, y, 0.8 + rng.next() * 0.9, pickTint(ROCK_TINT));
        blocked[index(x, y)] = true;
      } else if (roll < density + 0.05) {
        const bush = `bush-${rng.int(1, 4)}`;
        const scale = 0.8 + rng.next() * 0.6;
        const tint = pickTint(plan.foliage);
        if (!plan.snow) add(bush, x, y, scale, tint);
      } else if (roll < density + 0.15) {
        const grass = `grass-${rng.int(1, 2)}`;
        const scale = 0.8 + rng.next() * 0.7;
        if (!plan.snow) add(grass, x, y, scale);
      }
    }
  }

  // 落地崖线：崖外既没有地面也走不过去。清掉落在崖外的树石，再沿崖口补一圈山。
  for (let i = 0; i < voidMask.length; i++) {
    if (!voidMask[i]) continue;
    ground[i] = GROUND.void;
    blocked[i] = true;
  }
  for (let i = decor.length - 1; i >= 0; i--) {
    const item = decor[i]!;
    const cx = Math.floor(item.x);
    const cy = Math.floor(item.y);
    if (inside(cx, cy) && voidMask[index(cx, cy)]) decor.splice(i, 1);
  }

  // 校验并放置怪物
  const reachable = new Set<number>([index(...plan.start)]);
  const queue: Point[] = [plan.start];
  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny) || blocked[index(nx, ny)] || reachable.has(index(nx, ny))) continue;
      reachable.add(index(nx, ny));
      queue.push([nx, ny]);
    }
  }

  const required = [plan.start, ...plan.portals.map((portal) => portal.cell), ...(plan.required ?? [])];
  for (const [x, y] of required) {
    if (!reachable.has(index(x, y))) throw new Error(`${plan.id} 走不到 ${x},${y}`);
  }

  const spawns: { monster: string; x: number; y: number }[] = [];
  const gap = plan.monsterGap ?? 0;
  for (const zone of plan.zones ?? []) {
    let placed = 0;
    for (let attempt = 0; attempt < 2000 && placed < zone.count; attempt++) {
      const angle = rng.next() * Math.PI * 2;
      const distance = Math.sqrt(rng.next()) * zone.radius;
      const x = Math.round(zone.x + Math.cos(angle) * distance);
      const y = Math.round(zone.y + Math.sin(angle) * distance);
      if (!inside(x, y) || !reachable.has(index(x, y))) continue;
      if (spawns.some((spawn) => Math.hypot(spawn.x - x, spawn.y - y) < gap)) continue;
      spawns.push({ monster: zone.monster, x, y });
      placed += 1;
    }
    if (placed < zone.count) throw new Error(`${zone.monster} 只放下了 ${placed} 只`);
  }

  // 崖口补山：沿崖线摆一圈山石，把切边藏进山影里。草地也摆，
  // 崖线切进草里时同样有一道石岸挡着。
  if (rimScale > 0) {
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const cell = index(x, y);
        const tile = ground[cell];
        if (tile === GROUND.void || tile === GROUND.water || tile === GROUND.bridge || built.has(cell)) continue;
        if (!nearRim(x, y)) continue;
        if (!rng.chance(0.82)) continue;
        add(pick(['peak-1', 'peak-2', 'peak-3', 'peak-4', 'peak-5']), x, y, 0.6 + rng.next() * 0.45, pickTint(ROCK_TINT));
      }
    }
  }

  // 输出 Tiled 文件
  let nextId = 1;
  const property = (name: string, value: string | number) => ({
    name,
    type: typeof value === 'number' ? 'int' : 'string',
    value,
  });
  const object = (type: string, cell: Point, properties: object[]) => ({
    id: nextId++,
    name: type,
    type,
    x: cell[0] * 32 + 16,
    y: cell[1] * 32 + 16,
    width: 0,
    height: 0,
    rotation: 0,
    visible: true,
    point: true,
    properties,
  });
  const layer = (id: number, name: string, data: number[]) => ({
    id,
    name,
    type: 'tilelayer',
    width: SIZE,
    height: SIZE,
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    data,
  });

  const map = {
    type: 'map',
    version: '1.10',
    tiledversion: '1.10.2',
    orientation: 'isometric',
    renderorder: 'right-down',
    infinite: false,
    width: SIZE,
    height: SIZE,
    tilewidth: 64,
    tileheight: 32,
    nextlayerid: 5,
    tilesets: [
      {
        firstgid: 1,
        name: 'terrain',
        image: 'terrain.png',
        imagewidth: 64 * TILE_COUNT,
        imageheight: 32,
        tilewidth: 64,
        tileheight: 32,
        tilecount: TILE_COUNT,
        columns: TILE_COUNT,
        margin: 0,
        spacing: 0,
      },
    ],
    layers: [
      layer(1, 'ground', ground),
      layer(2, 'blocked', blocked.map((value) => (value ? GROUND.stone : 0))),
      {
        id: 3,
        name: 'objects',
        type: 'objectgroup',
        objects: [
          object('start', plan.start, []),
          ...plan.portals.map((portal) =>
            object('portal', portal.cell, [
              property('label', portal.label),
              property('toMap', portal.toMap),
              property('toX', portal.to[0]),
              property('toY', portal.to[1]),
              ...(portal.requires ? [property('requires', portal.requires)] : []),
            ]),
          ),
          ...spawns.map((spawn) => object('spawn', [spawn.x, spawn.y], [property('monster', spawn.monster)])),
        ],
      },
      {
        id: 4,
        name: 'decor',
        type: 'objectgroup',
        objects: decor.map((item) => ({
          id: nextId++,
          name: item.prop,
          type: 'decor',
          x: item.x * 32,
          y: item.y * 32,
          width: 0,
          height: 0,
          rotation: 0,
          visible: true,
          point: true,
          properties: [
            { name: 'scale', type: 'float', value: item.scale },
            { name: 'flip', type: 'bool', value: item.flip },
            { name: 'tint', type: 'int', value: item.tint },
            ...(item.foot
              ? [{ name: 'foot', type: 'string', value: [item.foot.x0, item.foot.y0, item.foot.x1, item.foot.y1].join(',') }]
              : []),
          ],
        })),
      },
    ],
  };
  writeFileSync(OUTPUT, JSON.stringify(map));

  const trees = decor.filter((item) => /^(tree|bare|maple)/.test(item.prop)).length;
  const perMonster = spawns.length ? Math.round(reachable.size / spawns.length) : 0;
  console.log(
    `${plan.id}：${SIZE}×${SIZE}，可走 ${reachable.size} 格，水 ${water.size} 格，树 ${trees}，物件 ${decor.length}，` +
      `怪物 ${spawns.length}，每只占 ${perMonster} 格`,
  );
}

/** Catmull-Rom 插值，把折线点变成连续的曲线。 */
function smooth(points: Point[]): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(i + 2, points.length - 1)]!;
    const steps = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 3);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const blend = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
      result.push([blend(p0[0], p1[0], p2[0], p3[0]), blend(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  result.push(points.at(-1)!);
  return result;
}

/** 调参时只重生成一张：MAP_ONLY=map-id npx tsx tools/make-map.ts */
const only = process.env.MAP_ONLY;
for (const plan of MAPS) {
  if (!only || plan.id === only) generate(plan);
}

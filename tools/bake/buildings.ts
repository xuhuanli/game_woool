import * as THREE from 'three';

/**
 * 古风建筑：免费素材包里没有，用代码建模后走同一套烘焙流程。
 * 模型的 x 轴对应地图格子的 x 方向，z 轴对应 y 方向，正面朝 +z。
 * 一格是 CELL 个世界单位，占地尺寸要和 tools/make-map.ts 的 FOOTPRINTS 一致。
 */

export const CELL = Math.SQRT2;

export interface Style {
  roof: number;
  roofDark: number;
  ridge: number;
  column: number;
  wall: number;
  beam: number;
  stone: number;
  gold: number;
}

/** 禁地石殿：青石柱、石瓦，年久失修 */
export const STONE: Style = {
  roof: 0x6a625a,
  roofDark: 0x544c46,
  ridge: 0x3a3430,
  column: 0x8a8278,
  wall: 0x9a9288,
  beam: 0x5a524a,
  stone: 0x7a7268,
  gold: 0x8a7a5a,
};

/** 七玄门是江湖门派，灰瓦木柱 */
export const PLAIN: Style = {
  roof: 0x5d6670,
  roofDark: 0x4a525c,
  ridge: 0x3c434c,
  column: 0x7a4a2c,
  wall: 0xd9cdb4,
  beam: 0x5a3a24,
  stone: 0x9a968c,
  gold: 0xc9a24a,
};

/** 黄枫谷是修仙宗门，青瓦红柱 */
export const SECT: Style = {
  roof: 0x2f8a7c,
  roofDark: 0x256e64,
  ridge: 0xd9a441,
  column: 0xa8342a,
  wall: 0xe6dcc4,
  beam: 0x7a2a22,
  stone: 0xb4b0a4,
  gold: 0xe6b84a,
};

const material = (color: number, roughness = 0.75) =>
  new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });

function box(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  color: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color));
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function column(
  parent: THREE.Object3D,
  radius: number,
  height: number,
  x: number,
  y: number,
  z: number,
  color: number,
): void {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.1, height, 10), material(color));
  mesh.position.set(x, y + height / 2, z);
  parent.add(mesh);
}

/** 四面坡屋顶，檐口内凹，四角起翘，瓦垄用深浅两色表现。 */
function roof(
  parent: THREE.Object3D,
  width: number,
  depth: number,
  height: number,
  y: number,
  style: Style,
  lift = height * 0.28,
): void {
  const halfW = width / 2;
  const halfD = depth / 2;
  const slope = Math.min(halfW, halfD);
  const steps = 40;
  const positions: number[] = [];
  const colors: number[] = [];
  const light = new THREE.Color(style.roof);
  const dark = new THREE.Color(style.roofDark);

  const point = (i: number, j: number): [number, number, number] => {
    const x = (i / steps) * 2 - 1;
    const z = (j / steps) * 2 - 1;
    const px = x * halfW;
    const pz = z * halfD;
    const t = Math.min(1, Math.max((Math.abs(px) - (halfW - slope)) / slope, (Math.abs(pz) - (halfD - slope)) / slope));
    const corner = Math.pow(Math.abs(x), 6) * Math.pow(Math.abs(z), 6);
    return [px, height * Math.pow(1 - t, 1.6) + lift * corner + lift * 0.18 * Math.pow(t, 8), pz];
  };

  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const a = point(i, j);
      const b = point(i + 1, j);
      const c = point(i + 1, j + 1);
      const d = point(i, j + 1);
      positions.push(...a, ...d, ...b, ...b, ...d, ...c);
      const onFront = Math.abs((i + 0.5) / steps - 0.5) * halfW * 2 - (halfW - slope) / 1 < Math.abs((j + 0.5) / steps - 0.5) * halfD * 2 - (halfD - slope);
      const band = onFront ? i : j;
      const tone = band % 2 === 0 ? light : dark;
      for (let v = 0; v < 6; v++) colors.push(tone.r, tone.g, tone.b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true, side: THREE.DoubleSide }),
  );
  mesh.position.y = y;
  parent.add(mesh);

  // 正脊和两端的鸱吻
  const ridgeLength = Math.max(0, width - depth) + 0.3;
  if (ridgeLength > 0.35) {
    box(parent, [ridgeLength, 0.16, 0.16], [0, y + height + 0.05, 0], style.ridge);
    for (const side of [-1, 1]) {
      const end = box(parent, [0.16, 0.34, 0.16], [(side * ridgeLength) / 2, y + height + 0.2, 0], style.ridge);
      end.rotation.z = -side * 0.35;
    }
  } else {
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.45, 8), material(style.ridge));
    tip.position.set(0, y + height + 0.2, 0);
    parent.add(tip);
  }
}

function plaque(parent: THREE.Object3D, text: string, width: number, y: number, z: number, style: Style): void {
  const canvas = document.createElement('canvas');
  canvas.width = 256 * Math.max(1, text.length / 2);
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#1f2a33';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = `#${style.gold.toString(16).padStart(6, '0')}`;
  context.lineWidth = 8;
  context.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
  context.fillStyle = '#f0d27a';
  context.font = 'bold 84px "Songti SC", "STSong", serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const height = (width * canvas.height) / canvas.width;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture }),
  );
  mesh.position.set(0, y, z);
  parent.add(mesh);
}

/** 带窗棂的墙面：立柱之间是木格门窗。 */
function lattice(parent: THREE.Object3D, width: number, height: number, y: number, z: number, style: Style): void {
  const bays = Math.max(3, Math.round(width / 0.9));
  const bay = width / bays;
  for (let i = 0; i < bays; i++) {
    const x = -width / 2 + bay * (i + 0.5);
    const door = i === Math.floor(bays / 2);
    box(parent, [bay * 0.8, height * 0.82, 0.04], [x, y + height * 0.44, z], door ? style.beam : style.wall);
    if (!door) {
      for (let row = 1; row <= 3; row++) {
        box(parent, [bay * 0.8, 0.025, 0.05], [x, y + (height * 0.84 * row) / 4, z], style.beam);
      }
      box(parent, [0.025, height * 0.82, 0.05], [x, y + height * 0.44, z], style.beam);
    }
  }
}

function colonnade(parent: THREE.Object3D, width: number, depth: number, height: number, y: number, style: Style): void {
  const across = Math.max(2, Math.round(width / 1.1));
  for (let i = 0; i <= across; i++) {
    const x = -width / 2 + (width / across) * i;
    column(parent, 0.11, height, x, y, depth / 2, style.column);
    column(parent, 0.11, height, x, y, -depth / 2, style.column);
  }
  const along = Math.max(1, Math.round(depth / 1.1));
  for (let i = 1; i < along; i++) {
    const z = -depth / 2 + (depth / along) * i;
    column(parent, 0.11, height, width / 2, y, z, style.column);
    column(parent, 0.11, height, -width / 2, y, z, style.column);
  }
  box(parent, [width + 0.2, 0.12, 0.14], [0, y + height, depth / 2], style.beam);
  box(parent, [width + 0.2, 0.12, 0.14], [0, y + height, -depth / 2], style.beam);
  box(parent, [0.14, 0.12, depth + 0.2], [width / 2, y + height, 0], style.beam);
  box(parent, [0.14, 0.12, depth + 0.2], [-width / 2, y + height, 0], style.beam);
}

function platform(parent: THREE.Object3D, width: number, depth: number, height: number, style: Style): void {
  box(parent, [width, height, depth], [0, height / 2, 0], style.stone);
  box(parent, [width + 0.16, 0.06, depth + 0.16], [0, height, 0], style.stone);
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    const rise = height * (1 - i / steps);
    box(parent, [1.5, rise, 0.26], [0, rise / 2, depth / 2 + 0.13 + i * 0.26], style.stone);
  }
}

/** 大殿：台基、回廊、重檐屋顶。 */
export function hall(style: Style, name: string, cellsW = 9, cellsD = 6): THREE.Group {
  const group = new THREE.Group();
  const width = cellsW * CELL * 0.92;
  const depth = cellsD * CELL * 0.82;
  platform(group, width, depth, 0.5, style);
  const coreW = width * 0.78;
  const coreD = depth * 0.72;
  colonnade(group, coreW, coreD, 1.7, 0.56, style);
  box(group, [coreW - 0.4, 1.6, coreD - 0.4], [0, 1.36, 0], style.beam);
  lattice(group, coreW - 0.4, 1.6, 0.56, (coreD - 0.4) / 2 + 0.03, style);
  roof(group, coreW + 1.6, coreD + 1.6, 0.8, 2.3, style, 0.34);
  box(group, [coreW * 0.72, 0.7, coreD * 0.62], [0, 3.15, 0], style.beam);
  roof(group, coreW * 0.72 + 1.1, coreD * 0.62 + 1.1, 1.3, 3.5, style, 0.36);
  if (name) plaque(group, name, 2.4, 3.12, (coreD * 0.62) / 2 + 0.03, style);
  return group;
}

/** 厢房：矮台基、粉墙木梁、单层屋顶。 */
export function house(style: Style, cellsW = 6, cellsD = 4): THREE.Group {
  const group = new THREE.Group();
  const width = cellsW * CELL * 0.84;
  const depth = cellsD * CELL * 0.76;
  box(group, [width + 0.2, 0.2, depth + 0.2], [0, 0.1, 0], style.stone);
  box(group, [width, 1.5, depth], [0, 0.95, 0], style.wall);
  for (const x of [-width / 2, -width / 4, 0, width / 4, width / 2]) {
    box(group, [0.1, 1.5, 0.1], [x, 0.95, depth / 2], style.beam);
    box(group, [0.1, 1.5, 0.1], [x, 0.95, -depth / 2], style.beam);
  }
  box(group, [0.1, 1.5, 0.1], [width / 2, 0.95, 0], style.beam);
  box(group, [width + 0.1, 0.12, depth + 0.1], [0, 1.68, 0], style.beam);
  box(group, [0.7, 1.15, 0.05], [0, 0.78, depth / 2 + 0.03], style.beam);
  for (const side of [-1, 1]) {
    const x = (side * width) / 2.9;
    box(group, [0.7, 0.6, 0.05], [x, 1.05, depth / 2 + 0.03], style.beam);
    box(group, [0.6, 0.5, 0.06], [x, 1.05, depth / 2 + 0.04], style.wall);
    box(group, [0.03, 0.5, 0.07], [x, 1.05, depth / 2 + 0.05], style.beam);
    box(group, [0.6, 0.03, 0.07], [x, 1.05, depth / 2 + 0.05], style.beam);
  }
  roof(group, width + 1.1, depth + 1.1, 1.25, 1.72, style, 0.3);
  return group;
}

/** 楼阁：三层，每层带一圈出檐。 */
export function tower(style: Style, name: string, cells = 5): THREE.Group {
  const group = new THREE.Group();
  const base = cells * CELL * 0.76;
  box(group, [base + 0.3, 0.3, base + 0.3], [0, 0.15, 0], style.stone);
  let y = 0.3;
  let size = base * 0.84;
  for (let floor = 0; floor < 3; floor++) {
    const height = floor === 0 ? 1.6 : 1.25;
    box(group, [size, height, size], [0, y + height / 2, 0], style.beam);
    lattice(group, size, height, y, size / 2 + 0.03, style);
    colonnade(group, size + 0.1, size + 0.1, height, y, style);
    const top = y + height;
    if (floor === 2) {
      roof(group, size + 1.3, size + 1.3, 1.4, top, style, 0.34);
    } else {
      const eave = new THREE.Group();
      roof(eave, size + 1.2, size + 1.2, 0.55, 0, style, 0.26);
      eave.position.y = top;
      group.add(eave);
    }
    if (floor === 1) plaque(group, name, 1.7, top - 0.32, size / 2 + 0.1, style);
    y = top + 0.32;
    size *= 0.8;
  }
  return group;
}

/** 亭子：四柱、栏杆、攒尖顶。 */
export function pavilion(style: Style, cells = 3): THREE.Group {
  const group = new THREE.Group();
  const size = cells * CELL * 0.72;
  box(group, [size + 0.3, 0.26, size + 0.3], [0, 0.13, 0], style.stone);
  const half = size / 2 - 0.1;
  for (const x of [-half, half]) {
    for (const z of [-half, half]) column(group, 0.1, 1.5, x, 0.26, z, style.column);
  }
  for (const side of [-1, 1]) {
    box(group, [size - 0.2, 0.08, 0.08], [0, 0.72, side * half], style.beam);
    box(group, [0.08, 0.08, size - 0.2], [side * half, 0.72, 0], style.beam);
  }
  box(group, [size + 0.1, 0.1, size + 0.1], [0, 1.78, 0], style.beam);
  roof(group, size + 1.1, size + 1.1, 1.25, 1.82, style, 0.34);
  return group;
}

/** 牌楼山门：四柱三间，匾额写门派名，中间可以穿过。 */
export function gate(style: Style, name: string, cells = 7): THREE.Group {
  const group = new THREE.Group();
  const width = (cells - 1) * CELL;
  const outer = width / 2;
  const inner = outer * 0.6;
  for (const x of [-outer, -inner, inner, outer]) {
    box(group, [0.5, 0.4, 0.5], [x, 0.2, 0], style.stone);
    column(group, 0.15, x === outer || x === -outer ? 2.6 : 3.2, x, 0.3, 0, style.column);
  }
  box(group, [width + 0.3, 0.16, 0.2], [0, 2.9, 0], style.beam);
  box(group, [inner * 2 + 0.2, 0.2, 0.24], [0, 3.46, 0], style.beam);
  plaque(group, name, inner * 1.5, 3.1, 0.13, style);
  roof(group, inner * 2 + 1.2, 1.1, 0.75, 3.56, style, 0.28);
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    roof(wing, outer - inner + 0.9, 0.95, 0.55, 0, style, 0.24);
    wing.position.set((side * (outer + inner)) / 2, 2.98, 0);
    group.add(wing);
  }
  return group;
}

/** 围墙：白墙灰瓦，一段两格，人走到墙后时前后关系才对。 */
export function wall(style: Style, cells = 2): THREE.Group {
  const group = new THREE.Group();
  const length = cells * CELL;
  box(group, [length, 0.24, 0.5], [0, 0.12, 0], style.stone);
  box(group, [length, 1.2, 0.34], [0, 0.84, 0], style.wall);
  const cap = new THREE.Group();
  roof(cap, length + 0.12, 0.9, 0.26, 0, style, 0);
  cap.position.y = 1.42;
  group.add(cap);
  return group;
}

/** 石灯：立柱上一盏小灯，灯罩发暖光。 */
export function lantern(style: Style): THREE.Group {
  const group = new THREE.Group();
  box(group, [0.42, 0.14, 0.42], [0, 0.07, 0], style.stone);
  column(group, 0.1, 0.8, 0, 0.14, 0, style.stone);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.3), new THREE.MeshBasicMaterial({ color: 0xffd98a }));
  glow.position.y = 1.07;
  group.add(glow);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.24, 4), material(style.stone));
  cap.position.y = 1.32;
  cap.rotation.y = Math.PI / 4;
  group.add(cap);
  return group;
}

/** 丹炉：三足铜炉，炉口有火光。 */
export function cauldron(style: Style): THREE.Group {
  const group = new THREE.Group();
  const bronze = 0x8a6a3a;
  box(group, [1.5, 0.14, 1.5], [0, 0.07, 0], style.stone);
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + 0.5;
    column(group, 0.08, 0.5, Math.cos(angle) * 0.4, 0.14, Math.sin(angle) * 0.4, bronze);
  }
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), material(bronze, 0.45));
  body.scale.y = 0.85;
  body.position.y = 1.0;
  group.add(body);
  const fire = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 12), new THREE.MeshBasicMaterial({ color: 0xff9a3a }));
  fire.position.y = 1.52;
  group.add(fire);
  const lid = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.07, 8, 16), material(style.gold, 0.4));
  lid.rotation.x = Math.PI / 2;
  lid.position.y = 1.5;
  group.add(lid);
  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.04, 6, 12), material(style.gold, 0.4));
    handle.position.set(side * 0.66, 1.24, 0);
    handle.rotation.y = Math.PI / 2;
    group.add(handle);
  }
  return group;
}

/** 兵器架：演武场用。 */
export function weaponRack(style: Style, cells = 3): THREE.Group {
  const group = new THREE.Group();
  const width = cells * CELL * 0.75;
  for (const x of [-width / 2, width / 2]) box(group, [0.12, 1.3, 0.12], [x, 0.65, 0], style.column);
  box(group, [width + 0.1, 0.09, 0.09], [0, 1.2, 0], style.beam);
  box(group, [width + 0.1, 0.09, 0.09], [0, 0.45, 0], style.beam);
  const count = 5;
  for (let i = 0; i < count; i++) {
    const x = -width / 2 + (width / (count + 1)) * (i + 1);
    box(group, [0.05, 1.5, 0.05], [x, 0.85, 0.06], 0x6a5a44);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 4), material(0xd9dee6, 0.3));
    tip.position.set(x, 1.72, 0.06);
    group.add(tip);
  }
  return group;
}

/** 摊位：木案加布棚。 */
export function stall(style: Style, cells = 3): THREE.Group {
  const group = new THREE.Group();
  const width = cells * CELL * 0.8;
  const depth = CELL * 1.2;
  box(group, [width, 0.1, depth * 0.6], [0, 0.72, 0], style.beam);
  for (const x of [-width / 2.2, width / 2.2]) {
    box(group, [0.1, 0.72, depth * 0.5], [x, 0.36, 0], style.beam);
    column(group, 0.05, 1.7, x, 0, depth / 2, style.column);
    column(group, 0.05, 1.7, x, 0, -depth / 2, style.column);
  }
  const canvas = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, 0.05, depth + 0.3), material(style.roof));
  canvas.position.y = 1.72;
  canvas.rotation.x = 0.12;
  group.add(canvas);
  for (let i = 0; i < 5; i++) {
    const jar = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), material(i % 2 ? 0xc9a24a : 0x7a4a2c));
    jar.position.set(-width / 3 + (i * width) / 6, 0.86, 0);
    group.add(jar);
  }
  return group;
}

/** 让模型的 x、z 轴对齐地图的两条斜轴。 */
export function alignToGrid(model: THREE.Object3D): THREE.Group {
  const holder = new THREE.Group();
  model.rotation.y = -Math.PI / 4;
  holder.add(model);
  return holder;
}

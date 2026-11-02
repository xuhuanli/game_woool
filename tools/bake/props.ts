import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  alignToGrid,
  cauldron,
  gate,
  hall,
  house,
  lantern,
  pavilion,
  PLAIN,
  SECT,
  stall,
  STONE,
  tower,
  wall,
  weaponRack,
} from './buildings';

/** 景观物件：把 KayKit Forest 的模型和代码建模的建筑烘成单张精灵，脚底是原点，输出到 public/assets/props。 */

const FOREST = '/kaykit/forest/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf';
/** 游戏里 1 世界单位约 32 像素，放大一倍烘焙 */
const PIXELS_PER_UNIT = 64;
const SUPERSAMPLE = 2;
const ELEVATION = Math.PI / 6;
const OUTLINE_COLOR = '#15120f';
const OUTLINE_PX = 2;

interface Prop {
  key: string;
  model: string;
  /** 模型高度（世界单位） */
  height: number;
  /** 代码建模的建筑，有它时不读模型文件 */
  build?: () => THREE.Object3D;
  /** 把绿叶改成枫叶的金黄色 */
  maple?: boolean;
}

const prop = (key: string, model: string, height: number): Prop => ({ key, model, height });

const PROPS: Prop[] = [
  prop('tree-1', 'Tree_1_A_Color1', 4.4),
  prop('tree-2', 'Tree_1_C_Color1', 3.6),
  prop('tree-3', 'Tree_2_B_Color1', 3.8),
  prop('tree-4', 'Tree_2_E_Color1', 4.6),
  prop('tree-5', 'Tree_3_A_Color1', 3.4),
  prop('tree-6', 'Tree_3_C_Color1', 4.2),
  prop('tree-7', 'Tree_4_A_Color1', 3.4),
  prop('tree-8', 'Tree_4_C_Color1', 4.8),
  prop('bare-1', 'Tree_Bare_1_B_Color1', 3.2),
  prop('bare-2', 'Tree_Bare_2_B_Color1', 2.8),
  prop('rock-1', 'Rock_1_C_Color1', 1.1),
  prop('rock-2', 'Rock_1_H_Color1', 0.8),
  prop('rock-3', 'Rock_2_B_Color1', 1.2),
  prop('rock-4', 'Rock_2_E_Color1', 0.8),
  prop('peak-1', 'Rock_3_A_Color1', 3.8),
  prop('peak-2', 'Rock_3_C_Color1', 3.2),
  prop('peak-3', 'Rock_3_F_Color1', 3.4),
  prop('peak-4', 'Rock_3_I_Color1', 2.6),
  prop('peak-5', 'Rock_3_L_Color1', 2.2),
  prop('bush-1', 'Bush_1_C_Color1', 0.8),
  prop('bush-2', 'Bush_2_C_Color1', 0.7),
  prop('bush-3', 'Bush_3_B_Color1', 0.8),
  prop('bush-4', 'Bush_4_C_Color1', 0.9),
  prop('grass-1', 'Grass_1_C_Color1', 0.4),
  prop('grass-2', 'Grass_2_C_Color1', 0.5),
];

const MAPLES: Prop[] = [
  { ...prop('maple-1', 'Tree_1_A_Color1', 4.4), maple: true },
  { ...prop('maple-2', 'Tree_2_B_Color1', 3.8), maple: true },
  { ...prop('maple-3', 'Tree_3_A_Color1', 3.4), maple: true },
  { ...prop('maple-4', 'Tree_4_A_Color1', 3.4), maple: true },
];

const building = (key: string, build: () => THREE.Object3D): Prop => ({
  key,
  model: '',
  height: 0,
  build: () => alignToGrid(build()),
});

const BUILDINGS: Prop[] = [
  building('bld-hall-plain', () => hall(PLAIN, '聚义堂')),
  building('bld-hall-sect', () => hall(SECT, '黄枫殿')),
  building('bld-hall-stone', () => hall(STONE, '')),
  building('bld-wall-stone', () => wall(STONE)),
  building('obj-lantern-stone', () => lantern(STONE)),
  building('bld-house-plain', () => house(PLAIN)),
  building('bld-house-sect', () => house(SECT)),
  building('bld-tower-plain', () => tower(PLAIN, '藏书阁')),
  building('bld-tower-sect', () => tower(SECT, '藏宝阁')),
  building('bld-pavilion-plain', () => pavilion(PLAIN)),
  building('bld-pavilion-sect', () => pavilion(SECT)),
  building('bld-gate-plain', () => gate(PLAIN, '七玄门')),
  building('bld-gate-sect', () => gate(SECT, '黄枫谷')),
  building('bld-gate-taina', () => gate(PLAIN, '太南谷')),
  building('bld-wall-plain', () => wall(PLAIN)),
  building('bld-wall-sect', () => wall(SECT)),
  building('obj-lantern', () => lantern(PLAIN)),
  building('obj-cauldron', () => cauldron(SECT)),
  building('obj-rack', () => weaponRack(PLAIN)),
  building('obj-stall', () => stall(PLAIN)),
];

const status = document.getElementById('status')!;
const loader = new GLTFLoader();
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);

interface Placement {
  w: number;
  h: number;
  ox: number;
  oy: number;
}

async function loadProp(entry: Prop): Promise<THREE.Object3D> {
  if (entry.build) return entry.build();
  const { scene: model } = await loader.loadAsync(`${FOREST}/${entry.model}.gltf`);
  const raw = new THREE.Box3().setFromObject(model);
  const scale = entry.height / (raw.max.y - raw.min.y);
  model.scale.setScalar(scale);
  model.position.y = -raw.min.y * scale;
  if (entry.maple) model.traverse(toMaple);
  return model;
}

/** 贴图里偏绿的像素换成金黄色，树干的红棕色不变。 */
function toMaple(object: THREE.Object3D): void {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh) return;
  const material = mesh.material as THREE.MeshStandardMaterial;
  const image = material.map?.image as ImageBitmap | undefined;
  if (!image) return;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const red = pixels.data[i]!;
    const green = pixels.data[i + 1]!;
    if (green <= red) continue;
    pixels.data[i] = Math.min(255, green * 1.25);
    pixels.data[i + 1] = green * 0.78;
    pixels.data[i + 2] = pixels.data[i + 2]! * 0.25;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  material.map = texture;
}

async function bake(entry: Prop): Promise<Placement> {
  const model = await loadProp(entry);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const height = box.max.y;
  const reach = Math.max(box.max.x, -box.min.x, box.max.z, -box.min.z) * Math.SQRT2;

  const halfW = reach + 0.2;
  const halfH = height * 0.6 + reach * 0.6 + 0.3;
  const widthPx = Math.ceil(halfW * 2 * PIXELS_PER_UNIT);
  const heightPx = Math.ceil(halfH * 2 * PIXELS_PER_UNIT);
  renderer.setSize(widthPx * SUPERSAMPLE, heightPx * SUPERSAMPLE);

  const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 100);
  const look = height / 2;
  camera.position.set(0, look + Math.sin(ELEVATION) * 40, Math.cos(ELEVATION) * 40);
  camera.lookAt(0, look, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const scene = new THREE.Scene();
  scene.add(model);
  scene.add(new THREE.HemisphereLight(0xe6ecff, 0x6a5a44, 2));
  const sun = new THREE.DirectionalLight(0xfff0d8, 3);
  sun.position.set(-3, 6, 4);
  scene.add(sun);
  renderer.render(scene, camera);

  const frame = document.createElement('canvas');
  frame.width = widthPx;
  frame.height = heightPx;
  const frameContext = frame.getContext('2d', { willReadFrequently: true })!;
  frameContext.imageSmoothingQuality = 'high';
  frameContext.drawImage(renderer.domElement, 0, 0, widthPx, heightPx);

  const mask = document.createElement('canvas');
  mask.width = widthPx;
  mask.height = heightPx;
  const maskContext = mask.getContext('2d')!;
  maskContext.drawImage(frame, 0, 0);
  maskContext.globalCompositeOperation = 'source-in';
  maskContext.fillStyle = OUTLINE_COLOR;
  maskContext.fillRect(0, 0, widthPx, heightPx);

  const merged = document.createElement('canvas');
  merged.width = widthPx;
  merged.height = heightPx;
  const mergedContext = merged.getContext('2d', { willReadFrequently: true })!;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    mergedContext.drawImage(mask, dx! * OUTLINE_PX, dy! * OUTLINE_PX);
  }
  mergedContext.drawImage(frame, 0, 0);

  const { data } = mergedContext.getImageData(0, 0, widthPx, heightPx);
  let minX = widthPx;
  let minY = heightPx;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      if (!data[(y * widthPx + x) * 4 + 3]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const cropped = document.createElement('canvas');
  cropped.width = w;
  cropped.height = h;
  cropped.getContext('2d')!.drawImage(merged, -minX, -minY);

  // 模型脚底在画面里的位置，作为精灵原点
  const foot = new THREE.Vector3(0, 0, 0).project(camera);
  const footX = ((foot.x + 1) / 2) * widthPx;
  const footY = ((1 - foot.y) / 2) * heightPx;

  const png = await new Promise<Blob>((resolve) => cropped.toBlob((blob) => resolve(blob!), 'image/png'));
  await fetch(`/save?dir=props&name=${entry.key}.png`, { method: 'POST', body: png });
  return { w, h, ox: (footX - minX) / w, oy: (footY - minY) / h };
}

const manifest: Record<string, Placement> = {};
for (const entry of [...PROPS, ...MAPLES, ...BUILDINGS]) {
  status.textContent = `烘焙 ${entry.key}`;
  manifest[entry.key] = await bake(entry);
}
await fetch('/save?dir=props&name=props.json', { method: 'POST', body: JSON.stringify(manifest, null, 2) });
status.textContent = `完成：${Object.keys(manifest).length} 个景观物件`;

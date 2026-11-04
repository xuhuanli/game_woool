import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addStudioLighting } from './lighting';
import { ROSTER, type ClipSpec, type Entry, type Recolor } from './roster';

const WORLD_HEIGHT = 3;
const SUPERSAMPLE = 3;
const DIRECTIONS = 8;
/** 精灵在游戏里按 96 像素一格显示 */
const DISPLAY_FRAME = 96;
/** 地面在画面中的位置，和游戏里的精灵原点一致 */
const ORIGIN_Y = 0.8;
/** 俯角 30 度时，地面格子正好是 2:1 的菱形 */
const ELEVATION = Math.PI / 6;
const OUTLINE_COLOR = '#15120f';
const OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

const status = document.getElementById('status')!;
const sheet = document.getElementById('sheet') as HTMLCanvasElement;
const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();

interface LoadedModel {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

async function loadModel(url: string): Promise<LoadedModel> {
  if (url.endsWith('.fbx')) {
    const scene = await fbxLoader.loadAsync(encodeURI(url));
    return { scene, animations: scene.animations };
  }
  const { scene, animations } = await gltfLoader.loadAsync(encodeURI(url));
  return { scene, animations };
}

function recolorTexture(image: ImageBitmap, recolor: Recolor[]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0);
  // 贴图是 8×4 的色块，按格换色，保留每格原有的明暗渐变
  const cellW = image.width / 8;
  const cellH = image.height / 4;
  for (const { col, row, span = 1, color } of recolor) {
    const x = col * cellW;
    const y = row * cellH;
    const pixels = context.getImageData(x, y, cellW * span, cellH);
    const target = new THREE.Color(color).convertLinearToSRGB();
    let peak = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      peak = Math.max(peak, pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!);
    }
    for (let i = 0; i < pixels.data.length; i += 4) {
      const value = Math.max(pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!) / peak;
      pixels.data[i] = target.r * value * 255;
      pixels.data[i + 1] = target.g * value * 255;
      pixels.data[i + 2] = target.b * value * 255;
    }
    context.putImageData(pixels, x, y);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

/** 头顶的发髻和发簪，帽子去掉后的修士标志。 */
function addTopknot(head: THREE.Object3D): void {
  const hair = new THREE.MeshStandardMaterial({ color: 0x17120f, roughness: 0.7 });
  const pin = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.4 });
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), hair);
  bun.position.set(0, 0.92, -0.04);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6), pin);
  stick.position.copy(bun.position);
  stick.rotation.z = Math.PI / 2.4;
  head.add(bun, stick);
}

function dressModel(entry: Entry, model: THREE.Object3D): void {
  let texture: THREE.Texture | null = null;
  model.traverse((object) => {
    if (entry.hide?.includes(object.name)) object.visible = false;
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials as THREE.MeshStandardMaterial[]) {
      const color = entry.materials?.[material.name];
      if (color) material.color.set(color);
      if (!entry.recolor || !material.map) continue;
      texture ??= recolorTexture(material.map.image as ImageBitmap, entry.recolor);
      material.map = texture;
    }
  });
}

function findClip(animations: THREE.AnimationClip[], source: string): THREE.AnimationClip {
  const clip = animations.find((candidate) => candidate.name === source || candidate.name.endsWith(source));
  if (!clip) throw new Error(`找不到动作 ${source}：${animations.map((a) => a.name).join(', ')}`);
  return clip;
}

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);

const half = WORLD_HEIGHT / 2;
const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 50);
const lookHeight = ((0.5 - (1 - ORIGIN_Y)) * WORLD_HEIGHT) / Math.cos(ELEVATION);
camera.position.set(0, lookHeight + Math.sin(ELEVATION) * 20, Math.cos(ELEVATION) * 20);
camera.lookAt(0, lookHeight, 0);

async function bake(entry: Entry): Promise<void> {
  const frame = entry.frame;
  const outline = Math.max(1, Math.round(frame / DISPLAY_FRAME));
  renderer.setSize(frame * SUPERSAMPLE, frame * SUPERSAMPLE);

  const { scene: model, animations } = await loadModel(entry.model);
  dressModel(entry, model);

  const head = entry.humanoid ? model.getObjectByName('head') : null;
  const headScale = entry.headScale ?? 1;
  if (entry.topknot && head) addTopknot(head);
  if (entry.prop) {
    const prop = await loadModel(entry.prop.model);
    prop.scene.scale.setScalar(entry.prop.scale);
    // GLTFLoader 会去掉节点名里的点号
    model.getObjectByName('handslotr')!.add(prop.scene);
  }

  const mixer = new THREE.AnimationMixer(model);
  const sample = (spec: ClipSpec, progress: number) => {
    const clip = findClip(animations, spec.source);
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.play();
    action.time = clip.duration * progress;
    mixer.update(0);
    head?.scale.setScalar(headScale);
    model.updateMatrixWorld(true);
  };

  sample(entry.clips[0]!, 0);
  const root = new THREE.Group();
  const holder = new THREE.Group();
  holder.add(model);
  root.add(holder);
  holder.rotation.y = THREE.MathUtils.degToRad(entry.yaw ?? 0);
  const bounds = new THREE.Box3().setFromObject(model, true);
  const rawSize = head
    ? head.getWorldPosition(new THREE.Vector3()).y + 0.75 - bounds.min.y
    : Math.max(...bounds.getSize(new THREE.Vector3()).toArray());
  const scale = entry.size / rawSize;
  root.scale.setScalar(scale);
  if (!head) {
    const center = bounds.getCenter(new THREE.Vector3());
    holder.position.set(-center.x, -bounds.min.y, -center.z);
  }

  const scene = new THREE.Scene();
  scene.add(root);
  addStudioLighting(scene);

  const columns = entry.clips.reduce((sum, clip) => sum + clip.frames, 0);
  sheet.width = frame * columns;
  sheet.height = frame * DIRECTIONS;
  const sheetContext = sheet.getContext('2d')!;
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = frameCanvas.height = frame;
  const frameContext = frameCanvas.getContext('2d')!;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = maskCanvas.height = frame;
  const maskContext = maskCanvas.getContext('2d')!;

  /** 把当前画面缩到一格，并在外圈加深色描边，小尺寸下轮廓更清楚。 */
  const drawFrame = (x: number, y: number) => {
    frameContext.clearRect(0, 0, frame, frame);
    frameContext.imageSmoothingQuality = 'high';
    frameContext.drawImage(renderer.domElement, 0, 0, frame, frame);
    maskContext.globalCompositeOperation = 'source-over';
    maskContext.clearRect(0, 0, frame, frame);
    maskContext.drawImage(frameCanvas, 0, 0);
    maskContext.globalCompositeOperation = 'source-in';
    maskContext.fillStyle = OUTLINE_COLOR;
    maskContext.fillRect(0, 0, frame, frame);
    for (const [dx, dy] of OFFSETS) {
      sheetContext.drawImage(maskCanvas, x + dx! * outline, y + dy! * outline);
    }
    sheetContext.drawImage(frameCanvas, x, y);
  };

  const clips: Record<string, { frames: number[]; rate: number; loop: boolean }> = {};
  let column = 0;
  for (const clip of entry.clips) {
    clips[clip.name] = {
      frames: Array.from({ length: clip.frames }, (_, i) => column + i),
      rate: clip.rate,
      loop: clip.loop,
    };
    for (let i = 0; i < clip.frames; i++) {
      sample(clip, clip.loop ? i / clip.frames : (i + 0.5) / clip.frames);
      for (let row = 0; row < DIRECTIONS; row++) {
        // 第 0 行朝东，顺时针旋转，模型默认面向 +Z
        root.rotation.y = Math.PI / 2 - (row * Math.PI) / 4;
        renderer.render(scene, camera);
        drawFrame(column * frame, row * frame);
      }
      column += 1;
    }
  }

  const png = await new Promise<Blob>((resolve) => sheet.toBlob((blob) => resolve(blob!), 'image/png'));
  const manifest = {
    frameW: frame,
    frameH: frame,
    originY: ORIGIN_Y,
    columns,
    displayScale: DISPLAY_FRAME / frame,
    clips,
  };
  await fetch(`/save?name=${entry.key}.png`, { method: 'POST', body: png });
  await fetch(`/save?name=${entry.key}.json`, { method: 'POST', body: JSON.stringify(manifest, null, 2) });
}

const only = new URLSearchParams(location.search).get('only')?.split(',');
const done: string[] = [];
for (const entry of ROSTER) {
  if (only && !only.includes(entry.key)) continue;
  status.textContent = `烘焙 ${entry.key}（${done.length}）`;
  try {
    await bake(entry);
    done.push(entry.key);
  } catch (error) {
    console.error(entry.key, error);
    done.push(`${entry.key}:失败`);
  }
}
status.textContent = `完成：${done.join(' ')}`;

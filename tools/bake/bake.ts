import * as THREE from 'three';
import { BODY_LOOK, buildCultivator, poseAttack, poseIdle, poseWalk } from './cultivator';
import { WEBP_QUALITY } from './roster';

const FRAME = 192;
const SUPERSAMPLE = 3;
const WORLD_HEIGHT = 3;
const DIRECTIONS = 8;
/** 地面在画面中的位置，和游戏里的精灵原点一致 */
const ORIGIN_Y = 0.8;
/** 俯角 30 度时，地面格子正好是 2:1 的菱形 */
const ELEVATION = Math.PI / 6;

const CLIPS = [
  { name: 'idle', frames: 4, rate: 4, pose: poseIdle, loop: true },
  { name: 'walk', frames: 8, rate: 14, pose: poseWalk, loop: true },
  { name: 'attack', frames: 6, rate: 16, pose: poseAttack, loop: false },
];

const columns = CLIPS.reduce((sum, clip) => sum + clip.frames, 0);
const status = document.getElementById('status')!;
const sheet = document.getElementById('sheet') as HTMLCanvasElement;
sheet.width = FRAME * columns;
sheet.height = FRAME * DIRECTIONS;
const sheetContext = sheet.getContext('2d')!;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(FRAME * SUPERSAMPLE, FRAME * SUPERSAMPLE);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xffffff, 1.5));
const sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
sun.position.set(-2, 4, 3);
scene.add(sun);

const half = WORLD_HEIGHT / 2;
const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 50);
const lookHeight = (0.5 - (1 - ORIGIN_Y)) * WORLD_HEIGHT / Math.cos(ELEVATION);
camera.position.set(0, lookHeight + Math.sin(ELEVATION) * 20, Math.cos(ELEVATION) * 20);
camera.lookAt(0, lookHeight, 0);

const rig = buildCultivator(BODY_LOOK);
scene.add(rig.root);

const clips: Record<string, { frames: number[]; rate: number; loop: boolean }> = {};
let column = 0;
for (const clip of CLIPS) {
  clips[clip.name] = {
    frames: Array.from({ length: clip.frames }, (_, i) => column + i),
    rate: clip.rate,
    loop: clip.loop,
  };
  for (let i = 0; i < clip.frames; i++) {
    clip.pose(rig, clip.loop ? i / clip.frames : (i + 0.5) / clip.frames);
    for (let row = 0; row < DIRECTIONS; row++) {
      // 第 0 行朝东，顺时针旋转，模型默认面向 +Z
      rig.root.rotation.y = Math.PI / 2 - (row * Math.PI) / 4;
      renderer.render(scene, camera);
      sheetContext.drawImage(renderer.domElement, column * FRAME, row * FRAME, FRAME, FRAME);
    }
    column += 1;
  }
}

const webp = await new Promise<Blob>((resolve) => sheet.toBlob((blob) => resolve(blob!), 'image/webp', WEBP_QUALITY));
const manifest = {
  frameW: FRAME,
  frameH: FRAME,
  originY: ORIGIN_Y,
  columns,
  displayScale: 0.5,
  clips,
};
await fetch('/save?name=body.webp', { method: 'POST', body: webp });
await fetch('/save?name=body.json', { method: 'POST', body: JSON.stringify(manifest, null, 2) });
status.textContent = `完成：${sheet.width}×${sheet.height}，${Math.round(webp.size / 1024)} KB`;

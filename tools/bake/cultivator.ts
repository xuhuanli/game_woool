import * as THREE from 'three';

export interface Look {
  robe: number;
  robeShade: number;
  trim: number;
  sash: number;
  skin: number;
  hair: number;
  boots: number;
  blade: number;
  hilt: number;
}

export const BODY_LOOK: Look = {
  robe: 0x8e2f2a,
  robeShade: 0x5e1d1c,
  trim: 0xd9b45a,
  sash: 0x2c2420,
  skin: 0xe8c29c,
  hair: 0x1d1714,
  boots: 0x2e2520,
  blade: 0xdfe6ee,
  hilt: 0x8a6a2c,
};

/** 三阶色调贴图，让光影像手绘而不是写实。 */
function toonRamp(): THREE.DataTexture {
  const data = new Uint8Array([120, 120, 120, 255, 195, 195, 195, 255, 255, 255, 255, 255]);
  const texture = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

export interface Rig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armLeft: THREE.Group;
  armRight: THREE.Group;
  foreLeft: THREE.Group;
  foreRight: THREE.Group;
  legLeft: THREE.Group;
  legRight: THREE.Group;
  shinLeft: THREE.Group;
  shinRight: THREE.Group;
  skirtFront: THREE.Group;
  skirtBack: THREE.Group;
  ponytail: THREE.Group;
  sword: THREE.Group;
}

const OUTLINE_WIDTH = 0.014;

/** 用程序生成的简单几何体搭一个修士，关节都是 Group，方便写动作。 */
export function buildCultivator(look: Look): Rig {
  const ramp = toonRamp();
  const paint = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap: ramp });
  const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x14100c, side: THREE.BackSide });

  const part = (
    geometry: THREE.BufferGeometry,
    color: number,
    parent: THREE.Object3D,
    position: [number, number, number] = [0, 0, 0],
    rotation: [number, number, number] = [0, 0, 0],
  ) => {
    const mesh = new THREE.Mesh(geometry, paint(color));
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    parent.add(mesh);
    const outline = new THREE.Mesh(geometry, outlineMaterial);
    geometry.computeBoundingSphere();
    const radius = geometry.boundingSphere?.radius ?? 0.1;
    outline.scale.setScalar(1 + OUTLINE_WIDTH / radius);
    mesh.add(outline);
    return mesh;
  };

  const joint = (parent: THREE.Object3D, position: [number, number, number]) => {
    const group = new THREE.Group();
    group.position.set(...position);
    parent.add(group);
    return group;
  };

  const tube = (top: number, bottom: number, height: number) =>
    new THREE.CylinderGeometry(top, bottom, height, 16, 1).translate(0, -height / 2, 0);

  const root = new THREE.Group();
  const hips = joint(root, [0, 0.92, 0]);

  // 腿
  const leg = (side: number) => {
    const thigh = joint(hips, [side * 0.1, 0, 0]);
    part(tube(0.085, 0.07, 0.42), look.robeShade, thigh);
    const shin = joint(thigh, [0, -0.42, 0]);
    part(tube(0.07, 0.06, 0.38), look.robeShade, shin);
    part(new THREE.BoxGeometry(0.12, 0.09, 0.24), look.boots, shin, [0, -0.41, 0.05]);
    return { thigh, shin };
  };
  const left = leg(-1);
  const right = leg(1);

  // 下摆分前后两片，走路时能摆动
  const skirtPiece = (side: number) => {
    const flap = joint(hips, [0, 0.03, side * 0.09]);
    const shape = new THREE.CylinderGeometry(0.2, 0.29, 0.56, 16, 1, false, side > 0 ? -1.45 : 1.69, 2.9);
    part(shape.translate(0, -0.28, -side * 0.09), look.robe, flap);
    return flap;
  };
  const skirtFront = skirtPiece(1);
  const skirtBack = skirtPiece(-1);

  // 上身
  const torso = joint(hips, [0, 0.02, 0]);
  part(tube(0.25, 0.19, 0.58).translate(0, 0.58, 0), look.robe, torso);
  part(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 16), look.sash, torso, [0, 0.05, 0]);
  part(new THREE.BoxGeometry(0.1, 0.06, 0.03), look.trim, torso, [0, 0.05, 0.2]);
  // 交领
  part(new THREE.BoxGeometry(0.05, 0.42, 0.02), look.trim, torso, [0.05, 0.36, 0.215], [0, 0, 0.42]);
  part(new THREE.BoxGeometry(0.05, 0.42, 0.02), look.trim, torso, [-0.05, 0.36, 0.215], [0, 0, -0.42]);

  // 手臂
  const arm = (side: number) => {
    const shoulder = joint(torso, [side * 0.28, 0.54, 0]);
    part(new THREE.SphereGeometry(0.095, 12, 10), look.robe, shoulder);
    part(tube(0.085, 0.1, 0.32), look.robe, shoulder);
    const fore = joint(shoulder, [0, -0.32, 0]);
    part(tube(0.1, 0.13, 0.25), look.robe, fore);
    part(new THREE.CylinderGeometry(0.135, 0.135, 0.03, 14), look.trim, fore, [0, -0.25, 0]);
    part(new THREE.SphereGeometry(0.06, 10, 8), look.skin, fore, [0, -0.31, 0]);
    return { shoulder, fore };
  };
  const armLeft = arm(-1);
  const armRight = arm(1);

  // 剑：握在右手，刀身沿手的前方
  const sword = joint(armRight.fore, [0, -0.31, 0]);
  part(new THREE.BoxGeometry(0.03, 0.03, 0.2), look.hilt, sword, [0, 0, 0.02]);
  part(new THREE.BoxGeometry(0.2, 0.035, 0.035), look.trim, sword, [0, 0, 0.13]);
  part(new THREE.BoxGeometry(0.065, 0.016, 0.82), look.blade, sword, [0, 0, 0.55]);
  part(new THREE.ConeGeometry(0.046, 0.12, 4), look.blade, sword, [0, 0, 1.02], [Math.PI / 2, Math.PI / 4, 0]);

  // 头和发髻
  const head = joint(torso, [0, 0.62, 0]);
  part(tube(0.06, 0.07, 0.08).translate(0, 0.07, 0), look.skin, head);
  part(new THREE.SphereGeometry(0.17, 18, 14), look.skin, head, [0, 0.19, 0.01]);
  part(new THREE.SphereGeometry(0.182, 18, 14, 0, Math.PI * 2, 0, 1.55), look.hair, head, [0, 0.2, -0.018], [-0.32, 0, 0]);
  part(new THREE.SphereGeometry(0.075, 12, 10), look.hair, head, [0, 0.4, -0.03]);
  part(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), look.trim, head, [0, 0.4, -0.03], [0, 0, Math.PI / 2]);
  part(new THREE.BoxGeometry(0.038, 0.03, 0.02), look.hair, head, [-0.07, 0.2, 0.172]);
  part(new THREE.BoxGeometry(0.038, 0.03, 0.02), look.hair, head, [0.07, 0.2, 0.172]);
  const ponytail = joint(head, [0, 0.3, -0.16]);
  part(tube(0.05, 0.015, 0.42), look.hair, ponytail);

  return {
    root,
    hips,
    torso,
    head,
    armLeft: armLeft.shoulder,
    armRight: armRight.shoulder,
    foreLeft: armLeft.fore,
    foreRight: armRight.fore,
    legLeft: left.thigh,
    legRight: right.thigh,
    shinLeft: left.shin,
    shinRight: right.shin,
    skirtFront,
    skirtBack,
    ponytail,
    sword,
  };
}

const HIPS_Y = 0.92;

function pose(rig: Rig, values: Partial<Record<string, number>>): void {
  const v = (name: string) => values[name] ?? 0;
  rig.hips.position.y = HIPS_Y + v('bob');
  rig.hips.position.z = v('lunge');
  rig.hips.rotation.x = v('lean');
  rig.hips.rotation.y = v('hipsTurn');
  rig.torso.rotation.x = v('torsoLean');
  rig.torso.rotation.y = v('twist');
  rig.head.rotation.y = -v('twist') * 0.6;
  rig.legLeft.rotation.x = v('legL');
  rig.legRight.rotation.x = v('legR');
  rig.shinLeft.rotation.x = v('kneeL');
  rig.shinRight.rotation.x = v('kneeR');
  rig.armLeft.rotation.set(v('armL'), 0, -0.14 + v('armLOut'));
  rig.armRight.rotation.set(v('armR'), v('armRTurn'), 0.14 + v('armROut'));
  rig.foreLeft.rotation.x = v('elbowL') - 0.2;
  rig.foreRight.rotation.x = v('elbowR') - 0.2;
  rig.skirtFront.rotation.x = v('skirt');
  rig.skirtBack.rotation.x = v('skirt');
  rig.ponytail.rotation.x = 0.25 + v('hair');
  rig.sword.rotation.x = v('wrist');
}

const TAU = Math.PI * 2;

/** 待机：呼吸起伏。 */
export function poseIdle(rig: Rig, t: number): void {
  const breath = Math.sin(t * TAU);
  pose(rig, {
    bob: breath * 0.008,
    armR: -0.12,
    elbowR: -0.5 + breath * 0.03,
    armL: 0.05 + breath * 0.02,
    legL: 0.06,
    legR: -0.06,
    hair: breath * 0.05,
    wrist: 0.35,
  });
}

/** 走路：一个循环内左右腿各迈一步。 */
export function poseWalk(rig: Rig, t: number): void {
  const swing = Math.sin(t * TAU);
  const counter = Math.cos(t * TAU);
  const lift = (phase: number) => Math.max(0, Math.sin(phase));
  pose(rig, {
    bob: Math.abs(counter) * 0.035 - 0.03,
    lean: 0.09,
    twist: swing * 0.14,
    legL: swing * 0.6,
    legR: -swing * 0.6,
    kneeL: 0.2 + lift(t * TAU + 1.2) * 0.8,
    kneeR: 0.2 + lift(t * TAU + 1.2 + Math.PI) * 0.8,
    armL: -swing * 0.5,
    armR: swing * 0.32 - 0.1,
    elbowL: -0.3,
    elbowR: -0.55,
    skirt: swing * 0.12,
    hair: Math.abs(swing) * 0.18 + 0.1,
    wrist: 0.35,
  });
}

/** 挥砍：蓄力、劈下、收势。 */
export function poseAttack(rig: Rig, t: number): void {
  const keys = [
    { at: 0, twist: 0, armR: -0.2, armROut: 0, elbowR: -0.5, lean: 0, lunge: 0, wrist: 0.35, legL: 0, legR: 0 },
    { at: 0.28, twist: 0.75, armR: -2.5, armROut: 0.25, elbowR: -0.8, lean: -0.1, lunge: -0.04, wrist: -0.3, legL: 0.28, legR: -0.25 },
    { at: 0.5, twist: -0.65, armR: -0.75, armROut: -0.35, elbowR: -0.1, lean: 0.28, lunge: 0.17, wrist: 0.15, legL: 0.5, legR: -0.5 },
    { at: 0.68, twist: -0.85, armR: -0.35, armROut: -0.45, elbowR: -0.2, lean: 0.24, lunge: 0.15, wrist: 0.35, legL: 0.45, legR: -0.45 },
    { at: 1, twist: 0, armR: -0.2, armROut: 0, elbowR: -0.5, lean: 0, lunge: 0, wrist: 0.35, legL: 0, legR: 0 },
  ];
  const nextIndex = Math.max(1, keys.findIndex((key) => key.at >= t));
  const from = keys[nextIndex - 1]!;
  const to = keys[nextIndex]!;
  const local = (t - from.at) / (to.at - from.at);
  const eased = local * local * (3 - 2 * local);
  const mix = (name: keyof typeof from) => from[name] + (to[name] - from[name]) * eased;
  pose(rig, {
    twist: mix('twist'),
    armR: mix('armR'),
    armROut: mix('armROut'),
    elbowR: mix('elbowR'),
    lean: mix('lean'),
    lunge: mix('lunge'),
    wrist: mix('wrist'),
    legL: mix('legL'),
    legR: mix('legR'),
    kneeL: Math.abs(mix('legL')) * 0.5,
    kneeR: Math.abs(mix('legR')) * 0.9,
    armL: 0.25,
    armLOut: 0.35,
    elbowL: -0.4,
    skirt: mix('lean') * 0.5,
    hair: 0.2 + mix('lean') * -0.4,
  });
}

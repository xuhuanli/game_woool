import * as THREE from 'three';

/**
 * 烘焙用的统一布光。
 *
 * 角色和景观原本各写了一套光：角色多了蓝色轮廓光，太阳高度角也差一档，
 * 同一屏里树和人的受光面因此对不上。这里收成一处，两边都从这里取。
 *
 * 默认值是角色那套（更接近成品的参考），景观改成调用它之后会向角色靠拢。
 */

/** 主光方向：左前上方。DirectionalLight 只认方向，长度无所谓。 */
export const SUN_DIRECTION = new THREE.Vector3(-3, 5, 4).normalize();

export interface LightingOptions {
  /** 天光强度，控制暗部亮度 */
  ambient?: number;
  /** 主光强度 */
  sun?: number;
  /** 背面冷色轮廓光强度，0 关闭 */
  rim?: number;
}

export function addStudioLighting(scene: THREE.Scene, options: LightingOptions = {}): void {
  const { ambient = 2.2, sun = 3.2, rim = 0.8 } = options;

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x6a5a44, ambient));

  const key = new THREE.DirectionalLight(0xfff2dc, sun);
  key.position.copy(SUN_DIRECTION).multiplyScalar(10);
  scene.add(key);

  if (rim > 0) {
    const back = new THREE.DirectionalLight(0x9fc4ff, rim);
    back.position.set(3, 2, -4);
    scene.add(back);
  }
}

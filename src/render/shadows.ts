import type Phaser from 'phaser';

/**
 * 接触阴影：贴地的一层软边椭圆，让角色和景观从地砖上「落下来」。
 * 景观的阴影在预渲染地表时一次性画进地面贴图（见 groundPainter），
 * 这里只负责会动的东西——角色、怪、召唤物。
 */

export const SHADOW_KEY = 'contact-shadow';
/** 阴影横向直径 = 精灵显示宽度 × 这个系数 */
export const SHADOW_SPREAD = 0.44;
/** 阴影压在地面层之上、精灵之下，深度比脚底小一点 */
export const SHADOW_DEPTH_GAP = 0.5;

const STAMP_WIDTH = 128;

/** 画一张径向渐变的椭圆贴图，全局共用一张。 */
export function ensureShadowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SHADOW_KEY)) return;
  const canvas = document.createElement('canvas');
  canvas.width = STAMP_WIDTH;
  canvas.height = STAMP_WIDTH / 2;
  const context = canvas.getContext('2d')!;
  // 先压扁再画圆，得到等距视角下的椭圆
  context.translate(STAMP_WIDTH / 2, STAMP_WIDTH / 4);
  context.scale(1, 0.5);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, STAMP_WIDTH / 2);
  gradient.addColorStop(0, 'rgba(16, 12, 8, 0.5)');
  gradient.addColorStop(0.5, 'rgba(16, 12, 8, 0.32)');
  gradient.addColorStop(1, 'rgba(16, 12, 8, 0)');
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, STAMP_WIDTH / 2, 0, Math.PI * 2);
  context.fill();
  scene.textures.addCanvas(SHADOW_KEY, canvas);
}

/** 在脚底放一片阴影，宽度按精灵显示宽度算。 */
export function addContactShadow(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
): Phaser.GameObjects.Image {
  ensureShadowTexture(scene);
  return scene.add
    .image(x, y, SHADOW_KEY)
    .setDisplaySize(width, width / 2)
    .setDepth(y - SHADOW_DEPTH_GAP);
}

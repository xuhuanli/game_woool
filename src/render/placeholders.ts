import type Phaser from 'phaser';

/**
 * 占位美术：运行时画出和正式素材相同布局的精灵表。
 * 每行一个方向（0 东，顺时针），每列一帧，换成正式素材时保持 SHEET 布局即可。
 */
export const SHEET = {
  frameW: 96,
  frameH: 96,
  originY: 0.8,
  idle: [0],
  walk: [1, 2, 3, 4],
  attack: [5, 6, 7],
  columns: 8,
  rows: 8,
} as const;

type Painter = (ctx: CanvasRenderingContext2D, angle: number, column: number) => void;

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d')! };
}

function shadow(ctx: CanvasRenderingContext2D, radius: number): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 0, radius, radius * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

function walkPhase(column: number): number {
  const index = (SHEET.walk as readonly number[]).indexOf(column);
  return index < 0 ? 0 : Math.sin((index / SHEET.walk.length) * Math.PI * 2);
}

interface HeroLook {
  robe: string;
  trim: string;
  weapon: string;
  reach: number;
}

const HERO_LOOKS: Record<string, HeroLook> = {
  body: { robe: '#8c2f2a', trim: '#c9a24a', weapon: '#d9dee6', reach: 32 },
  spell: { robe: '#2f5a8c', trim: '#9fd0ff', weapon: '#9fd0ff', reach: 22 },
  spirit: { robe: '#3d7a4a', trim: '#e6d27a', weapon: '#7ddc6f', reach: 22 },
};

const paintHero = (look: HeroLook): Painter => (ctx, angle, column) => {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle) * 0.5;
  const swing = walkPhase(column);
  const attackIndex = (SHEET.attack as readonly number[]).indexOf(column);
  const lunge = attackIndex === 1 ? 8 : 0;

  shadow(ctx, 16);
  ctx.translate(dirX * lunge, dirY * lunge);

  const leg = (side: number, offset: number) => {
    ctx.strokeStyle = '#3a2a1c';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(side * 6, -18);
    ctx.lineTo(side * 6 + dirX * offset * 8, -2 + dirY * offset * 8);
    ctx.stroke();
  };
  leg(-1, swing);
  leg(1, -swing);

  const weaponAngle =
    attackIndex < 0 ? angle + 0.7 : angle + [-1.5, -0.1, 1.2][attackIndex]!;
  const sword = () => {
    const handX = dirX * 10;
    const handY = -32 + dirY * 10;
    ctx.strokeStyle = look.weapon;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(
      handX + Math.cos(weaponAngle) * look.reach,
      handY + Math.sin(weaponAngle) * look.reach * 0.7,
    );
    ctx.stroke();
  };
  const behind = dirY < 0;
  if (behind) sword();

  ctx.fillStyle = look.robe;
  ctx.beginPath();
  ctx.roundRect(-12, -42, 24, 28, 7);
  ctx.fill();
  ctx.fillStyle = look.trim;
  ctx.fillRect(-12, -22, 24, 4);

  ctx.fillStyle = '#e4bb92';
  ctx.beginPath();
  ctx.arc(dirX * 2, -50 + dirY * 2, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2b2118';
  ctx.beginPath();
  ctx.arc(-dirX * 3, -53 - dirY * 3, 9, 0, Math.PI * 2);
  ctx.fill();

  if (!behind) sword();
  if (attackIndex === 1) {
    ctx.strokeStyle = 'rgba(255, 245, 200, 0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, -30, 40, 24, 0, angle - 1.1, angle + 1.1);
    ctx.stroke();
  }
};

const paintBeast = (fur: string, head: string): Painter => (ctx, angle, column) => {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle) * 0.5;
  const hop = Math.abs(walkPhase(column)) * 5;
  const attackIndex = (SHEET.attack as readonly number[]).indexOf(column);
  const lunge = attackIndex === 1 ? 12 : 0;

  shadow(ctx, 15);
  ctx.translate(dirX * lunge, dirY * lunge - hop);

  ctx.strokeStyle = '#6d6252';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-dirX * 12, -9 - dirY * 12);
  ctx.quadraticCurveTo(-dirX * 26, -6 - dirY * 26, -dirX * 28, -16 - dirY * 28);
  ctx.stroke();

  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, -12, 17, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  const headX = dirX * 14;
  const headY = -15 + dirY * 14;
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.arc(headX, headY, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b5a68e';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(headX + side * 6, headY - 7, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#e8473a';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(headX + dirX * 4 + side * 3, headY + dirY * 4 - 1, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
};

function addSheet(scene: Phaser.Scene, key: string, paint: Painter): void {
  const { frameW, frameH, columns, rows, originY } = SHEET;
  const { canvas, ctx } = createCanvas(frameW * columns, frameH * rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      ctx.save();
      ctx.translate((column + 0.5) * frameW, (row + originY) * frameH);
      paint(ctx, (row * Math.PI) / 4, column);
      ctx.restore();
    }
  }

  const texture = scene.textures.addCanvas(key, canvas);
  if (!texture) throw new Error(`无法创建贴图：${key}`);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      texture.add(row * columns + column, 0, column * frameW, row * frameH, frameW, frameH);
    }
  }

  const clip = (name: string, columnsOfClip: readonly number[], frameRate: number, repeat: number) => {
    for (let row = 0; row < rows; row++) {
      scene.anims.create({
        key: `${key}-${name}-${row}`,
        frames: columnsOfClip.map((column) => ({ key, frame: row * columns + column })),
        frameRate,
        repeat,
      });
    }
  };
  clip('idle', SHEET.idle, 1, -1);
  clip('walk', SHEET.walk, 10, -1);
  clip('attack', SHEET.attack, 10, 0);
}

function addImage(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): void {
  const { canvas, ctx } = createCanvas(width, height);
  paint(ctx);
  scene.textures.addCanvas(key, canvas);
}

export function createPlaceholderArt(scene: Phaser.Scene): void {
  for (const [classId, look] of Object.entries(HERO_LOOKS)) {
    addSheet(scene, classId, paintHero(look));
  }
  addSheet(scene, 'ash-rat', paintBeast('#7d7566', '#918876'));
  addSheet(scene, 'gold-bug', paintBeast('#c79a2e', '#e6c35c'));

  addImage(scene, 'rock', 64, 64, (ctx) => {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(32, 48, 28, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5c584f';
    ctx.beginPath();
    ctx.moveTo(6, 46);
    ctx.lineTo(16, 18);
    ctx.lineTo(36, 8);
    ctx.lineTo(56, 26);
    ctx.lineTo(58, 46);
    ctx.lineTo(32, 56);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#77726a';
    ctx.beginPath();
    ctx.moveTo(16, 18);
    ctx.lineTo(36, 8);
    ctx.lineTo(40, 30);
    ctx.lineTo(22, 36);
    ctx.closePath();
    ctx.fill();
  });

  addImage(scene, 'item-gold', 24, 16, (ctx) => {
    ctx.fillStyle = '#f0c63e';
    for (const [x, y] of [[8, 9], [15, 10], [12, 6]] as const) {
      ctx.beginPath();
      ctx.ellipse(x, y, 6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#a07c14';
      ctx.stroke();
    }
  });

  addImage(scene, 'item-potion', 16, 24, (ctx) => {
    ctx.fillStyle = '#d9d2c0';
    ctx.fillRect(6, 1, 4, 6);
    ctx.fillStyle = '#d83a30';
    ctx.beginPath();
    ctx.arc(8, 15, 7, 0, Math.PI * 2);
    ctx.fill();
  });

  addImage(scene, 'item-material', 20, 20, (ctx) => {
    ctx.fillStyle = '#b48cff';
    ctx.beginPath();
    ctx.moveTo(10, 1);
    ctx.lineTo(18, 10);
    ctx.lineTo(10, 19);
    ctx.lineTo(2, 10);
    ctx.closePath();
    ctx.fill();
  });

  addImage(scene, 'item-equip', 32, 32, (ctx) => {
    ctx.strokeStyle = '#d9dee6';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(5, 27);
    ctx.lineTo(27, 5);
    ctx.stroke();
    ctx.strokeStyle = '#c9a24a';
    ctx.beginPath();
    ctx.moveTo(6, 19);
    ctx.lineTo(13, 26);
    ctx.stroke();
  });
}

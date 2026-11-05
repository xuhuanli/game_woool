import Phaser from 'phaser';
import type { Cell } from '../game/config';
import { cellDistance } from '../game/grid';
import type { Field, Unit } from '../game/types';
import { TILE_H, TILE_W, toScreen } from './iso';

export const FONT = '"PingFang SC", "Microsoft YaHei", sans-serif';
export const UI_DEPTH = 1_000_000;
/** 怪物留下的地面比玩家的更实，提醒玩家走开 */
const HOSTILE_FIELD_ALPHA = 0.2;

export function diamond(x: number, y: number): Phaser.Math.Vector2[] {
  return [
    new Phaser.Math.Vector2(x, y - TILE_H / 2),
    new Phaser.Math.Vector2(x + TILE_W / 2, y),
    new Phaser.Math.Vector2(x, y + TILE_H / 2),
    new Phaser.Math.Vector2(x - TILE_W / 2, y),
  ];
}

const tintOf = (color: string) => Phaser.Display.Color.HexStringToColor(color).color;

/** 战斗特效：飘字、弹道、技能闪光、Boss 预警和留在地上的伤害区域。 */
export class Effects {
  private readonly fieldViews = new Map<number, Phaser.GameObjects.Graphics>();

  constructor(private readonly scene: Phaser.Scene) {}

  floatText(unit: Unit, text: string, color: string, size: number): void {
    const { scene } = this;
    const { x, y } = toScreen(unit.pos);
    const label = scene.add
      .text(x + Phaser.Math.Between(-10, 10), y - 62, text, {
        fontFamily: FONT,
        fontSize: `${size}px`,
        fontStyle: 'bold',
        color,
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(UI_DEPTH);
    scene.tweens.add({
      targets: label,
      y: label.y - 36,
      alpha: 0,
      duration: 750,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  /** 远程出手时从施法者飞向目标的光球，飞行时间等于前摇。 */
  projectile(unit: Unit, target: Unit, color: string | null): void {
    if (cellDistance(unit.cell, target.cell) <= 1) return;
    const { scene } = this;
    const from = toScreen(unit.pos);
    const to = toScreen(target.pos);
    const orb = scene.add.circle(from.x, from.y - 34, 6, tintOf(color ?? '#ffe9b0')).setDepth(UI_DEPTH - 3);
    scene.tweens.add({
      targets: orb,
      x: to.x,
      y: to.y - 20,
      duration: unit.windupLeft * 1000,
      onComplete: () => orb.destroy(),
    });
  }

  /** 技能命中的格子闪一下；没有范围的技能在施法者身上放一圈光环。 */
  skill(unit: Unit, color: string, cells: Cell[]): void {
    const { scene } = this;
    const tint = tintOf(color);
    for (const cell of cells) {
      const { x, y } = toScreen(cell);
      const flash = scene.add.graphics().setDepth(2).setAlpha(0.8);
      flash.fillStyle(tint, 1).fillPoints(diamond(x, y), true);
      scene.tweens.add({ targets: flash, alpha: 0, duration: 350, onComplete: () => flash.destroy() });
    }
    if (cells.length === 0) {
      const { x, y } = toScreen(unit.pos);
      this.ring(x, y - 24, 14, tint, 3, 450);
    }
  }

  /** 从一点向外扩散的光圈。 */
  ring(x: number, y: number, radius: number, tint: number, scale: number, duration: number): void {
    const { scene } = this;
    const ring = scene.add.circle(x, y, radius).setStrokeStyle(3, tint).setDepth(UI_DEPTH - 3);
    scene.tweens.add({ targets: ring, scale, alpha: 0, duration, onComplete: () => ring.destroy() });
  }

  /** Boss 技能的地面预警，颜色越来越实，时间到时消失。 */
  telegraph(cells: Cell[], seconds: number, color: string): void {
    const { scene } = this;
    const zone = scene.add.graphics().setDepth(2).setAlpha(0.25);
    zone.fillStyle(tintOf(color), 1);
    for (const cell of cells) {
      const { x, y } = toScreen(cell);
      zone.fillPoints(diamond(x, y), true);
    }
    scene.tweens.add({ targets: zone, alpha: 0.75, duration: seconds * 1000, onComplete: () => zone.destroy() });
  }

  /** 火墙、毒瘴、血海等地面：放下时画出，持续期间闪动，结束时淡出。 */
  syncFields(fields: Field[]): void {
    const { scene } = this;
    const live = new Set(fields.map((field) => field.id));
    for (const [id, view] of this.fieldViews) {
      if (live.has(id)) continue;
      this.fieldViews.delete(id);
      scene.tweens.add({ targets: view, alpha: 0, duration: 300, onComplete: () => view.destroy() });
    }
    const pulse = 0.35 + Math.sin(scene.time.now / 160) * 0.1;
    for (const field of fields) {
      let view = this.fieldViews.get(field.id);
      if (!view) {
        view = scene.add.graphics().setDepth(2);
        for (const cell of field.cells) {
          const { x, y } = toScreen(cell);
          view.fillStyle(tintOf(field.color), 1).fillPoints(diamond(x, y), true);
        }
        this.fieldViews.set(field.id, view);
      }
      view.setAlpha(pulse + (field.hostile ? HOSTILE_FIELD_ALPHA : 0));
    }
  }
}

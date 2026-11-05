import Phaser from 'phaser';
import type { GameConfig } from '../game/config';
import { equipmentColor, equipmentName } from '../game/equipment';
import type { GroundItem } from '../game/types';
import { FONT, UI_DEPTH } from './effects';
import { toScreen } from './iso';

const PILLAR_HEIGHT = 150;
const FLY_MS = 260;

interface ItemView {
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  /** 高品阶法器的光柱 */
  pillar: Phaser.GameObjects.Graphics | null;
}

/** 地上掉落物的显示：图标、名字、高品阶光柱，以及被吸走时飞向角色。 */
export class DropViews {
  /** 这个品阶及以上的法器落地时有光柱 */
  static readonly PILLAR_GRADE = 2;
  private readonly views = new Map<GroundItem, ItemView>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly config: GameConfig,
  ) {}

  /** 地上物品用图标，没有图标时用占位图。 */
  private texture(item: GroundItem): string {
    const icon = `icon-${item.def.id}`;
    return this.scene.textures.exists(icon) ? icon : `item-${item.def.kind}`;
  }

  label(item: GroundItem): string {
    return item.equipment ? equipmentName(item.equipment, this.config) : item.def.name;
  }

  /** 法器品阶的序号，不是法器时是 -1。 */
  gradeRank(item: GroundItem): number {
    return this.config.affixes.grades.findIndex((grade) => grade.id === item.equipment?.grade);
  }

  show(item: GroundItem): void {
    const { scene } = this;
    const { x, y } = toScreen(item.cell);
    const sprite = scene.add
      .image(x, y - 26, this.texture(item))
      .setOrigin(0.5, 0.75)
      .setDepth(y - 1);
    const label = scene.add
      .text(x, y - 22, this.label(item), {
        fontFamily: FONT,
        fontSize: '12px',
        color: item.equipment ? equipmentColor(item.equipment, this.config) : '#efe6d0',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(UI_DEPTH - 2);
    scene.tweens.add({ targets: sprite, y, duration: 320, ease: 'Bounce.easeOut' });
    const pillar = this.gradeRank(item) >= DropViews.PILLAR_GRADE ? this.addPillar(x, y, item) : null;
    this.views.set(item, { sprite, label, pillar });
  }

  /** 高品阶法器落地时的光柱，隔着半屏也能看到。 */
  private addPillar(x: number, y: number, item: GroundItem): Phaser.GameObjects.Graphics {
    const color = Phaser.Display.Color.HexStringToColor(equipmentColor(item.equipment!, this.config)).color;
    const pillar = this.scene.add.graphics().setDepth(y - 2);
    pillar.fillGradientStyle(color, color, color, color, 0, 0, 0.7, 0.7);
    pillar.fillRect(x - 9, y - PILLAR_HEIGHT, 18, PILLAR_HEIGHT);
    this.scene.tweens.add({ targets: pillar, alpha: 0.45, duration: 700, yoyo: true, repeat: -1 });
    return pillar;
  }

  remove(item: GroundItem): void {
    const view = this.views.get(item);
    if (!view) return;
    view.sprite.destroy();
    view.label.destroy();
    view.pillar?.destroy();
    this.views.delete(item);
  }

  clear(): void {
    for (const item of [...this.views.keys()]) this.remove(item);
  }

  /** 吸取时图标从地上飞到角色身上。 */
  flyTo(item: GroundItem, target: { x: number; y: number }): void {
    const from = toScreen(item.cell);
    const sprite = this.scene.add.image(from.x, from.y, this.texture(item)).setDepth(UI_DEPTH - 3);
    this.scene.tweens.add({
      targets: sprite,
      x: target.x,
      y: target.y - 24,
      scale: 0.6,
      duration: FLY_MS,
      ease: 'Quad.easeIn',
      onComplete: () => sprite.destroy(),
    });
  }
}

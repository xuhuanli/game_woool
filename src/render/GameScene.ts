import Phaser from 'phaser';
import type { Cell, NpcDef, SkillDef } from '../game/config';
import { equipmentColor, equipmentName } from '../game/equipment';
import { cellDistance, sameCell } from '../game/grid';
import { questsForNpc, questStatus } from '../game/quests';
import {
  TICK_SECONDS,
  type GameEvent,
  type GroundItem,
  type Monster,
  type Summon,
  type Unit,
  type Vec,
  type World,
} from '../game/world';
import type { AutoSaver } from '../save/autoSaver';
import type { AutoPanel } from '../ui/autoPanel';
import type { Hud } from '../ui/hud';
import type { NpcPanel } from '../ui/npcPanel';
import type { Panels } from '../ui/panels';
import { directionRow, TILE_H, TILE_W, toCell, toScreen } from './iso';
import { createPlaceholderArt, SHEET } from './placeholders';

const FONT = '"PingFang SC", "Microsoft YaHei", sans-serif';
const HOLD_REPATH_MS = 200;
const MAX_FRAME_MS = 250;
const UI_DEPTH = 1_000_000;
const TARGET_RADIUS = 34;
const TARGET_CENTER_OFFSET = 20;
const HOVER_TINT = 0xffc0a0;

interface UnitView {
  unit: Unit;
  texture: string;
  sprite: Phaser.GameObjects.Sprite;
  hpBar: Phaser.GameObjects.Graphics | null;
  previous: Vec;
  attacking: boolean;
}

interface NpcView {
  npc: NpcDef;
  marker: Phaser.GameObjects.Text;
}

interface ItemView {
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
}

export class GameScene extends Phaser.Scene {
  private readonly unitViews = new Map<Unit, UnitView>();
  private readonly itemViews = new Map<GroundItem, ItemView>();
  private npcViews: NpcView[] = [];
  private mapObjects: { destroy(): void }[] = [];
  private accumulator = 0;
  private holding = false;
  private holdTimer = 0;
  private hovered: UnitView | null = null;
  private tileCursor!: Phaser.GameObjects.Graphics;

  constructor(
    private readonly world: World,
    private readonly hud: Hud,
    private readonly panels: Panels,
    private readonly saver: AutoSaver,
    private readonly npcPanel: NpcPanel,
    private readonly autoPanel: AutoPanel,
  ) {
    super('game');
  }

  create(): void {
    createPlaceholderArt(this, this.world.config);

    this.tileCursor = this.add.graphics().setDepth(1);
    this.addUnitView(this.world.player, this.world.player.def.id);
    this.buildMap();

    const follow = this.unitViews.get(this.world.player)!.sprite;
    this.cameras.main.startFollow(follow, true, 0.12, 0.12);
    this.cameras.main.centerOn(follow.x, follow.y);

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointerup', () => (this.holding = false));

    const keyboard = this.input.keyboard!;
    const digits = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'];
    digits.forEach((digit, slot) => {
      keyboard.addCapture(`F${slot + 1}`);
      keyboard.on(`keydown-F${slot + 1}`, () => this.useSlot(slot));
      keyboard.on(`keydown-${digit}`, () => this.useSlot(slot));
    });
    this.hud.onSlot = (slot) => this.useSlot(slot);

    this.hud.log(`来到${this.world.map.name}`);
  }

  override update(_time: number, delta: number): void {
    this.accumulator += Math.min(delta, MAX_FRAME_MS);
    const stepMs = TICK_SECONDS * 1000;
    while (this.accumulator >= stepMs) {
      for (const view of this.unitViews.values()) view.previous = { ...view.unit.pos };
      this.world.tick();
      this.accumulator -= stepMs;
    }

    for (const event of this.world.drainEvents()) {
      this.handleEvent(event);
      this.saver.notify(event);
    }
    this.saver.update(delta / 1000);

    const alpha = this.accumulator / stepMs;
    for (const view of this.unitViews.values()) this.syncUnit(view, alpha);

    this.updatePointer(delta);
    this.updateNpcMarkers();
    this.hud.update(this.world);
    this.panels.update();
    this.npcPanel.update();
    this.autoPanel.update();
  }

  // ---- 场景搭建 ----

  /** 按当前地图重建地面、NPC、传送点和怪物显示。 */
  private buildMap(): void {
    for (const object of this.mapObjects) object.destroy();
    this.mapObjects = [];
    this.npcViews = [];
    for (const view of [...this.unitViews.values()]) {
      if ((view.unit as Monster).kind === 'monster') this.removeUnitView(view);
    }
    for (const item of [...this.itemViews.keys()]) this.removeItemView(item);

    this.drawGround();
    for (const portal of this.world.portals) this.addPortal(portal.x, portal.y, portal.name);
    for (const npc of this.world.npcs) this.addNpc(npc);
    for (const monster of this.world.monsters) {
      this.addUnitView(monster, monster.def.id, monster.def.look.scale);
      if (!monster.hp) this.unitViews.get(monster)!.sprite.setAlpha(0);
    }
    for (const view of this.unitViews.values()) view.previous = { ...view.unit.pos };
    for (const item of this.world.items) this.showDrop(item, false);
  }

  private drawGround(): void {
    const { grid } = this.world;
    const safe = this.world.map.safe;
    const palette = safe ? [0x5d6650, 0x59624c, 0x626b55] : [0x4a5a34, 0x46552f, 0x4f6038];
    const ground = this.add.graphics().setDepth(0);
    this.mapObjects.push(ground);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const { x: sx, y: sy } = toScreen({ x, y });
        ground.fillStyle(palette[(x * 7 + y * 13) % 3]!, 1);
        ground.fillPoints(diamond(sx, sy), true);
        const isNpc = this.world.npcs.some((npc) => npc.x === x && npc.y === y);
        if (!grid.isWalkable({ x, y }) && !isNpc) {
          this.mapObjects.push(this.add.image(sx, sy, 'rock').setOrigin(0.5, 0.75).setDepth(sy));
        }
      }
    }
  }

  private addPortal(x: number, y: number, name: string): void {
    const screen = toScreen({ x, y });
    const ring = this.add.image(screen.x, screen.y, 'portal').setDepth(2);
    this.tweens.add({ targets: ring, alpha: 0.5, duration: 800, yoyo: true, repeat: -1 });
    this.mapObjects.push(ring, this.addLabel(screen.x, screen.y - 22, name, '#d9c8ff'));
  }

  private addNpc(npc: NpcDef): void {
    const { x, y } = toScreen(npc);
    const sprite = this.add
      .sprite(x, y, `npc-${npc.id}`, SHEET.columns * 2)
      .setOrigin(0.5, SHEET.originY)
      .setDepth(y);
    const label = this.addLabel(x, y - 66, npc.name, '#9fe0ff');
    const marker = this.addLabel(x, y - 84, '', '#ffd84a').setFontSize(22);
    this.mapObjects.push(sprite, label, marker);
    this.npcViews.push({ npc, marker });
  }

  private addLabel(x: number, y: number, text: string, color: string): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, text, {
        fontFamily: FONT,
        fontSize: '13px',
        color,
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(UI_DEPTH - 2);
  }

  private updateNpcMarkers(): void {
    const { player, config } = this.world;
    for (const { npc, marker } of this.npcViews) {
      const statuses = questsForNpc(config, npc.id).map((quest) =>
        questStatus(quest, player.quests, player.level, player.bag),
      );
      const text = statuses.includes('ready') ? '?' : statuses.includes('available') ? '!' : '';
      if (marker.text !== text) marker.setText(text);
    }
  }

  private addUnitView(unit: Unit, texture: string, scale = 1): void {
    const { x, y } = toScreen(unit.pos);
    const sprite = this.add.sprite(x, y, texture, 0).setOrigin(0.5, SHEET.originY).setScale(scale);
    const hpBar = unit === this.world.player ? null : this.add.graphics().setDepth(UI_DEPTH - 1);
    this.unitViews.set(unit, {
      unit,
      texture,
      sprite,
      hpBar,
      previous: { ...unit.pos },
      attacking: false,
    });
  }

  // ---- 每帧同步 ----

  private syncUnit(view: UnitView, alpha: number): void {
    const { unit, sprite } = view;
    const screen = toScreen({
      x: view.previous.x + (unit.pos.x - view.previous.x) * alpha,
      y: view.previous.y + (unit.pos.y - view.previous.y) * alpha,
    });
    sprite.setPosition(screen.x, screen.y).setDepth(screen.y);

    if (unit.hp > 0 && !view.attacking) {
      const moving = unit.path.length > 0 || unit.pos.x !== unit.cell.x || unit.pos.y !== unit.cell.y;
      sprite.play(`${view.texture}-${moving ? 'walk' : 'idle'}-${directionRow(unit.facing)}`, true);
    }

    if (view.hpBar) {
      view.hpBar.clear();
      if (unit.hp > 0 && unit.hp < unit.stats.maxHp) {
        const width = 40;
        const left = screen.x - width / 2;
        const barY = screen.y - 44 * view.sprite.scale;
        view.hpBar.fillStyle(0x000000, 0.7).fillRect(left - 1, barY - 1, width + 2, 6);
        view.hpBar.fillStyle(0xd83a30, 1).fillRect(left, barY, (width * unit.hp) / unit.stats.maxHp, 4);
      }
    }
  }

  private updatePointer(delta: number): void {
    const pointer = this.input.activePointer;
    const world = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;

    const hovered = this.monsterAt(world.x, world.y);
    const hoveredView = hovered ? this.unitViews.get(hovered)! : null;
    if (hoveredView !== this.hovered) {
      this.hovered?.sprite.clearTint();
      hoveredView?.sprite.setTint(HOVER_TINT);
      this.hovered = hoveredView;
    }
    const clickable = hovered || this.npcAt(world.x, world.y) || this.itemAt(world.x, world.y);
    this.input.setDefaultCursor(clickable ? 'pointer' : 'default');

    const cell = toCell(world.x, world.y);
    this.tileCursor.clear();
    if (this.world.grid.isWalkable(cell)) {
      const { x, y } = toScreen(cell);
      this.tileCursor.lineStyle(1, 0xf0e0a0, 0.5).strokePoints(diamond(x, y), true, true);
    }

    if (this.holding && pointer.isDown) {
      this.holdTimer -= delta;
      if (this.holdTimer <= 0) {
        this.holdTimer = HOLD_REPATH_MS;
        this.world.moveTo(cell);
      }
    }
  }

  // ---- 输入 ----

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (!pointer.leftButtonDown()) return;
    const world = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;

    const monster = this.monsterAt(world.x, world.y);
    if (monster) {
      this.world.attack(monster);
      return;
    }
    const npc = this.npcAt(world.x, world.y);
    if (npc) {
      this.world.talkTo(npc);
      return;
    }
    const item = this.itemAt(world.x, world.y);
    if (item) {
      this.world.pickup(item);
      return;
    }
    this.holding = true;
    this.holdTimer = HOLD_REPATH_MS;
    this.world.moveTo(toCell(world.x, world.y));
  }

  private useSlot(slot: number): void {
    const hovered = this.hovered?.unit;
    this.world.useHotbar(slot, hovered?.hp ? (hovered as Monster) : null);
  }

  private monsterAt(worldX: number, worldY: number): Monster | null {
    let best: Monster | null = null;
    let bestDistance = TARGET_RADIUS;
    for (const monster of this.world.monsters) {
      if (!monster.hp) continue;
      const screen = toScreen(monster.pos);
      const distance = Phaser.Math.Distance.Between(
        worldX,
        worldY,
        screen.x,
        screen.y - TARGET_CENTER_OFFSET,
      );
      if (distance < bestDistance) {
        best = monster;
        bestDistance = distance;
      }
    }
    return best;
  }

  private npcAt(worldX: number, worldY: number): NpcDef | null {
    for (const npc of this.world.npcs) {
      const screen = toScreen(npc);
      const distance = Phaser.Math.Distance.Between(worldX, worldY, screen.x, screen.y - 30);
      if (distance < TARGET_RADIUS) return npc;
    }
    return null;
  }

  private itemAt(worldX: number, worldY: number): GroundItem | null {
    const cell = toCell(worldX, worldY);
    return this.world.items.find((item) => sameCell(item.cell, cell)) ?? null;
  }

  // ---- 事件与反馈 ----

  private handleEvent(event: GameEvent): void {
    switch (event.type) {
      case 'attackStart':
        this.playAttack(event.unit);
        if (event.target) this.showProjectile(event.unit, event.target, event.color);
        break;
      case 'skillCast':
        this.showSkill(event.unit, event.skill, event.cells);
        break;
      case 'skillLearned':
        this.hud.log(`领悟功法：${event.skill.name}`, 'gain');
        break;
      case 'summoned':
        this.addUnitView(event.unit, event.unit.def.id);
        break;
      case 'damage':
        this.showDamage(event.unit, event.amount, event.maxRoll);
        break;
      case 'miss':
        this.floatText(event.unit, '闪避', '#c8c8c8', 14);
        break;
      case 'death':
        this.playDeath(event.unit);
        break;
      case 'respawn':
        this.playRespawn(event.unit);
        break;
      case 'itemDropped':
        this.showDrop(event.item);
        break;
      case 'itemRemoved':
        this.removeItemView(event.item);
        break;
      case 'pickedUp': {
        const { def, amount } = event.item;
        const name = this.itemLabel(event.item);
        this.hud.log(def.kind === 'gold' ? `获得 ${amount} 灵石` : `拾取 ${name}`, 'gain');
        this.floatText(this.world.player, `+${def.kind === 'gold' ? amount : name}`, '#f0cf7a', 15);
        break;
      }
      case 'equipped':
        this.hud.log(`装备 ${equipmentName(event.equipment, this.world.config)}`, 'gain');
        break;
      case 'refined': {
        const name = equipmentName(event.equipment, this.world.config);
        this.hud.log(event.success ? `祭炼成功：${name}` : `祭炼失败：${name}`, event.success ? 'gain' : 'bad');
        break;
      }
      case 'heal':
        this.floatText(this.world.player, `+${event.amount}`, '#7be07b', 18);
        break;
      case 'mana':
        this.floatText(this.world.player, `+${event.amount}`, '#7bb8ff', 18);
        break;
      case 'breakthrough':
        this.showBreakthrough(event.realm, event.success);
        break;
      case 'deathDrop':
        this.hud.log(`${event.name} 掉在了原地，限时可捡回`, 'bad');
        break;
      case 'mapChanged':
        this.buildMap();
        this.hud.log(`来到${this.world.map.name}`);
        break;
      case 'npcOpened':
        this.npcPanel.open(event.npc);
        break;
      case 'questAccepted':
        this.hud.log(`接受任务：${event.name}`, 'gain');
        break;
      case 'questProgress':
        this.hud.log(`任务进度：${event.name}`);
        break;
      case 'questCompleted':
        this.hud.log(`完成任务：${event.name}`, 'gain');
        break;
      case 'goldChanged':
        this.hud.log(`灵石 ${event.amount > 0 ? '+' : ''}${event.amount}`);
        break;
      case 'expGained':
        this.hud.log(`获得 ${event.amount} 点经验`);
        break;
      case 'levelUp':
        this.showLevelUp(event.level);
        break;
      case 'message':
        this.hud.log(event.text, 'bad');
        break;
    }
  }

  private playAttack(unit: Unit): void {
    const view = this.unitViews.get(unit);
    if (!view) return;
    view.attacking = true;
    const key = `${view.texture}-attack-${directionRow(unit.facing)}`;
    const duration = Math.max(unit.attackWindup * 1000 * 1.5, 240);
    view.sprite.play({ key, duration });
    view.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      view.attacking = false;
    });
  }

  private showDamage(unit: Unit, amount: number, maxRoll: boolean): void {
    const view = this.unitViews.get(unit);
    if (!view) return;
    const isPlayer = unit === this.world.player;
    this.floatText(unit, String(amount), isPlayer ? '#ff6a5a' : maxRoll ? '#ffd84a' : '#ffffff', maxRoll ? 24 : 18);

    view.sprite.setTintFill(0xffffff);
    this.time.delayedCall(70, () => {
      view.sprite.clearTint();
      if (this.hovered === view) view.sprite.setTint(HOVER_TINT);
    });
    if (maxRoll && !isPlayer) this.cameras.main.shake(70, 0.002);
    if (isPlayer) this.cameras.main.shake(90, 0.003);
  }

  private playDeath(unit: Unit): void {
    const view = this.unitViews.get(unit);
    if (!view) return;
    view.attacking = false;
    view.sprite.stop();
    this.tweens.add({
      targets: view.sprite,
      alpha: 0,
      y: view.sprite.y + 6,
      angle: 80,
      duration: 500,
      ease: 'Quad.easeIn',
      onComplete: () => {
        if ((unit as Summon).kind === 'summon') this.removeUnitView(view);
      },
    });
  }

  private removeUnitView(view: UnitView): void {
    if (this.hovered === view) this.hovered = null;
    view.sprite.destroy();
    view.hpBar?.destroy();
    this.unitViews.delete(view.unit);
  }

  private showProjectile(unit: Unit, target: Unit, color: string | null): void {
    if (cellDistance(unit.cell, target.cell) <= 1) return;
    const from = toScreen(unit.pos);
    const to = toScreen(target.pos);
    const tint = Phaser.Display.Color.HexStringToColor(color ?? '#ffe9b0').color;
    const orb = this.add.circle(from.x, from.y - 34, 6, tint).setDepth(UI_DEPTH - 3);
    this.tweens.add({
      targets: orb,
      x: to.x,
      y: to.y - 20,
      duration: unit.windupLeft * 1000,
      onComplete: () => orb.destroy(),
    });
  }

  private showSkill(unit: Unit, skill: SkillDef, cells: Cell[]): void {
    const tint = Phaser.Display.Color.HexStringToColor(skill.color).color;
    for (const cell of cells) {
      const { x, y } = toScreen(cell);
      const flash = this.add.graphics().setDepth(2).setAlpha(0.8);
      flash.fillStyle(tint, 1).fillPoints(diamond(x, y), true);
      this.tweens.add({
        targets: flash,
        alpha: 0,
        duration: 350,
        onComplete: () => flash.destroy(),
      });
    }
    if (cells.length === 0) {
      const { x, y } = toScreen(unit.pos);
      const ring = this.add.circle(x, y - 24, 14).setStrokeStyle(3, tint).setDepth(UI_DEPTH - 3);
      this.tweens.add({
        targets: ring,
        scale: 3,
        alpha: 0,
        duration: 450,
        onComplete: () => ring.destroy(),
      });
    }
  }

  private playRespawn(unit: Unit): void {
    const view = this.unitViews.get(unit);
    if (!view) return;
    this.tweens.killTweensOf(view.sprite);
    view.previous = { ...unit.pos };
    view.sprite.setAngle(0).setAlpha(0);
    this.tweens.add({ targets: view.sprite, alpha: 1, duration: 400 });
  }

  private showDrop(item: GroundItem, announce = true): void {
    const { x, y } = toScreen(item.cell);
    const sprite = this.add
      .image(x, y - 26, `item-${item.def.kind}`)
      .setOrigin(0.5, 0.75)
      .setDepth(y - 1);
    const label = this.add
      .text(x, y - 22, this.itemLabel(item), {
        fontFamily: FONT,
        fontSize: '12px',
        color: item.equipment ? equipmentColor(item.equipment, this.world.config) : '#efe6d0',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(UI_DEPTH - 2);
    this.tweens.add({ targets: sprite, y, duration: 320, ease: 'Bounce.easeOut' });
    this.itemViews.set(item, { sprite, label });
    if (announce && item.equipment) this.hud.log(`掉落了 ${this.itemLabel(item)}！`, 'gain');
  }

  private itemLabel(item: GroundItem): string {
    return item.equipment ? equipmentName(item.equipment, this.world.config) : item.def.name;
  }

  private removeItemView(item: GroundItem): void {
    const view = this.itemViews.get(item);
    if (!view) return;
    view.sprite.destroy();
    view.label.destroy();
    this.itemViews.delete(item);
  }

  private showBreakthrough(realm: string, success: boolean): void {
    if (!success) {
      this.hud.log('突破失败，材料已消耗', 'bad');
      this.floatText(this.world.player, '突破失败', '#ff6a5a', 24);
      return;
    }
    this.hud.log(`突破成功，${realm}圆满！`, 'gain');
    this.floatText(this.world.player, '突破成功！', '#ffd84a', 28);
    this.cameras.main.flash(300, 255, 240, 200);
  }

  private showLevelUp(level: number): void {
    this.hud.log(`升到了 ${level} 级！`, 'gain');
    this.floatText(this.world.player, `升级！Lv.${level}`, '#ffd84a', 26);
    const { x, y } = toScreen(this.world.player.pos);
    const ring = this.add.circle(x, y - 24, 12).setStrokeStyle(3, 0xffd84a).setDepth(UI_DEPTH - 3);
    this.tweens.add({
      targets: ring,
      scale: 5,
      alpha: 0,
      duration: 600,
      onComplete: () => ring.destroy(),
    });
  }

  private floatText(unit: Unit, text: string, color: string, size: number): void {
    const { x, y } = toScreen(unit.pos);
    const label = this.add
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
    this.tweens.add({
      targets: label,
      y: label.y - 36,
      alpha: 0,
      duration: 750,
      ease: 'Cubic.easeOut',
      onComplete: () => label.destroy(),
    });
  }
}

function diamond(x: number, y: number): Phaser.Math.Vector2[] {
  return [
    new Phaser.Math.Vector2(x, y - TILE_H / 2),
    new Phaser.Math.Vector2(x + TILE_W / 2, y),
    new Phaser.Math.Vector2(x, y + TILE_H / 2),
    new Phaser.Math.Vector2(x - TILE_W / 2, y),
  ];
}

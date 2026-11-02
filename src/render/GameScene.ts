import Phaser from 'phaser';
import type { Cell, DecorDef, NpcDef, SkillDef } from '../game/config';
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
import { GameAudio } from './audio';
import { directionRow, TILE_H, TILE_W, toCell, toScreen } from './iso';
import {
  createPlaceholderArt,
  createSpriteAnimations,
  SHEET,
  type PropManifest,
  type SpriteManifests,
} from './placeholders';
import { paintGround } from './groundPainter';

const FONT = '"PingFang SC", "Microsoft YaHei", sans-serif';
const HOLD_REPATH_MS = 200;
const MAX_FRAME_MS = 250;
const UI_DEPTH = 1_000_000;
const TARGET_RADIUS = 34;
const TARGET_CENTER_OFFSET = 20;
const HOVER_TINT = 0xffc0a0;
/** 景观精灵按两倍精度烘焙 */
const PROP_DISPLAY_SCALE = 0.5;
const TONE_SIZE = 4000;
const DECOR_FADE_MS = 120;
const DECOR_FADED_ALPHA = 0.4;
const PLAYER_HEIGHT = 60;
const SOLID_NEAR_CELLS = 3;
const DIRT_COLOR = 0x7a6a4a;
const GOLD_MERGE_MS = 1000;
const PILLAR_HEIGHT = 150;
/** 上品及以上有光柱 */
const PILLAR_GRADE = 2;
const FLY_MS = 260;

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
  /** 高品阶法器的光柱 */
  pillar: Phaser.GameObjects.Graphics | null;
}

export class GameScene extends Phaser.Scene {
  private readonly unitViews = new Map<Unit, UnitView>();
  private readonly itemViews = new Map<GroundItem, ItemView>();
  private npcViews: NpcView[] = [];
  private mapObjects: { destroy(): void }[] = [];
  private accumulator = 0;
  private holding = false;
  private holdRunning = false;
  private holdTimer = 0;
  private pendingGold = 0;
  private readonly audio = new GameAudio();
  private hovered: UnitView | null = null;
  private tallDecor: Phaser.GameObjects.Image[] = [];
  private solidDecor: { image: Phaser.GameObjects.Image; foot: NonNullable<DecorDef['foot']> }[] = [];
  private fadeTimer = 0;
  private tileCursor!: Phaser.GameObjects.Graphics;

  constructor(
    private readonly world: World,
    private readonly hud: Hud,
    private readonly panels: Panels,
    private readonly saver: AutoSaver,
    private readonly npcPanel: NpcPanel,
    private readonly autoPanel: AutoPanel,
    private readonly sprites: SpriteManifests,
    private readonly props: PropManifest,
  ) {
    super('game');
  }

  preload(): void {
    for (const [key, manifest] of Object.entries(this.sprites)) {
      this.load.spritesheet(key, `${import.meta.env.BASE_URL}assets/sprites/${key}.png`, {
        frameWidth: manifest.frameW,
        frameHeight: manifest.frameH,
      });
    }
    for (const key of Object.keys(this.props)) {
      this.load.image(`prop-${key}`, `${import.meta.env.BASE_URL}assets/props/${key}.png`);
    }
  }

  create(): void {
    createPlaceholderArt(this, this.world.config, this.sprites);
    createSpriteAnimations(this, this.sprites);

    this.tileCursor = this.add.graphics().setDepth(1);
    this.addUnitView(this.world.player, this.world.player.def.id);
    this.buildMap();

    const follow = this.unitViews.get(this.world.player)!.sprite;
    this.cameras.main.startFollow(follow, true, 0.12, 0.12);
    this.cameras.main.centerOn(follow.x, follow.y);

    this.input.mouse?.disableContextMenu();
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
    keyboard.addCapture('SPACE');
    keyboard.on('keydown-SPACE', () => this.world.pickupNearbyEquipment());
    keyboard.on('keydown-T', () => this.world.useTeleportRing());
    keyboard.on('keydown-M', () => {
      this.hud.log(this.audio.toggleMute() ? '已静音' : '已开启声音');
    });
    const unlockAudio = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });

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
    this.fadeDecorAroundPlayer(delta);
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
    if (this.world.map.decor?.length) {
      this.drawScenery();
      return;
    }
    const { grid } = this.world;
    const { safe, ground: tiles } = this.world.map;
    const palette = safe
      ? [0x5d6650, 0x59624c, 0x626b55, DIRT_COLOR]
      : [0x4a5a34, 0x46552f, 0x4f6038, DIRT_COLOR];
    const ground = this.add.graphics().setDepth(0);
    this.mapObjects.push(ground);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const { x: sx, y: sy } = toScreen({ x, y });
        const tile = tiles?.[y * grid.width + x];
        ground.fillStyle(palette[tile ? tile - 1 : (x * 7 + y * 13) % 3] ?? DIRT_COLOR, 1);
        ground.fillPoints(diamond(sx, sy), true);
        const isNpc = this.world.npcs.some((npc) => npc.x === x && npc.y === y);
        if (!grid.isWalkable({ x, y }) && !isNpc) {
          this.mapObjects.push(this.add.image(sx, sy, 'rock').setOrigin(0.5, 0.75).setDepth(sy));
        }
      }
    }
  }

  /** 大地图：预渲染地表，摆放树石，再叠上色调和飘叶。 */
  private drawScenery(): void {
    const { map } = this.world;
    const painted = paintGround(this, map);
    const ground = this.add.image(painted.x, painted.y, painted.key).setOrigin(0).setDepth(0);
    const shimmer = this.add
      .image(painted.x, painted.y, painted.shimmerKey)
      .setOrigin(0)
      .setScale(2)
      .setDepth(0.5)
      .setAlpha(0.25);
    this.tweens.add({ targets: shimmer, alpha: 0.75, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.mapObjects.push(ground, shimmer);

    this.tallDecor = [];
    this.solidDecor = [];
    for (const item of map.decor ?? []) {
      const placement = this.props[item.prop];
      if (!placement) continue;
      const { x, y } = toScreen(item);
      const image = this.add
        .image(x, y, `prop-${item.prop}`)
        .setOrigin(item.flip ? 1 - placement.ox : placement.ox, placement.oy)
        .setScale(item.scale * PROP_DISPLAY_SCALE)
        .setFlipX(item.flip)
        .setTint(item.tint)
        .setDepth(y);
      this.mapObjects.push(image);
      if (item.foot) this.solidDecor.push({ image, foot: item.foot });
      else if (/^(tree|bare|maple|peak)/.test(item.prop)) this.tallDecor.push(image);
    }

    if (map.tone) {
      const color = Phaser.Display.Color.HexStringToColor(map.tone.color).color;
      this.mapObjects.push(
        this.add
          .rectangle(0, 0, TONE_SIZE, TONE_SIZE, color, map.tone.alpha)
          .setOrigin(0)
          .setScrollFactor(0)
          .setDepth(UI_DEPTH - 5),
      );
    }
    if (!this.textures.exists('leaf')) {
      const leaf = this.add.graphics();
      leaf.fillStyle(0xffffff, 1).fillEllipse(5, 3, 10, 5);
      leaf.generateTexture('leaf', 10, 6);
      leaf.destroy();
    }
    this.mapObjects.push(
      this.add
        .particles(0, 0, 'leaf', {
          x: { min: 0, max: TONE_SIZE / 2 },
          y: -20,
          lifespan: 12000,
          speedY: { min: 30, max: 60 },
          speedX: { min: -40, max: 20 },
          rotate: { start: 0, end: 540 },
          scale: { min: 0.5, max: 1 },
          alpha: { start: 0.85, end: 0 },
          tint: [0xffb45a, 0xff8a4a, 0xe6c84a],
          frequency: 500,
        })
        .setScrollFactor(0)
        .setDepth(UI_DEPTH - 4),
    );
  }

  /** 人走到树和山后面时把它们变透明，免得看不见角色。 */
  private fadeDecorAroundPlayer(delta: number): void {
    this.fadeTimer -= delta;
    if (this.fadeTimer > 0) return;
    this.fadeTimer = DECOR_FADE_MS;
    const { pos } = this.world.player;
    const { x: px, y: py } = toScreen(pos);
    // 大建筑按占地判断前后，只调整玩家附近的，其余保持原有排序
    for (const { image, foot } of this.solidDecor) {
      const near =
        pos.x >= foot.x0 - SOLID_NEAR_CELLS &&
        pos.x <= foot.x1 + SOLID_NEAR_CELLS &&
        pos.y >= foot.y0 - SOLID_NEAR_CELLS &&
        pos.y <= foot.y1 + SOLID_NEAR_CELLS;
      const behind = near && pos.x <= foot.x1 + 0.5 && pos.y <= foot.y1 + 0.5;
      const baseDepth = toScreen({ x: (foot.x0 + foot.x1) / 2, y: (foot.y0 + foot.y1) / 2 }).y;
      image.setDepth(near ? (behind ? py + 1 : py - 1) : baseDepth);
      const alpha = behind ? DECOR_FADED_ALPHA : 1;
      if (image.alpha !== alpha) image.setAlpha(alpha);
    }
    for (const image of this.tallDecor) {
      const behind =
        py < image.y &&
        py - PLAYER_HEIGHT < image.y &&
        py > image.y - image.displayHeight * image.originY &&
        Math.abs(px - image.x) < image.displayWidth * 0.45;
      const alpha = behind ? DECOR_FADED_ALPHA : 1;
      if (image.alpha !== alpha) image.setAlpha(alpha);
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
    const key = `npc-${npc.id}`;
    const manifest = this.sprites[key];
    const sprite = this.add
      .sprite(x, y, key, (manifest?.columns ?? SHEET.columns) * 2)
      .setOrigin(0.5, manifest?.originY ?? SHEET.originY)
      .setScale(manifest?.displayScale ?? 1)
      .setDepth(y);
    if (manifest) sprite.play(`${key}-idle-2`);
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
    const manifest = this.sprites[texture];
    const sprite = this.add
      .sprite(x, y, texture, 0)
      .setOrigin(0.5, manifest?.originY ?? SHEET.originY)
      .setScale(scale * (manifest?.displayScale ?? 1));
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
      const running = unit === this.world.player && this.world.playerRunning;
      const clip = moving ? (running && this.anims.exists(`${view.texture}-run-0`) ? 'run' : 'walk') : 'idle';
      sprite.play(`${view.texture}-${clip}-${directionRow(unit.facing)}`, true);
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
        this.world.moveTo(cell, this.holdRunning);
      }
    }
  }

  // ---- 输入 ----

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const world = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    if (pointer.rightButtonDown()) {
      this.startMoving(toCell(world.x, world.y), true);
      return;
    }
    if (!pointer.leftButtonDown()) return;

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
    this.startMoving(toCell(world.x, world.y), false);
  }

  private startMoving(cell: Cell, run: boolean): void {
    this.holding = true;
    this.holdRunning = run;
    this.holdTimer = HOLD_REPATH_MS;
    this.world.moveTo(cell, run);
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
        if (event.color) this.audio.play('cast');
        break;
      case 'monsterAdded':
        this.addUnitView(event.unit, event.unit.def.id, event.unit.def.look.scale);
        break;
      case 'stunned':
        this.floatText(event.unit, '定身', '#9fd0ff', 16);
        break;
      case 'bossReady':
        this.hud.log(`${event.name}已在${event.mapName}现身！`, 'bad');
        this.audio.play('warning');
        break;
      case 'revived':
        this.hud.log('涅槃戒发动，原地复活', 'gain');
        this.floatText(this.world.player, '涅槃', '#ffd84a', 26);
        this.audio.play('levelUp');
        this.cameras.main.flash(300, 255, 220, 160);
        break;
      case 'teleported':
        this.hud.log('遁光而去');
        this.audio.play('portal');
        break;
      case 'skillUpgraded':
        this.hud.log(`${event.name}修至 ${event.level} 层`, 'gain');
        this.audio.play('levelUp');
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
        if (event.magnet) this.flyToPlayer(event.item);
        this.audio.play(def.kind === 'gold' ? 'gold' : 'pickup');
        if (def.kind === 'gold') {
          this.addGold(amount);
        } else {
          const name = this.itemLabel(event.item);
          this.hud.log(`拾取 ${name}`, 'gain');
          this.floatText(this.world.player, `+${name}`, '#f0cf7a', 15);
        }
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
      case 'telegraph':
        this.showTelegraph(event.cells, event.seconds, event.color);
        this.audio.play('warning');
        this.hud.log(event.name, 'bad');
        break;
      case 'npcsChanged':
        this.buildMap();
        break;
      case 'weakChanged':
        this.hud.log(this.world.player.weakUntil > 0 ? '突破失败，身体虚弱' : '虚弱已消退');
        break;
      case 'mapChanged':
        this.audio.play('portal');
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
    this.audio.play(isPlayer ? 'hurt' : maxRoll ? 'crit' : 'hit');

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
    if (unit === this.world.player) this.audio.play('death');
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
        if ((unit as Summon).kind === 'summon' || (unit as Monster).temporary) {
          this.removeUnitView(view);
        }
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
    const rank = this.gradeRank(item);
    const pillar = rank >= PILLAR_GRADE ? this.addPillar(x, y, item) : null;
    this.itemViews.set(item, { sprite, label, pillar });
    if (!announce || !item.equipment) return;
    this.hud.log(`掉落了 ${this.itemLabel(item)}！`, 'gain');
    if (rank >= PILLAR_GRADE) this.audio.play('rare');
    if (rank === this.world.config.affixes.grades.length - 1) {
      this.cameras.main.flash(250, 255, 200, 120);
      this.cameras.main.shake(180, 0.004);
    }
  }

  private gradeRank(item: GroundItem): number {
    const { grades } = this.world.config.affixes;
    return grades.findIndex((grade) => grade.id === item.equipment?.grade);
  }

  /** 高品阶法器落地时的光柱，隔着半屏也能看到。 */
  private addPillar(x: number, y: number, item: GroundItem): Phaser.GameObjects.Graphics {
    const color = Phaser.Display.Color.HexStringToColor(
      equipmentColor(item.equipment!, this.world.config),
    ).color;
    const pillar = this.add.graphics().setDepth(y - 2);
    pillar.fillGradientStyle(color, color, color, color, 0, 0, 0.7, 0.7);
    pillar.fillRect(x - 9, y - PILLAR_HEIGHT, 18, PILLAR_HEIGHT);
    this.tweens.add({ targets: pillar, alpha: 0.45, duration: 700, yoyo: true, repeat: -1 });
    return pillar;
  }

  private itemLabel(item: GroundItem): string {
    return item.equipment ? equipmentName(item.equipment, this.world.config) : item.def.name;
  }

  private removeItemView(item: GroundItem): void {
    const view = this.itemViews.get(item);
    if (!view) return;
    view.sprite.destroy();
    view.label.destroy();
    view.pillar?.destroy();
    this.itemViews.delete(item);
  }

  /** 1 秒内吸到的灵石合并成一条提示。 */
  private addGold(amount: number): void {
    if (this.pendingGold === 0) {
      this.time.delayedCall(GOLD_MERGE_MS, () => {
        this.hud.log(`+${this.pendingGold} 灵石`, 'gain');
        this.floatText(this.world.player, `+${this.pendingGold}`, '#f0cf7a', 15);
        this.pendingGold = 0;
      });
    }
    this.pendingGold += amount;
  }

  private flyToPlayer(item: GroundItem): void {
    const from = toScreen(item.cell);
    const sprite = this.add.image(from.x, from.y, `item-${item.def.kind}`).setDepth(UI_DEPTH - 3);
    const target = this.unitViews.get(this.world.player)!.sprite;
    this.tweens.add({
      targets: sprite,
      x: target.x,
      y: target.y - 24,
      scale: 0.6,
      duration: FLY_MS,
      ease: 'Quad.easeIn',
      onComplete: () => sprite.destroy(),
    });
  }

  /** Boss 技能的地面预警，颜色越来越实，时间到时消失。 */
  private showTelegraph(cells: Cell[], seconds: number, color: string): void {
    const tint = Phaser.Display.Color.HexStringToColor(color).color;
    const zone = this.add.graphics().setDepth(2).setAlpha(0.25);
    zone.fillStyle(tint, 1);
    for (const cell of cells) {
      const { x, y } = toScreen(cell);
      zone.fillPoints(diamond(x, y), true);
    }
    this.tweens.add({
      targets: zone,
      alpha: 0.75,
      duration: seconds * 1000,
      onComplete: () => zone.destroy(),
    });
  }

  private showBreakthrough(realm: string, success: boolean): void {
    this.audio.play(success ? 'levelUp' : 'death');
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
    this.audio.play('levelUp');
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

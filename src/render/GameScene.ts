import Phaser from 'phaser';
import type { Cell, DecorDef, NpcDef } from '../game/config';
import { equipmentName } from '../game/equipment';
import { sameCell } from '../game/grid';
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
import { iconUrl, isHdIcon } from '../ui/icons';
import type { NpcPanel } from '../ui/npcPanel';
import type { Panels } from '../ui/panels';
import { GameAudio } from './audio';
import { directionRow, toCell, toScreen } from './iso';
import {
  addPlaceholderSheet,
  createPlaceholderArt,
  createSpriteAnimations,
  SHEET,
  type PropManifest,
  type SpriteManifest,
  type SpriteManifests,
} from './placeholders';
import { DropViews } from './dropView';
import { diamond, Effects, FONT, UI_DEPTH } from './effects';
import { paintGround } from './groundPainter';
import { mapAssets, type MapAssets } from './mapAssets';
import { addContactShadow, ensureShadowTexture, SHADOW_DEPTH_GAP, SHADOW_SPREAD } from './shadows';

/** 地上物品图标的边长 */
const DROP_ICON_SIZE = 28;
const HOLD_REPATH_MS = 200;
const MAX_FRAME_MS = 250;
/** 脱离 Boss 战后多久换回地图音乐 */
const BOSS_MUSIC_LINGER_MS = 4000;
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
/** 上品及以上有光柱 */

interface UnitView {
  unit: Unit;
  texture: string;
  sprite: Phaser.GameObjects.Sprite;
  /** 脚底接触阴影，和精灵同步位置和透明度 */
  shadow: Phaser.GameObjects.Image;
  hpBar: Phaser.GameObjects.Graphics | null;
  previous: Vec;
  attacking: boolean;
}

interface NpcView {
  npc: NpcDef;
  marker: Phaser.GameObjects.Text;
}

export class GameScene extends Phaser.Scene {
  private readonly unitViews = new Map<Unit, UnitView>();
  private readonly drops: DropViews;
  private readonly effects = new Effects(this);
  private npcViews: NpcView[] = [];
  private mapObjects: { destroy(): void }[] = [];
  /** 已从文件加载的精灵表和景观物件，切图时按新地图增减 */
  private readonly loadedSprites = new Set<string>();
  private readonly loadedProps = new Set<string>();
  /** 正式精灵表没读到、暂时用占位图的角色，下次进图重新读 */
  private readonly fallbackSprites = new Set<string>();
  /** 当前地图预渲染的地面贴图，离开这张图就释放 */
  private groundTextures: { mapId: string; keys: string[] } | null = null;
  private loadingMap = false;
  /** 加载途中又切了一次图，加载完要按最新的地图再来一遍 */
  private reenter = false;
  private accumulator = 0;
  private musicName = '';
  private bossMusicLeft = 0;
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
    this.drops = new DropViews(this, world.config);
  }

  /** 启动时只加载出生地图要用的精灵表和物件，其余的进图时再加载。 */
  preload(): void {
    this.queueAssets(this.currentAssets());
    for (const id of Object.keys(this.world.config.items)) {
      // 高清图标是 jpg，SVG 加载器解析位图会抛错，整条加载队列会断在这里
      if (isHdIcon(id)) this.load.image(`icon-${id}`, iconUrl(id));
      else this.load.svg(`icon-${id}`, iconUrl(id), { width: DROP_ICON_SIZE, height: DROP_ICON_SIZE });
    }
    this.showLoadProgress();
  }

  private currentAssets(): MapAssets {
    return mapAssets(this.world.config, this.world.mapId, this.world.player.def.id);
  }

  /** 把还没加载的精灵表和物件放进加载队列，返回新加的精灵表。 */
  private queueAssets(assets: MapAssets): string[] {
    const added: string[] = [];
    for (const key of assets.sprites) {
      const manifest = this.sprites[key];
      if (!manifest || this.loadedSprites.has(key)) continue;
      if (this.fallbackSprites.delete(key)) this.removeSheet(key);
      this.load.spritesheet(key, `${import.meta.env.BASE_URL}assets/sprites/${key}.webp`, {
        frameWidth: manifest.frameW,
        frameHeight: manifest.frameH,
      });
      this.loadedSprites.add(key);
      added.push(key);
    }
    for (const key of assets.props) {
      if (!this.props[key] || this.loadedProps.has(key)) continue;
      this.load.image(`prop-${key}`, `${import.meta.env.BASE_URL}assets/props/${key}.png`);
      this.loadedProps.add(key);
    }
    return added;
  }

  /** 释放新地图用不到的精灵表、动画、物件和上一张图的地面贴图。 */
  private releaseUnused(assets: MapAssets): void {
    for (const key of [...this.loadedSprites]) {
      if (assets.sprites.has(key)) continue;
      this.removeSheet(key);
      this.loadedSprites.delete(key);
    }
    for (const key of [...this.loadedProps]) {
      if (assets.props.has(key)) continue;
      this.textures.remove(`prop-${key}`);
      this.loadedProps.delete(key);
    }
    if (this.groundTextures && this.groundTextures.mapId !== this.world.mapId) {
      for (const key of this.groundTextures.keys) this.textures.remove(key);
      this.groundTextures = null;
    }
  }

  /** 去掉一张精灵表和它的动画，正式的和占位的动画名都清掉。 */
  private removeSheet(key: string): void {
    const names = new Set(['idle', 'walk', 'attack', ...Object.keys(this.sprites[key]?.clips ?? {})]);
    for (const name of names) {
      for (let row = 0; row < SHEET.rows; row++) this.anims.remove(`${key}-${name}-${row}`);
    }
    this.textures.remove(key);
  }

  /** 正式精灵表的说明，用占位图时没有。 */
  private manifestOf(key: string): SpriteManifest | undefined {
    return this.fallbackSprites.has(key) ? undefined : this.sprites[key];
  }

  /** 加载进度：屏幕中间一行字，加载完收起。 */
  private showLoadProgress(): void {
    const label = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '16px', color: '#f0cf7a' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(UI_DEPTH + 10);
    const place = () => label.setPosition(this.scale.width / 2, this.scale.height / 2);
    place();
    const progress = (value: number) => {
      place();
      label.setText(`加载中 ${Math.round(value * 100)}%`);
    };
    const failed = (file: Phaser.Loader.File) => console.error(`读取失败：${file.src}`);
    this.load.on('progress', progress);
    this.load.on('loaderror', failed);
    this.load.once('complete', () => {
      this.load.off('progress', progress);
      this.load.off('loaderror', failed);
      label.destroy();
    });
  }

  /** 给读到的精灵表注册动画，没读到的跳过。 */
  /**
   * 加载结束后核对贴图：没读到的（断网、404，或者开发服务器返回了网页）不算加载过，
   * 角色换成占位图、物件不摆，下次进图再读。读到的精灵表注册动画。
   */
  private settleLoaded(keys: string[]): void {
    const missing: string[] = [];
    for (const key of keys) {
      if (this.textures.exists(key)) continue;
      this.loadedSprites.delete(key);
      this.fallbackSprites.add(key);
      addPlaceholderSheet(this, this.world.config, key);
      missing.push(key);
    }
    for (const key of [...this.loadedProps]) {
      if (this.textures.exists(`prop-${key}`)) continue;
      this.loadedProps.delete(key);
      missing.push(key);
    }
    if (missing.length) {
      console.error(`没读到的素材：${missing.join('、')}`);
      this.hud.log('有素材没读到，暂时用占位图', 'bad');
    }
    const loaded = keys.filter((key) => this.loadedSprites.has(key));
    createSpriteAnimations(this, Object.fromEntries(loaded.map((key) => [key, this.sprites[key]!])));
  }

  /** 切图：先清掉旧地图，补齐新地图的素材，加载完再建图；加载期间世界暂停。 */
  private enterMap(): void {
    if (this.loadingMap) {
      this.reenter = true;
      return;
    }
    this.clearMap();
    const assets = this.currentAssets();
    this.releaseUnused(assets);
    const added = this.queueAssets(assets);
    if (!this.load.list.size) {
      this.buildMap();
      return;
    }
    this.loadingMap = true;
    this.showLoadProgress();
    this.load.once('complete', () => {
      this.settleLoaded(added);
      this.loadingMap = false;
      if (this.reenter) {
        this.reenter = false;
        this.enterMap();
      } else {
        this.buildMap();
      }
    });
    this.load.start();
  }

  create(): void {
    ensureShadowTexture(this);
    createPlaceholderArt(this, this.world.config, this.sprites);
    this.settleLoaded([...this.loadedSprites]);

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
    const digits = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
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
    if (this.loadingMap) {
      this.accumulator = 0;
      this.hud.update(this.world);
      return;
    }
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
    this.effects.syncFields(this.world.fields);
    this.updateMusic(delta);

    this.updatePointer(delta);
    this.fadeDecorAroundPlayer(delta);
    this.updateNpcMarkers();
    this.hud.update(this.world);
    this.panels.update();
    this.npcPanel.update();
    this.autoPanel.update();
  }

  // ---- 场景搭建 ----

  /** Boss 盯上玩家时换成 Boss 战音乐，脱战几秒后换回地图音乐。 */
  private updateMusic(delta: number): void {
    const { player } = this.world;
    const fighting = this.world.monsters.some(
      (monster) => monster.def.boss && monster.hp > 0 && monster.target === player,
    );
    this.bossMusicLeft = fighting ? BOSS_MUSIC_LINGER_MS : Math.max(0, this.bossMusicLeft - delta);
    const wanted = this.bossMusicLeft > 0 ? 'boss' : (this.world.map.music ?? 'town');
    if (wanted === this.musicName) return;
    this.musicName = wanted;
    this.audio.playMusic(wanted);
  }

  private clearMap(): void {
    for (const object of this.mapObjects) object.destroy();
    this.mapObjects = [];
    this.npcViews = [];
    this.tallDecor = [];
    this.solidDecor = [];
    for (const view of [...this.unitViews.values()]) {
      if ((view.unit as Monster).kind === 'monster') this.removeUnitView(view);
    }
    this.drops.clear();
  }

  /** 按当前地图重建地面、NPC、传送点和怪物显示。 */
  private buildMap(): void {
    this.clearMap();
    this.drawGround();
    this.bossMusicLeft = 0;
    this.updateMusic(0);
    for (const portal of this.world.portals) this.addPortal(portal.x, portal.y, portal.name);
    for (const npc of this.world.npcs) this.addNpc(npc);
    for (const monster of this.world.monsters) {
      this.addUnitView(monster, monster.def.id, monster.def.look.scale);
      if (!monster.hp) this.unitViews.get(monster)!.sprite.setAlpha(0);
    }
    for (const view of this.unitViews.values()) view.previous = { ...view.unit.pos };
    for (const item of this.world.items) this.drops.show(item);
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
        // 10 是崖外，没有地面
        if (tile === 10) continue;
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
    const painted = paintGround(this, map, (item) => {
      const placement = this.props[item.prop];
      if (!placement) return 0;
      // 精灵比实际占地宽（树冠、屋檐都算进去了），阴影按六成收窄
      const width = placement.w * PROP_DISPLAY_SCALE * item.scale * 0.6;
      return width < 12 ? 0 : Math.min(150, width);
    });
    this.groundTextures = { mapId: map.id, keys: [painted.key, painted.shimmerKey] };
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
      if (!placement || !this.loadedProps.has(item.prop)) continue;
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
    const manifest = this.manifestOf(key);
    const sprite = this.add
      .sprite(x, y, key, (manifest?.columns ?? SHEET.columns) * 2)
      .setOrigin(0.5, manifest?.originY ?? SHEET.originY)
      .setScale(manifest?.displayScale ?? 1)
      .setDepth(y);
    if (manifest) sprite.play(`${key}-idle-2`);
    const shadow = addContactShadow(this, x, y, sprite.displayWidth * SHADOW_SPREAD);
    const label = this.addLabel(x, y - 66, npc.name, '#9fe0ff');
    const marker = this.addLabel(x, y - 84, '', '#ffd84a').setFontSize(22);
    this.mapObjects.push(sprite, shadow, label, marker);
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
    const manifest = this.manifestOf(texture);
    const sprite = this.add
      .sprite(x, y, texture, 0)
      .setOrigin(0.5, manifest?.originY ?? SHEET.originY)
      .setScale(scale * (manifest?.displayScale ?? 1));
    const shadow = addContactShadow(this, x, y, sprite.displayWidth * SHADOW_SPREAD);
    const hpBar = unit === this.world.player ? null : this.add.graphics().setDepth(UI_DEPTH - 1);
    this.unitViews.set(unit, {
      unit,
      texture,
      sprite,
      shadow,
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
    view.shadow
      .setPosition(screen.x, screen.y)
      .setDepth(screen.y - SHADOW_DEPTH_GAP)
      .setAlpha(sprite.alpha);

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
        if (event.target) this.effects.projectile(event.unit, event.target, event.color);
        if (event.color) this.audio.play('cast');
        break;
      case 'monsterAdded':
        this.addUnitView(event.unit, event.unit.def.id, event.unit.def.look.scale);
        break;
      case 'stunned':
        this.effects.floatText(event.unit, '定身', '#9fd0ff', 16);
        break;
      case 'bossReady':
        this.hud.log(`${event.name}已在${event.mapName}现身！`, 'bad');
        this.audio.play('warning');
        break;
      case 'revived':
        this.hud.log('涅槃戒发动，原地复活', 'gain');
        this.effects.floatText(this.world.player, '涅槃', '#ffd84a', 26);
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
        this.effects.skill(event.unit, event.skill.color, event.cells);
        break;
      case 'brewed':
        this.hud.log(`炼成 ${event.name} ×${event.count}`, 'gain');
        this.audio.play('pickup');
        break;
      case 'gardenReady':
        this.hud.log(`药园有 ${event.count} 株灵药成熟，按 G 收获`, 'gain');
        break;
      case 'achievement':
        this.hud.log(`达成成就：${event.achievement.name}`, 'gain');
        this.effects.floatText(this.world.player, event.achievement.name, '#ffd84a', 20);
        this.audio.play('achievement');
        break;
      case 'skillLearned':
        this.hud.log(event.replaced ? `${event.replaced.name}进阶为${event.skill.name}` : `学会功法：${event.skill.name}`, 'gain');
        break;
      case 'summoned':
        this.addUnitView(event.unit, event.unit.def.id);
        break;
      case 'damage':
        this.showDamage(event.unit, event.amount, event.maxRoll);
        break;
      case 'miss':
        this.effects.floatText(event.unit, '闪避', '#c8c8c8', 14);
        break;
      case 'death':
        this.playDeath(event.unit);
        break;
      case 'respawn':
        this.playRespawn(event.unit);
        break;
      case 'itemDropped':
        this.announceDrop(event.item);
        break;
      case 'itemRemoved':
        this.drops.remove(event.item);
        break;
      case 'pickedUp': {
        const { def, amount } = event.item;
        if (event.magnet) this.drops.flyTo(event.item, this.unitViews.get(this.world.player)!.sprite);
        this.audio.play(def.kind === 'gold' ? 'gold' : 'pickup');
        if (def.kind === 'gold') {
          this.addGold(amount);
        } else {
          const name = this.drops.label(event.item);
          this.hud.log(`拾取 ${name}`, 'gain');
          this.effects.floatText(this.world.player, `+${name}`, '#f0cf7a', 15);
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
        this.effects.floatText(this.world.player, `+${event.amount}`, '#7be07b', 18);
        break;
      case 'mana':
        this.effects.floatText(this.world.player, `+${event.amount}`, '#7bb8ff', 18);
        break;
      case 'breakthrough':
        this.showBreakthrough(event.realm, event.success);
        break;
      case 'deathDrop':
        this.hud.log(`${event.name} 掉在了原地，限时可捡回`, 'bad');
        break;
      case 'telegraph':
        this.effects.telegraph(event.cells, event.seconds, event.color);
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
        this.enterMap();
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
        this.audio.play('questDone');
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
    this.effects.floatText(unit, String(amount), isPlayer ? '#ff6a5a' : maxRoll ? '#ffd84a' : '#ffffff', maxRoll ? 24 : 18);
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
    view.shadow.destroy();
    view.hpBar?.destroy();
    this.unitViews.delete(view.unit);
  }

  private playRespawn(unit: Unit): void {
    const view = this.unitViews.get(unit);
    if (!view) return;
    this.tweens.killTweensOf(view.sprite);
    view.previous = { ...unit.pos };
    view.sprite.setAngle(0).setAlpha(0);
    this.tweens.add({ targets: view.sprite, alpha: 1, duration: 400 });
  }

  /** 新掉落：显示在地上，法器报一条日志，高品阶有音效，最高品阶闪屏。 */
  private announceDrop(item: GroundItem): void {
    this.drops.show(item);
    if (!item.equipment) return;
    const rank = this.drops.gradeRank(item);
    this.hud.log(`掉落了 ${this.drops.label(item)}！`, 'gain');
    if (rank >= DropViews.PILLAR_GRADE) this.audio.play('rare');
    if (rank === this.world.config.affixes.grades.length - 1) {
      this.cameras.main.flash(250, 255, 200, 120);
      this.cameras.main.shake(180, 0.004);
    }
  }

  /** 1 秒内吸到的灵石合并成一条提示。 */
  private addGold(amount: number): void {
    if (this.pendingGold === 0) {
      this.time.delayedCall(GOLD_MERGE_MS, () => {
        this.hud.log(`+${this.pendingGold} 灵石`, 'gain');
        this.effects.floatText(this.world.player, `+${this.pendingGold}`, '#f0cf7a', 15);
        this.pendingGold = 0;
      });
    }
    this.pendingGold += amount;
  }

  private showBreakthrough(realm: string, success: boolean): void {
    this.audio.play(success ? 'levelUp' : 'death');
    if (!success) {
      this.hud.log('突破失败，材料已消耗', 'bad');
      this.effects.floatText(this.world.player, '突破失败', '#ff6a5a', 24);
      return;
    }
    this.hud.log(`突破成功，${realm}圆满！`, 'gain');
    this.effects.floatText(this.world.player, '突破成功！', '#ffd84a', 28);
    this.cameras.main.flash(300, 255, 240, 200);
  }

  private showLevelUp(level: number): void {
    this.audio.play('levelUp');
    this.hud.log(`升到了 ${level} 级！`, 'gain');
    this.effects.floatText(this.world.player, `升级！Lv.${level}`, '#ffd84a', 26);
    const { x, y } = toScreen(this.world.player.pos);
    this.effects.ring(x, y - 24, 12, 0xffd84a, 5, 600);
  }

}

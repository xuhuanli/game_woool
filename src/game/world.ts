import { achievementProgress, recordCodexItems } from './achievements';
import { AutoPlay, defaultAutoSettings } from './autoPlay';
import { emptyGarden, Garden } from './garden';
import { rollAttack, type AttackOptions } from './combat';
import type {
  Cell,
  CombatStats,
  DamageStat,
  GameConfig,
  ItemDef,
  MapDef,
  MonsterDef,
  NpcDef,
  PortalDef,
  SkillDef,
} from './config';
import { isBound, monsterDrops, SKILL_SLOTS } from './config';
import { equipmentName, EQUIP_SLOTS, rollEquipment, type Equipment } from './equipment';
import { cellDistance, direction, Grid, sameCell } from './grid';
import { GroundFields } from './fields';
import { MonsterAbilities } from './monsterAbilities';
import { NpcServices } from './shop';
import { Inventory } from './inventory';
import {
  estimateIncome,
  type Fighter,
  OFFLINE_EFFICIENCY,
  OFFLINE_MAX_EQUIPMENT,
  OFFLINE_MAX_SECONDS,
  OFFLINE_MIN_SECONDS,
} from './offline';
import { findPath } from './pathfinding';
import { emptyQuestState, questStatus, recordObjective } from './quests';
import { breakthroughChance, pendingBreakthrough } from './realm';
import { nextStep } from './navigation';
import { Rng } from './rng';
import { SAVE_VERSION, type SaveData } from '../save/saveData';
import { needsTarget, skillArea } from './skills';
import { refreshStats } from './stats';
import type {
  DeathDrop,
  Field,
  GameEvent,
  GroundItem,
  HotbarEntry,
  Monster,
  OfflineReport,
  Player,
  RouteTarget,
  Summon,
  Unit,
} from './types';

export * from './types';

export const TICK_SECONDS = 0.05;
export const HOTBAR_SIZE = 9;
/** 飞行靴：点任务旁的图标直接飞到任务目的地 */
export const FLYING_BOOTS = 'flying-boots';

const REPATH_SECONDS = 0.3;
const RESPAWN_SECONDS = 3;
const GROUND_ITEM_SECONDS = 90;
const ACHIEVEMENT_CHECK_SECONDS = 1;
const REGEN_DELAY_SECONDS = 5;
const REGEN_FRACTION_PER_SECOND = 0.02;
const MANA_FRACTION_PER_SECOND = 0.03;
const WANDER_MIN_SECONDS = 2;
const WANDER_MAX_SECONDS = 6;
const SUMMON_FOLLOW_DISTANCE = 2;
const SUMMON_TELEPORT_DISTANCE = 12;
const NOTICE_SECONDS = 3;
const TALK_RANGE = 2;
/** 怪物和召唤物寻路最多展开的格数，目标被围住时不搜整张图 */
const MONSTER_SEARCH_LIMIT = 1500;
const INTERACT_RANGE = 4;

export class World {
  grid: Grid;
  mapId: string;
  readonly player: Player;
  readonly inventory: Inventory;
  readonly garden: Garden;
  /** 寻路时已经走去找过的传送 NPC，再走不到就放弃 */
  private travelWalkedTo: NpcDef | null = null;
  readonly autoPlay: AutoPlay;
  readonly monsters: Monster[] = [];
  readonly summons: Summon[] = [];
  /** 当前地图上的火墙、毒瘴等持续地面 */
  readonly groundFields = new GroundFields();
  private readonly abilities: MonsterAbilities;
  /** 仓库、买卖、传送 */
  readonly shop: NpcServices;
  readonly items: GroundItem[] = [];
  /** Boss 下次刷新的游戏内时间，切图后继续计时 */
  bossReadyAt: Record<string, number> = {};
  private achievementLeft = 0;
  deathDrops: DeathDrop[] = [];
  time = 0;

  private readonly rng: Rng;
  private nextId = 1;
  private portalNoticeAt = -Infinity;
  private events: GameEvent[] = [];

  constructor(
    readonly config: GameConfig,
    mapId: string,
    classId: string,
    seed: number,
    playerName = '无名修士',
    /** 真实时钟，药园用；测试和模拟传假时钟 */
    private readonly clock: () => number = Date.now,
  ) {
    const map = config.maps[mapId];
    const classDef = config.classes[classId];
    if (!map || !classDef) throw new Error(`未知的地图或职业：${mapId} ${classId}`);

    this.mapId = mapId;
    this.grid = new Grid(map);
    this.rng = new Rng(seed);
    const hotbar: (HotbarEntry | null)[] = Array.from({ length: HOTBAR_SIZE }, () => null);
    hotbar[HOTBAR_SIZE - 2] = { kind: 'item', id: 'small-mana' };
    hotbar[HOTBAR_SIZE - 1] = { kind: 'item', id: 'small-potion' };
    this.player = {
      ...this.createUnit(playerName, map.playerStart, classDef.base, {
        ...classDef,
        attackStat: classDef.primaryStat,
      }),
      kind: 'player',
      def: classDef,
      level: 1,
      exp: 0,
      gold: 0,
      bag: {},
      equipBag: [],
      equipment: {},
      quests: emptyQuestState(),
      realmPassed: [],
      breakthroughFails: {},
      skillLevels: {},
      kills: {},
      codexItems: {},
      achievements: [],
      garden: emptyGarden(config, clock()),
      storage: [],
      reviveReadyAt: 0,
      teleportReadyAt: 0,
      route: null,
      weakUntil: 0,
      lastDeathAt: -Infinity,
      auto: defaultAutoSettings(),
      lastFieldMap: null,
      skills: [],
      skillCooldowns: {},
      hotbar,
      order: null,
      running: false,
      queuedSkill: null,
      respawnLeft: 0,
      lastHurtAt: -Infinity,
    };
    this.inventory = new Inventory(
      config,
      this.player,
      this.rng,
      () => this.time,
      (event) => this.emit(event),
      (item) => this.useScroll(item),
    );
    this.garden = new Garden(config, this.player, this.inventory, clock, (event) => this.emit(event));
    this.autoPlay = new AutoPlay(this);
    const world = this;
    this.shop = new NpcServices({
      config,
      get player() {
        return world.player;
      },
      inventory: this.inventory,
      rng: this.rng,
      isNear: (npc) => this.isNear(npc),
      questDone: (questId) => this.questDone(questId),
      nextUid: () => this.nextId++,
      changeMap: (mapId, cell) => this.changeMap(mapId, cell),
      emit: (event) => this.emit(event),
    });
    this.abilities = new MonsterAbilities({
      config,
      get grid() {
        return world.grid;
      },
      get player() {
        return world.player;
      },
      get summons() {
        return world.summons;
      },
      get monsters() {
        return world.monsters;
      },
      fields: this.groundFields,
      isFree: (cell, unit) => this.isFree(cell, unit),
      isStepping: (unit) => this.isStepping(unit),
      hit: (attacker, target, options) => this.resolveHit(attacker, target, options),
      spawnMinion: (def, cell) => {
        const minion = this.createMonster(def, cell, `minion:${this.nextId}`);
        minion.temporary = true;
        this.monsters.push(minion);
        this.emit({ type: 'monsterAdded', unit: minion });
      },
      emit: (event) => this.emit(event),
    });
    this.learnSkills();
    this.loadMap(mapId);
    this.drainEvents();
  }

  /** 地上正在生效的地面伤害，渲染和挂机用 */
  get fields(): Field[] {
    return this.groundFields.list;
  }

  get map(): MapDef {
    return this.config.maps[this.mapId]!;
  }

  get npcs(): NpcDef[] {
    return Object.values(this.config.npcs).filter(
      (npc) =>
        npc.map === this.mapId &&
        (!npc.requires || this.questDone(npc.requires)) &&
        (!npc.hiddenAfter || !this.questDone(npc.hiddenAfter)),
    );
  }

  questDone(questId: string): boolean {
    return this.player.quests.completed.includes(questId);
  }

  get portals(): PortalDef[] {
    return this.map.portals ?? [];
  }

  /** 载入地图：清空地面物品，重新生成怪物，NPC 所在格不可通行。 */
  private loadMap(mapId: string): void {
    const map = this.config.maps[mapId];
    if (!map) throw new Error(`未知的地图：${mapId}`);
    this.mapId = mapId;
    if (!map.safe) this.player.lastFieldMap = mapId;
    this.grid = new Grid(map, this.npcs);
    this.monsters.length = 0;
    this.items.length = 0;
    for (const drop of this.deathDrops) {
      if (drop.mapId === mapId) this.items.push(drop.item);
    }
    map.spawns.forEach((spawn, index) => {
      const def = this.config.monsters[spawn.monster];
      if (!def) throw new Error(`未知的怪物：${spawn.monster}`);
      const spawnKey = `${mapId}:${index}`;
      const monster = this.createMonster(def, spawn, spawnKey);
      const waiting = (this.bossReadyAt[spawnKey] ?? 0) - this.time;
      if (waiting > 0) {
        monster.hp = 0;
        monster.respawnLeft = waiting;
      }
      this.monsters.push(monster);
    });
  }

  private createMonster(def: MonsterDef, cell: Cell, spawnKey: string): Monster {
    return {
      ...this.createUnit(def.name, cell, def.stats, this.monsterTiming(def)),
      kind: 'monster',
      def,
      home: { x: cell.x, y: cell.y },
      spawnKey,
      mode: 'idle',
      target: null,
      abilityCooldowns: {},
      phase: 0,
      wanderLeft: this.rng.next() * WANDER_MAX_SECONDS,
      respawnLeft: 0,
    };
  }

  private changeMap(mapId: string, cell: Cell): void {
    const player = this.player;
    player.order = null;
    player.path = [];
    this.groundFields.clear();
    this.autoPlay.hunt = null;
    this.loadMap(mapId);
    const arrival = this.grid.nearest(cell, (c) => this.isFree(c, player)) ?? cell;
    player.cell = { ...arrival };
    player.pos = { ...arrival };
    for (const summon of this.summons) {
      const near = this.grid.nearest(arrival, (c) => this.isFree(c, summon) && !sameCell(c, arrival));
      if (!near) continue;
      summon.cell = { ...near };
      summon.pos = { ...near };
      summon.path = [];
      summon.target = null;
    }
    this.emit({ type: 'mapChanged' });
    this.advanceQuests('reach', mapId);
  }

  /** 从存档恢复世界，怪物和地面物品按地图重新生成。 */
  static fromSave(config: GameConfig, save: SaveData, seed: number, clock: () => number = Date.now): World {
    const { player } = save;
    const world = new World(config, save.mapId, player.classId, seed, player.name, clock);
    world.restore(save);
    return world;
  }

  toSave(savedAt: number): SaveData {
    const { player } = this;
    return structuredClone({
      version: SAVE_VERSION,
      savedAt,
      mapId: this.mapId,
      time: this.time,
      nextId: this.nextId,
      bossReadyAt: this.bossReadyAt,
      deathDrops: this.deathDrops.map(({ mapId, item }) => ({
        mapId,
        cell: item.cell,
        equipment: item.equipment!,
        expiresAt: item.expiresAt,
      })),
      player: {
        name: player.name,
        classId: player.def.id,
        level: player.level,
        exp: player.exp,
        gold: player.gold,
        hp: player.hp,
        mp: player.mp,
        cell: player.cell,
        bag: player.bag,
        equipBag: player.equipBag,
        equipment: player.equipment,
        skills: player.skills,
        hotbar: player.hotbar,
        quests: player.quests,
        realmPassed: player.realmPassed,
        breakthroughFails: player.breakthroughFails,
        skillLevels: player.skillLevels,
        kills: player.kills,
        codexItems: player.codexItems,
        achievements: player.achievements,
        garden: player.garden,
        storage: player.storage,
        weakUntil: player.weakUntil,
        lastDeathAt: Number.isFinite(player.lastDeathAt) ? player.lastDeathAt : null,
        auto: player.auto,
        lastFieldMap: player.lastFieldMap,
      },
    });
  }

  private restore(save: SaveData): void {
    const { items, skills } = this.config;
    const data = structuredClone(save.player);
    const player = this.player;
    const known = (equipment: Equipment) => !!items[equipment.itemId];

    this.time = save.time;
    this.nextId = Math.max(this.nextId, save.nextId);
    this.bossReadyAt = { ...save.bossReadyAt };
    this.deathDrops = save.deathDrops
      .filter((drop) => items[drop.equipment.itemId])
      .map((drop) => ({
        mapId: drop.mapId,
        item: {
          id: this.nextId++,
          def: items[drop.equipment.itemId]!,
          amount: 1,
          equipment: structuredClone(drop.equipment),
          cell: { ...drop.cell },
          expiresAt: drop.expiresAt,
        },
      }));
    this.loadMap(save.mapId);
    player.level = data.level;
    player.exp = data.exp;
    player.gold = data.gold;
    player.bag = Object.fromEntries(Object.entries(data.bag).filter(([id]) => items[id]));
    player.equipBag = data.equipBag.filter(known);
    player.equipment = Object.fromEntries(
      Object.entries(data.equipment).filter(([, equipment]) => known(equipment)),
    );
    player.quests = {
      active: data.quests.active.filter((quest) => this.config.quests[quest.id]),
      completed: data.quests.completed,
    };
    player.realmPassed = data.realmPassed;
    player.breakthroughFails = data.breakthroughFails;
    player.skillLevels = data.skillLevels;
    player.kills = data.kills ?? {};
    player.codexItems = data.codexItems ?? {};
    player.achievements = (data.achievements ?? []).filter((id) => this.config.achievements[id]);
    player.garden = data.garden ?? emptyGarden(this.config, this.clock());
    player.storage = data.storage.filter(known);
    player.weakUntil = data.weakUntil;
    player.lastDeathAt = data.lastDeathAt ?? -Infinity;
    player.auto = { ...data.auto, enabled: false };
    player.lastFieldMap = data.lastFieldMap ?? player.lastFieldMap;
    player.skills = data.skills.filter((id) => skills[id]);
    const hotbar = data.hotbar.map((entry) => {
      const exists = entry?.kind === 'skill' ? skills[entry.id] : entry && items[entry.id];
      return exists ? entry : null;
    });
    // 快捷栏变长时在丹药格前面补空格，丹药仍在最后两格
    const missing = Math.max(0, HOTBAR_SIZE - hotbar.length);
    player.hotbar = [...hotbar.slice(0, -2), ...Array<null>(missing).fill(null), ...hotbar.slice(-2)];
    this.garden.clamp();
    refreshStats(this.player, this.config, this.time);
    this.learnSkills();
    this.drainEvents();

    const alive = data.hp > 0;
    player.hp = alive ? Math.min(data.hp, player.stats.maxHp) : player.stats.maxHp;
    player.mp = alive ? Math.min(data.mp, player.stats.maxMp) : player.stats.maxMp;
    if (!alive) {
      this.respawnPlayer();
      this.drainEvents();
      return;
    }
    const cell = this.grid.nearest(data.cell, (c) => this.isFree(c, player)) ?? data.cell;
    player.cell = { ...cell };
    player.pos = { ...cell };
  }

  get expToNext(): number | null {
    return this.config.levels.expToNext[this.player.level - 1] ?? null;
  }

  drainEvents(): GameEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // ---- 玩家指令 ----

  moveTo(cell: Cell, run = false): void {
    const goal = this.grid.nearest(cell, (c) => this.grid.isWalkable(c));
    if (!goal || !this.player.hp) return;
    this.player.order = { type: 'move', cell: goal };
    this.player.running = run;
    this.player.route = null;
    this.player.repathLeft = 0;
    this.planPath(this.player, goal, false);
    this.autoPlay.pauseForManualInput();
  }

  attack(target: Monster): void {
    if (!this.player.hp || !target.hp) return;
    if (!this.autoPlay.active) this.player.route = null;
    this.player.order = { type: 'attack', target };
    this.player.repathLeft = 0;
  }

  pickup(item: GroundItem): void {
    if (!this.player.hp) return;
    this.player.order = { type: 'pickup', itemId: item.id };
    this.planPath(this.player, item.cell, false);
  }

  /** 回到复活点，用于低血自动回城和回城符。 */
  recall(notice = '生命过低，已回城'): void {
    const target = this.map.respawn ?? { ...this.map.playerStart, map: this.mapId };
    this.emit({ type: 'message', text: notice });
    this.changeMap(target.map, target);
  }

  private useScroll(item: ItemDef): void {
    if (item.scroll === 'recall') this.recall('已回城');
    else this.teleportRandomly();
  }

  private teleportRandomly(): void {
    const { player, grid } = this;
    player.order = null;
    player.path = [];
    for (let attempt = 0; attempt < 50; attempt++) {
      const cell = { x: this.rng.int(0, grid.width - 1), y: this.rng.int(0, grid.height - 1) };
      if (!this.isFree(cell, player)) continue;
      player.cell = { ...cell };
      player.pos = { ...cell };
      this.emit({ type: 'teleported' });
      return;
    }
  }

  /** 遁光戒：随机传送，有冷却。 */
  useTeleportRing(): void {
    const { player } = this;
    const ring = this.inventory.special('teleport');
    if (!ring || !player.hp) return;
    if (this.time < player.teleportReadyAt) {
      this.emit({ type: 'message', text: '遁光戒冷却中' });
      return;
    }
    player.teleportReadyAt = this.time + ring.seconds;
    this.teleportRandomly();
  }

  /** 自动寻路到目的地，跨地图时沿传送点走，能接上后续对话。正在打的怪直接放下。 */
  navigate(target: RouteTarget): void {
    if (!this.canReach(target)) return;
    this.dropCurrentAction();
    this.travelWalkedTo = null;
    this.player.route = target;
    this.followRoute();
  }

  /** 飞行靴：消耗一双，直接落到目的地，再接上对话或挂机。 */
  flyTo(target: RouteTarget): void {
    const { player } = this;
    const boots = this.config.items[FLYING_BOOTS];
    if (!boots || !this.canReach(target)) return;
    if (!player.bag[FLYING_BOOTS]) {
      this.emit({ type: 'message', text: `没有${boots.name}了` });
      return;
    }
    this.inventory.removeFromBag(FLYING_BOOTS);
    this.dropCurrentAction();
    player.route = null;
    const landing = target.npc ? { x: target.npc.x + 1, y: target.npc.y + 1 } : target.cell;
    if (target.mapId === this.mapId) {
      const cell = this.grid.nearest(landing, (c) => this.isFree(c, player)) ?? player.cell;
      player.cell = { ...cell };
      player.pos = { ...cell };
      this.emit({ type: 'teleported' });
    } else {
      this.changeMap(target.mapId, landing);
    }
    this.arrive(target);
  }

  private canReach(target: RouteTarget): boolean {
    if (!this.player.hp) return false;
    if (target.mapId === this.mapId || nextStep(this, target.mapId)) return true;
    this.emit({ type: 'message', text: '暂时找不到去那里的路' });
    return false;
  }

  private dropCurrentAction(): void {
    const { player } = this;
    player.order = null;
    player.path = [];
    player.windupLeft = 0;
    player.pending = null;
    player.queuedSkill = null;
  }

  /** 到达任务地图：找 NPC 对话，或去刷怪点并开启挂机。 */
  private arrive(route: RouteTarget): void {
    if (route.npc) {
      this.talkTo(route.npc);
      return;
    }
    this.walkTo(route.cell);
    if (route.hunt && !this.map.safe) {
      this.autoPlay.hunt = route.hunt;
      if (!this.player.auto.enabled) {
        this.player.auto.enabled = true;
        this.emit({ type: 'message', text: '已到达，开始挂机' });
      }
    }
  }

  private followRoute(): void {
    const { player } = this;
    const route = player.route;
    if (!route || player.order) return;
    if (route.mapId === this.mapId) {
      player.route = null;
      this.arrive(route);
      return;
    }
    const step = nextStep(this, route.mapId);
    if (step?.kind === 'portal') {
      this.walkTo(step.portal);
    } else if (step?.kind === 'travel') {
      this.takeTravel(step.npc, step.index);
    } else {
      player.route = null;
    }
  }

  /** 寻路经过传送 NPC：先走到身边，到了就付灵石传送，走不到或付不起就停下。 */
  private takeTravel(npc: NpcDef, index: number): void {
    const { player } = this;
    if (!this.isNear(npc)) {
      if (this.travelWalkedTo === npc) {
        player.route = null;
        return;
      }
      this.travelWalkedTo = npc;
      this.walkTo(npc);
      return;
    }
    this.travelWalkedTo = null;
    const mapId = this.mapId;
    this.shop.travel(npc, index);
    if (this.mapId === mapId) player.route = null;
  }

  private walkTo(cell: Cell): void {
    const goal = this.grid.nearest(cell, (c) => this.grid.isWalkable(c));
    if (!goal) return;
    this.player.order = { type: 'move', cell: goal };
    this.player.running = true;
    this.planPath(this.player, goal, false);
  }

  /** 跑步只作用于赶路，追怪和放技能时恢复行走。 */
  get playerRunning(): boolean {
    const { running, order } = this.player;
    return running && (order?.type === 'move' || order?.type === 'talk' || order?.type === 'pickup');
  }

  /** 闭关估算用的角色数据：属性、普攻和已学会的功法。 */
  offlineFighter(): Fighter {
    const { player, config } = this;
    return {
      stats: player.stats,
      primary: player.def.primaryStat,
      attackInterval: player.attackInterval,
      skills: player.skills.flatMap((id) => {
        const skill = config.skills[id];
        return skill ? [{ skill, power: this.inventory.skillPower(id) }] : [];
      }),
    };
  }

  /** 结算闭关收益：最多 8 小时，效率为在线的一半，有经验、灵石和普通法器。 */
  settleOffline(savedAt: number, now: number): OfflineReport | null {
    const player = this.player;
    const seconds = Math.min((now - savedAt) / 1000, OFFLINE_MAX_SECONDS);
    if (seconds < OFFLINE_MIN_SECONDS) return null;

    const mapId = player.lastFieldMap ?? Object.values(this.config.maps).find((map) => !map.safe)?.id;
    const map = mapId ? this.config.maps[mapId] : undefined;
    if (!map) return null;
    const income = estimateIncome(this.config, map, this.offlineFighter());
    const { expPerSecond, goldPerSecond } = income;
    const exp = Math.floor(expPerSecond * seconds * OFFLINE_EFFICIENCY);
    let gold = Math.floor(goldPerSecond * seconds * OFFLINE_EFFICIENCY);
    const kills = income.killsPerSecond * seconds * OFFLINE_EFFICIENCY;
    const { equipment, soldGold, soldCount } = this.rollOfflineEquipment(kills, income.equipmentPerKill);
    gold += soldGold;
    player.gold += gold;
    this.gainExp(exp);
    this.garden.refresh();
    const garden = this.garden.unlocked
      ? { ready: this.garden.readyCount, dew: this.player.garden.dew }
      : null;
    return { seconds, exp, gold, equipment, soldCount, garden };
  }

  /** 闭关只出普通法器，不出极品和 Boss 掉落，放不下的换成灵石。 */
  private rollOfflineEquipment(kills: number, perKill: Record<string, number>) {
    const { affixes, items } = this.config;
    const ordinary = { ...affixes, grades: affixes.grades.slice(0, -1) };
    const entries = Object.entries(perKill);
    const totalPerKill = entries.reduce((sum, [, chance]) => sum + chance, 0);
    const expected = kills * totalPerKill;
    const count = Math.min(OFFLINE_MAX_EQUIPMENT, Math.floor(expected + this.rng.next()));

    const equipment: string[] = [];
    let soldGold = 0;
    let soldCount = 0;
    for (let i = 0; i < count; i++) {
      let roll = this.rng.next() * totalPerKill;
      const itemId = entries.find(([, chance]) => (roll -= chance) < 0)?.[0] ?? entries.at(-1)?.[0];
      const item = itemId ? items[itemId] : undefined;
      if (!item) continue;
      const rolled = rollEquipment(item, ordinary, this.rng, this.nextId++);
      if (this.inventory.bagIsFull()) {
        soldGold += this.shop.sellPrice(rolled);
        soldCount += 1;
      } else {
        this.player.equipBag.push(rolled);
        equipment.push(equipmentName(rolled, this.config));
      }
    }
    return { equipment, soldGold, soldCount };
  }

  /** 把丹药或符箓放进快捷栏，只放后两格丹药格，前面是功法格。 */
  setHotbarItem(slot: number, itemId: string): void {
    const item = this.config.items[itemId];
    if (!item || (item.kind !== 'potion' && item.kind !== 'scroll') || item.scroll === 'fly') {
      this.emit({ type: 'message', text: '只有丹药和符箓能放进快捷栏' });
      return;
    }
    if (slot < SKILL_SLOTS || slot >= HOTBAR_SIZE) {
      this.emit({ type: 'message', text: '丹药和符箓放在最后两格' });
      return;
    }
    this.player.hotbar[slot] = { kind: 'item', id: itemId };
  }

  useHotbar(slot: number, target: Monster | null = null): void {
    const entry = this.player.hotbar[slot];
    if (entry?.kind === 'skill') this.castSkill(entry.id, target);
    else if (entry?.kind === 'item') this.inventory.useItem(entry.id);
  }

  castSkill(skillId: string, target: Monster | null = null): void {
    const player = this.player;
    const skill = this.config.skills[skillId];
    if (!skill || !player.hp || !player.skills.includes(skillId)) return;
    if ((player.skillCooldowns[skillId] ?? 0) > 0) return;
    if (player.mp < skill.mpCost) {
      this.emit({ type: 'message', text: '灵力不足' });
      return;
    }
    if (!needsTarget(skill)) {
      if (player.windupLeft > 0) player.queuedSkill = skill;
      else this.startCast(player, skill, null);
      return;
    }
    const lockedTarget =
      player.order?.type === 'attack' || player.order?.type === 'cast' ? player.order.target : null;
    const chosen = target ?? lockedTarget ?? this.nearestMonster(player.cell, skill.range);
    if (!chosen?.hp) {
      this.emit({ type: 'message', text: '没有目标' });
      return;
    }
    player.order = { type: 'cast', skill, target: chosen };
    player.repathLeft = 0;
  }

  /** 把背包里的法器丢到脚边，丢弃后仍可捡回。绑定的东西丢不掉。 */
  discard(uid: number): void {
    const player = this.player;
    const equipment = player.equipBag.find((candidate) => candidate.uid === uid);
    const item = equipment && this.config.items[equipment.itemId];
    if (!equipment || !item || !this.canDiscard(item)) return;
    const cell = this.dropCell();
    if (!cell) return;
    player.equipBag.splice(player.equipBag.indexOf(equipment), 1);
    this.spawnItem(item, 1, equipment, cell).discarded = true;
  }

  /** 把一整叠丹药材料丢到脚边，不会被自动吸回来。 */
  discardStack(itemId: string): void {
    const { player } = this;
    const item = this.config.items[itemId];
    const count = player.bag[itemId] ?? 0;
    if (!item || count <= 0 || !this.canDiscard(item)) return;
    const cell = this.dropCell();
    if (!cell) return;
    delete player.bag[itemId];
    this.spawnItem(item, count, null, cell).discarded = true;
  }

  private canDiscard(item: ItemDef): boolean {
    if (!this.player.hp) return false;
    if (!isBound(item)) return true;
    this.emit({ type: 'message', text: `${item.name}已绑定，不能丢弃` });
    return false;
  }

  private dropCell(): Cell | null {
    const { player } = this;
    return this.grid.nearest(player.cell, (c) => this.canDropAt(c) && !sameCell(c, player.cell));
  }

  // ---- NPC、商店、任务 ----

  talkTo(npc: NpcDef): void {
    const player = this.player;
    if (!player.hp || npc.map !== this.mapId) return;
    player.order = { type: 'talk', npc };
    const goal = this.grid.nearest(npc, (c) => this.isFree(c, player));
    if (goal) this.planPath(player, goal, false);
  }

  private isNear(npc: NpcDef): boolean {
    return npc.map === this.mapId && cellDistance(this.player.cell, npc) <= INTERACT_RANGE;
  }

  acceptQuest(questId: string): void {
    const player = this.player;
    const quest = this.config.quests[questId];
    if (!quest || questStatus(quest, player.quests, player.level, player.bag) !== 'available') return;
    const counts = quest.objectives.map((objective) =>
      objective.type === 'reach' && objective.target === this.mapId ? objective.count : 0,
    );
    player.quests.active.push({ id: quest.id, counts });
    this.emit({ type: 'questAccepted', name: quest.name });
  }

  turnInQuest(questId: string): void {
    const player = this.player;
    const quest = this.config.quests[questId];
    if (!quest || questStatus(quest, player.quests, player.level, player.bag) !== 'ready') return;

    const rewards = quest.rewards.items.flatMap(({ item, count }) =>
      Array.from({ length: count }, () => this.config.items[item]!),
    );
    const newEquipment = rewards.filter((item) => item.kind === 'equip').length;
    if (player.equipBag.length + newEquipment > this.config.affixes.bagCapacity) {
      this.emit({ type: 'message', text: '背包已满' });
      return;
    }

    for (const objective of quest.objectives) {
      if (objective.type !== 'collect') continue;
      for (let i = 0; i < objective.count; i++) this.inventory.removeFromBag(objective.target);
    }
    player.quests.active = player.quests.active.filter((progress) => progress.id !== quest.id);
    player.quests.completed.push(quest.id);
    this.emit({ type: 'questCompleted', name: quest.name });

    player.gold += quest.rewards.gold;
    for (const item of rewards) {
      if (item.kind === 'equip') {
        this.inventory.takeEquipment(rollEquipment(item, this.config.affixes, this.rng, this.nextId++));
      } else {
        this.inventory.addToBag(item.id, 1);
      }
    }
    this.gainExp(quest.rewards.exp);

    this.grid = new Grid(this.map, this.npcs);
    this.emit({ type: 'npcsChanged' });
    const { teleport } = quest.rewards;
    if (teleport) this.changeMap(teleport.map, teleport);
  }

  /** 尝试突破：消耗丹药和材料，成功后继续升级，失败不掉等级。 */
  attemptBreakthrough(): void {
    const player = this.player;
    const realm = pendingBreakthrough(this.config.realms, player.level, player.realmPassed);
    const needed = this.expToNext;
    if (!realm?.breakthrough || !player.hp || needed === null) return;
    if (player.exp < needed) {
      this.emit({ type: 'message', text: '修为尚未圆满' });
      return;
    }
    const missing = realm.breakthrough.requires.find(
      ({ item, count }) => (player.bag[item] ?? 0) < count,
    );
    if (missing) {
      this.emit({ type: 'message', text: `缺少${this.config.items[missing.item]?.name}` });
      return;
    }

    for (const { item, count } of realm.breakthrough.requires) {
      for (let i = 0; i < count; i++) this.inventory.removeFromBag(item);
    }
    const fails = player.breakthroughFails[realm.id] ?? 0;
    const success = this.rng.chance(breakthroughChance(realm, fails));
    if (success) {
      player.realmPassed.push(realm.id);
    } else {
      player.breakthroughFails[realm.id] = fails + 1;
      player.weakUntil = this.time + this.config.game.weakSeconds;
      refreshStats(player, this.config, this.time);
      this.emit({ type: 'weakChanged' });
    }
    this.emit({ type: 'breakthrough', realm: realm.name, success });
    if (success) this.gainExp(0);
  }

  private advanceQuests(type: 'kill' | 'talk' | 'reach', target: string): void {
    for (const quest of recordObjective(this.player.quests, this.config, type, target)) {
      this.emit({ type: 'questProgress', name: quest.name });
    }
  }

  // ---- 主循环 ----

  tick(dt = TICK_SECONDS): void {
    this.time += dt;
    this.autoPlay.tick(dt);
    this.announceBosses();
    this.tickPlayer(dt);
    for (const monster of this.monsters) this.tickMonster(monster, dt);
    for (const summon of [...this.summons]) this.tickSummon(summon, dt);
    this.groundFields.tick(dt, {
      targets: (hostile) => (hostile ? [this.player, ...this.summons] : this.monsters),
      hit: (attacker, target, options) => this.resolveHit(attacker, target, options),
    });
    this.expireItems();
    this.achievementLeft -= dt;
    if (this.achievementLeft <= 0) {
      this.achievementLeft = ACHIEVEMENT_CHECK_SECONDS;
      this.checkAchievements();
      this.garden.refresh();
    }
  }

  /** 记下图鉴里新见到的法器，达成的成就发奖励。 */
  checkAchievements(): void {
    const { player, config } = this;
    recordCodexItems(player, config);
    for (const def of Object.values(config.achievements)) {
      if (player.achievements.includes(def.id)) continue;
      const { value, goal } = achievementProgress(def, player, config);
      if (value < goal) continue;
      player.achievements.push(def.id);
      player.gold += def.reward.gold;
      for (const { item, count } of def.reward.items) this.inventory.addToBag(item, count);
      this.emit({ type: 'achievement', achievement: def });
    }
  }

  private tickPlayer(dt: number): void {
    const player = this.player;
    if (!player.hp) {
      player.respawnLeft -= dt;
      if (player.respawnLeft <= 0) this.respawnPlayer();
      return;
    }

    if (player.weakUntil > 0 && player.weakUntil <= this.time) {
      player.weakUntil = 0;
      refreshStats(player, this.config, this.time);
      this.emit({ type: 'weakChanged' });
    }
    this.attractItems();
    this.followRoute();
    this.tickRegen(dt);
    this.tickEffects(player, dt);
    for (const [skillId, left] of Object.entries(player.skillCooldowns)) {
      player.skillCooldowns[skillId] = Math.max(0, left - dt);
    }
    if (!player.hp || this.tickAttackTimers(player, dt)) return;
    if (player.queuedSkill) {
      const skill = player.queuedSkill;
      player.queuedSkill = null;
      this.startCast(player, skill, null);
      return;
    }

    const order = player.order;
    if (order?.type === 'attack') {
      if (order.target.hp <= 0) player.order = null;
      else this.pursueAndAttack(player, order.target, dt);
    } else if (order?.type === 'cast') {
      if (order.target.hp <= 0) {
        player.order = null;
      } else {
        this.pursue(player, order.target, dt, order.skill.range, () => {
          this.startCast(player, order.skill, order.target);
          player.order = { type: 'attack', target: order.target };
        });
      }
    } else if (order?.type === 'pickup') {
      if (!this.items.some((item) => item.id === order.itemId)) player.order = null;
    } else if (order?.type === 'talk' && cellDistance(player.cell, order.npc) <= TALK_RANGE) {
      player.path = [];
      if (!this.isStepping(player)) {
        player.order = null;
        this.advanceQuests('talk', order.npc.id);
        this.emit({ type: 'npcOpened', npc: order.npc });
      }
    }

    this.advance(player, dt);
    if (!this.isStepping(player)) {
      this.collectItemsAt(player.cell);
      const portal = this.portals.find((candidate) => sameCell(candidate, player.cell));
      if (portal && portal.requires && !this.questDone(portal.requires)) {
        if (this.time - this.portalNoticeAt >= NOTICE_SECONDS) {
          this.portalNoticeAt = this.time;
          this.emit({ type: 'message', text: `${portal.name}还去不了` });
        }
      } else if (portal) {
        this.changeMap(portal.toMap, { x: portal.toX, y: portal.toY });
        return;
      }
      const current = player.order;
      const walking =
        current?.type === 'move' ||
        current?.type === 'pickup' ||
        (current?.type === 'talk' && cellDistance(player.cell, current.npc) > TALK_RANGE);
      if (walking && player.path.length === 0) {
        player.order = null;
      }
    }
  }

  /** Boss 刷新时全图提示，在别的地图也能收到。 */
  private announceBosses(): void {
    for (const [spawnKey, readyAt] of Object.entries(this.bossReadyAt)) {
      if (readyAt > this.time) continue;
      delete this.bossReadyAt[spawnKey];
      const [mapId = '', index = '0'] = spawnKey.split(':');
      const map = this.config.maps[mapId];
      const monster = this.config.monsters[map?.spawns[Number(index)]?.monster ?? ''];
      if (map && monster) this.emit({ type: 'bossReady', name: monster.name, mapName: map.name });
    }
  }

  private tickMonster(monster: Monster, dt: number): void {
    if (!monster.hp) {
      monster.respawnLeft -= dt;
      if (monster.respawnLeft <= 0) this.respawnMonster(monster);
      return;
    }
    this.tickEffects(monster, dt);
    for (const [id, left] of Object.entries(monster.abilityCooldowns)) {
      monster.abilityCooldowns[id] = Math.max(0, left - dt);
    }
    if (monster.hp && monster.stunLeft > 0) {
      monster.stunLeft -= dt;
      return;
    }
    if (!monster.hp || this.tickAttackTimers(monster, dt)) return;

    const fromHome = cellDistance(monster.cell, monster.home);
    if (monster.mode === 'idle') {
      const target = this.nearestHostile(monster);
      if (target) {
        monster.mode = 'chase';
        monster.target = target;
        monster.path = [];
        monster.repathLeft = 0;
      }
    }
    if (monster.mode === 'chase' && (!monster.target?.hp || fromHome > monster.def.leashRange)) {
      monster.mode = 'return';
      monster.target = null;
      monster.pending = null;
      this.planPath(monster, monster.home, false);
    }

    if (monster.mode === 'chase' && monster.target) {
      if (!this.abilities.tryAbility(monster, monster.target)) this.pursueAndAttack(monster, monster.target, dt);
    } else if (monster.mode === 'return') {
      if (monster.path.length === 0 && !this.isStepping(monster)) {
        monster.mode = 'idle';
        this.resetMonster(monster);
      }
    } else {
      this.tickWander(monster, dt);
    }
    this.advance(monster, dt);
  }

  private tickSummon(summon: Summon, dt: number): void {
    summon.lifeLeft -= dt;
    if (summon.lifeLeft <= 0) {
      this.killSummon(summon);
      return;
    }
    if (this.tickAttackTimers(summon, dt)) return;

    const player = this.player;
    const order = player.order;
    const ordered = order?.type === 'attack' || order?.type === 'cast' ? order.target : null;
    if (!summon.target?.hp) summon.target = null;
    summon.target = ordered ?? summon.target ?? this.nearestMonster(summon.cell, summon.def.aggroRange);

    const fromPlayer = cellDistance(summon.cell, player.cell);
    if (fromPlayer > SUMMON_TELEPORT_DISTANCE) {
      const cell = this.grid.nearest(player.cell, (c) => this.isFree(c, summon));
      if (cell) {
        summon.cell = { ...cell };
        summon.pos = { ...cell };
        summon.path = [];
        summon.target = null;
      }
    } else if (summon.target) {
      this.pursueAndAttack(summon, summon.target, dt);
    } else if (fromPlayer > SUMMON_FOLLOW_DISTANCE) {
      summon.repathLeft -= dt;
      if (summon.repathLeft <= 0) {
        summon.repathLeft = REPATH_SECONDS;
        this.planPath(summon, player.cell, true);
      }
    }
    this.advance(summon, dt);
  }

  private tickWander(monster: Monster, dt: number): void {
    monster.wanderLeft -= dt;
    if (monster.wanderLeft > 0 || monster.path.length > 0) return;
    monster.wanderLeft =
      WANDER_MIN_SECONDS + this.rng.next() * (WANDER_MAX_SECONDS - WANDER_MIN_SECONDS);
    const radius = monster.def.wanderRadius;
    const goal = {
      x: monster.home.x + this.rng.int(-radius, radius),
      y: monster.home.y + this.rng.int(-radius, radius),
    };
    if (this.grid.isWalkable(goal)) this.planPath(monster, goal, false);
  }

  private tickRegen(dt: number): void {
    const player = this.player;
    player.mp = Math.min(
      player.stats.maxMp,
      player.mp + player.stats.maxMp * MANA_FRACTION_PER_SECOND * dt,
    );
    if (this.time - player.lastHurtAt < REGEN_DELAY_SECONDS) return;
    player.hp = Math.min(
      player.stats.maxHp,
      player.hp + player.stats.maxHp * REGEN_FRACTION_PER_SECOND * dt,
    );
  }

  private tickEffects(unit: Unit, dt: number): void {
    if (unit.effects.length === 0) return;
    for (const effect of [...unit.effects]) {
      effect.left -= dt;
      if (effect.kind === 'dot') {
        effect.nextTick -= dt;
        if (effect.nextTick <= 0 && unit.hp > 0) {
          effect.nextTick += effect.interval;
          this.dealDamage(effect.source, unit, effect.amount, false);
        }
      }
    }
    unit.effects = unit.effects.filter((effect) => effect.left > 0);
  }

  /** 推进攻击计时，返回 true 表示单位正在出招、本帧不能行动。 */
  private tickAttackTimers(unit: Unit, dt: number): boolean {
    unit.attackCooldown = Math.max(0, unit.attackCooldown - dt);
    if (unit.windupLeft <= 0) return false;
    unit.windupLeft -= dt;
    if (unit.windupLeft > 0) return true;

    const pending = unit.pending;
    unit.pending = null;
    if (pending?.ability) this.abilities.resolve(unit, pending.ability, pending.cells ?? []);
    else if (pending?.skill) this.applySkill(unit, pending.skill, pending.target);
    else if (pending?.target?.hp) this.resolveHit(unit, pending.target);
    return false;
  }

  /** 靠近目标，进入 range 后执行 act。 */
  private pursue(unit: Unit, target: Unit, dt: number, range: number, act: () => void): void {
    if (cellDistance(unit.cell, target.cell) <= range) {
      unit.path = [];
      if (!this.isStepping(unit)) act();
      return;
    }
    unit.repathLeft -= dt;
    if (unit.repathLeft > 0 && unit.path.length > 0) return;
    unit.repathLeft = REPATH_SECONDS;
    this.planPath(unit, target.cell, true);
  }

  private pursueAndAttack(unit: Unit, target: Unit, dt: number): void {
    this.pursue(unit, target, dt, unit.attackRange, () => {
      if (unit.attackCooldown > 0) return;
      unit.attackCooldown = unit.attackInterval;
      unit.windupLeft = unit.attackWindup;
      unit.pending = { target, skill: null };
      unit.facing = direction(unit.cell, target.cell);
      this.emit({ type: 'attackStart', unit, target, color: null });
    });
  }

  private resetMonster(monster: Monster): void {
    monster.stats = monster.def.stats;
    monster.hp = monster.stats.maxHp;
    monster.effects = [];
    monster.phase = 0;
    monster.abilityCooldowns = {};
  }

  private startCast(unit: Player, skill: SkillDef, target: Unit | null): void {
    if (unit.mp < skill.mpCost || (unit.skillCooldowns[skill.id] ?? 0) > 0) return;
    unit.mp -= skill.mpCost;
    unit.skillCooldowns[skill.id] = skill.cooldown;
    unit.attackCooldown = Math.max(unit.attackCooldown, skill.windup);
    unit.windupLeft = skill.windup;
    unit.pending = { target, skill };
    if (target) unit.facing = direction(unit.cell, target.cell);
    this.emit({ type: 'attackStart', unit, target, color: skill.color });
  }

  private applySkill(caster: Unit, skill: SkillDef, target: Unit | null): void {
    const { effect } = skill;
    const cells = skillArea(skill, caster.cell, target?.cell ?? null);
    this.emit({ type: 'skillCast', unit: caster, skill, cells });

    switch (effect.type) {
      case 'damage': {
        const power = effect.multiplier * this.inventory.skillPower(skill.id);
        const hit = this.monsters.filter(
          (monster) => monster.hp > 0 && cells.some((cell) => sameCell(cell, monster.cell)),
        );
        for (const monster of hit) {
          this.resolveHit(caster, monster, { stat: effect.stat, multiplier: power });
          if (effect.knockback && monster.hp > 0) {
            this.knockBack(monster, caster.cell, effect.knockback);
          }
        }
        break;
      }
      case 'dot': {
        if (!target?.hp) break;
        target.effects = target.effects.filter((e) => e.kind !== 'dot' || e.source !== caster);
        target.effects.push({
          kind: 'dot',
          left: effect.duration,
          amount: Math.max(
            1,
            Math.round(
              caster.stats[effect.stat].max * effect.multiplier * this.inventory.skillPower(skill.id),
            ),
          ),
          interval: effect.interval,
          nextTick: effect.interval,
          source: caster,
        });
        this.aggro(target, caster);
        break;
      }
      case 'heal': {
        const roll = this.rng.int(caster.stats[effect.stat].min, caster.stats[effect.stat].max);
        const amount = Math.min(
          Math.round(roll * effect.multiplier) + effect.flat,
          caster.stats.maxHp - caster.hp,
        );
        caster.hp += amount;
        this.emit({ type: 'heal', amount });
        break;
      }
      case 'shield':
        this.addEffect(caster, 'shield', effect.reduction, effect.duration);
        break;
      case 'defense':
        this.addEffect(caster, 'defense', effect.amount, effect.duration);
        break;
      case 'empower':
        this.addEffect(caster, 'empower', effect.multiplier, effect.duration);
        break;
      case 'summon':
        this.summon(effect.monster, effect.hpPerLevel, effect.duration);
        break;
      case 'charge': {
        if (!target?.hp) break;
        this.dashTo(caster, target);
        // 落地震开身边一圈，目标和贴身的怪都挨一击并定身
        const hit = this.monsters.filter(
          (monster) => monster.hp > 0 && (monster === target || cellDistance(monster.cell, caster.cell) <= 1),
        );
        const power = effect.multiplier * this.inventory.skillPower(skill.id);
        for (const monster of hit) {
          this.resolveHit(caster, monster, { stat: effect.stat, multiplier: power });
          if (monster.hp > 0) {
            monster.stunLeft = Math.max(monster.stunLeft, effect.stun);
            this.emit({ type: 'stunned', unit: monster });
          }
        }
        break;
      }
      case 'field':
        this.groundFields.add({
          caster,
          cells,
          duration: effect.duration,
          interval: effect.interval,
          stat: effect.stat,
          multiplier: effect.multiplier * this.inventory.skillPower(skill.id),
          color: skill.color,
          hostile: false,
        });
        break;
    }
  }

  private addEffect(unit: Unit, kind: 'shield' | 'defense' | 'empower', amount: number, duration: number): void {
    unit.effects = unit.effects.filter((effect) => effect.kind !== kind);
    unit.effects.push({ kind, left: duration, amount, interval: 0, nextTick: 0, source: unit });
  }

  private summon(monsterId: string, hpPerLevel: number, duration: number): void {
    const def = this.config.monsters[monsterId];
    const player = this.player;
    const cell = this.grid.nearest(player.cell, (c) => this.isFree(c, player) && !sameCell(c, player.cell));
    if (!def || !cell) return;
    for (const existing of [...this.summons]) this.killSummon(existing);

    const stats: CombatStats = {
      ...def.stats,
      maxHp: def.stats.maxHp + hpPerLevel * player.level,
      attack: { ...player.stats.dao },
    };
    const unit: Summon = {
      ...this.createUnit(def.name, cell, stats, this.monsterTiming(def)),
      kind: 'summon',
      def,
      target: null,
      lifeLeft: duration,
    };
    this.summons.push(unit);
    this.emit({ type: 'summoned', unit });
  }

  /** 闪到目标身边离自己最近的空格，已经贴身就不动。 */
  private dashTo(unit: Unit, target: Unit): void {
    if (cellDistance(unit.cell, target.cell) <= 1) return;
    let best: Cell | null = null;
    for (let y = target.cell.y - 1; y <= target.cell.y + 1; y++) {
      for (let x = target.cell.x - 1; x <= target.cell.x + 1; x++) {
        const cell = { x, y };
        if (!this.isFree(cell, unit)) continue;
        if (!best || cellDistance(unit.cell, cell) < cellDistance(unit.cell, best)) best = cell;
      }
    }
    if (!best) return;
    unit.cell = best;
    unit.pos = { ...best };
    unit.path = [];
    unit.repathLeft = 0;
    unit.facing = direction(unit.cell, target.cell);
  }

  private knockBack(unit: Unit, from: Cell, distance: number): void {
    const dir = direction(from, unit.cell);
    for (let i = 0; i < distance; i++) {
      const next = { x: unit.cell.x + dir.x, y: unit.cell.y + dir.y };
      if (!this.isFree(next, unit)) break;
      unit.cell = next;
    }
    unit.pos = { ...unit.cell };
    unit.path = [];
    unit.repathLeft = 0;
  }

  private resolveHit(attacker: Unit, target: Unit, options: AttackOptions = {}): void {
    const stat = options.stat ?? attacker.attackStat;
    const empower = attacker.effects.find((effect) => effect.kind === 'empower')?.amount ?? 0;
    const result = rollAttack(attacker.stats, this.defendingStats(target), this.rng, {
      stat,
      multiplier: (options.multiplier ?? 1) * (1 + empower),
    });
    if (!result.hit) {
      this.emit({ type: 'miss', unit: target });
      this.aggro(target, attacker);
      return;
    }
    this.dealDamage(attacker, target, result.damage, result.maxRoll);
    if (attacker === this.player && target.hp > 0) this.tryStun(target);
  }

  private tryStun(target: Unit): void {
    const ring = this.inventory.special('stun');
    if (!ring || !this.rng.chance(ring.chance)) return;
    target.stunLeft = ring.seconds;
    this.emit({ type: 'stunned', unit: target });
  }

  private defendingStats(unit: Unit): CombatStats {
    const bonus = unit.effects.find((effect) => effect.kind === 'defense')?.amount ?? 0;
    if (!bonus) return unit.stats;
    return {
      ...unit.stats,
      defense: { min: unit.stats.defense.min + bonus, max: unit.stats.defense.max + bonus },
    };
  }

  private dealDamage(source: Unit, target: Unit, raw: number, maxRoll: boolean): void {
    const shield = target.effects.find((effect) => effect.kind === 'shield')?.amount ?? 0;
    let amount = Math.max(1, Math.round(raw * (1 - shield)));
    if (target === this.player) amount -= this.absorbWithMana(amount);
    target.hp = Math.max(0, target.hp - amount);
    this.emit({ type: 'damage', unit: target, amount, maxRoll, source });

    if (target === this.player) this.player.lastHurtAt = this.time;
    this.aggro(target, source);
    if (target.hp > 0) {
      const monster = this.monsters.find((candidate) => candidate === target);
      if (monster) this.abilities.checkPhase(monster);
      return;
    }

    if (target === this.player) {
      if (!this.tryRevive()) this.killPlayer();
    } else if (this.monsters.includes(target as Monster)) this.killMonster(target as Monster);
    else this.killSummon(target as Summon);
  }

  /** 护身戒：一部分伤害由灵力承担。 */
  private absorbWithMana(amount: number): number {
    const { player } = this;
    const ring = this.inventory.special('manaShield');
    if (!ring) return 0;
    const absorbed = Math.min(Math.floor(amount * ring.ratio), Math.floor(player.mp));
    player.mp -= absorbed;
    return absorbed;
  }

  /** 涅槃戒：致命伤时原地复活，有冷却。 */
  private tryRevive(): boolean {
    const { player } = this;
    const ring = this.inventory.special('revive');
    if (!ring || this.time < player.reviveReadyAt) return false;
    player.reviveReadyAt = this.time + ring.seconds;
    player.hp = Math.ceil(player.stats.maxHp * ring.ratio);
    this.emit({ type: 'revived' });
    return true;
  }

  private aggro(target: Unit, source: Unit): void {
    const monster = this.monsters.find((candidate) => candidate === target);
    if (!monster || monster.mode === 'return') return;
    monster.mode = 'chase';
    monster.target = this.ignoresSummons(monster) && source !== this.player ? this.player : source;
  }

  /** Boss 只盯着玩家，召唤物抢不走仇恨。 */
  private ignoresSummons(monster: Monster): boolean {
    return !!monster.def.boss && this.player.hp > 0;
  }

  /** 死亡时按概率随机掉 1 件身上的法器，低等级和短时间内连死不掉。 */
  private dropWornEquipment(): void {
    const player = this.player;
    const { dropChance, autoDropChance, pickupSeconds, safeLevel, graceSeconds } =
      this.config.affixes.death;
    const inGrace = this.time - player.lastDeathAt < graceSeconds;
    const chance = player.auto.enabled ? autoDropChance : dropChance;
    player.lastDeathAt = this.time;
    if (player.level <= safeLevel || inGrace || !this.rng.chance(chance)) return;

    const worn = EQUIP_SLOTS.filter((slot) => player.equipment[slot]);
    const slot = worn.at(this.rng.int(0, worn.length - 1));
    const equipment = slot && player.equipment[slot];
    const def = equipment && this.config.items[equipment.itemId];
    const cell = this.grid.nearest(player.cell, (c) => this.canDropAt(c));
    if (!slot || !equipment || !def || !cell) return;
    delete player.equipment[slot];
    const item = this.spawnItem(def, 1, equipment, cell, pickupSeconds);
    this.deathDrops.push({ mapId: this.mapId, item });
    this.emit({ type: 'deathDrop', name: equipmentName(equipment, this.config) });
    refreshStats(player, this.config, this.time);
  }

  private killPlayer(): void {
    const player = this.player;
    this.dropWornEquipment();
    player.order = null;
    player.path = [];
    player.respawnLeft = RESPAWN_SECONDS;
    player.windupLeft = 0;
    player.pending = null;
    player.queuedSkill = null;
    player.route = null;
    player.effects = [];
    this.emit({ type: 'death', unit: player });
    this.emit({ type: 'message', text: '你被击败了，即将回到出生点' });
  }

  private respawnPlayer(): void {
    const player = this.player;
    const { respawn, playerStart } = this.map;
    player.hp = player.stats.maxHp;
    player.mp = player.stats.maxMp;
    player.lastHurtAt = this.time;
    if (respawn && respawn.map !== this.mapId) {
      this.changeMap(respawn.map, respawn);
    } else {
      const target = respawn ?? playerStart;
      const cell = this.grid.nearest(target, (c) => this.isFree(c, player)) ?? target;
      player.cell = { x: cell.x, y: cell.y };
      player.pos = { x: cell.x, y: cell.y };
    }
    this.emit({ type: 'respawn', unit: player });
  }

  private killMonster(monster: Monster): void {
    if (monster.temporary) {
      this.player.kills[monster.def.id] = (this.player.kills[monster.def.id] ?? 0) + 1;
      this.monsters.splice(this.monsters.indexOf(monster), 1);
      this.emit({ type: 'death', unit: monster });
      this.gainExp(monster.def.exp);
      return;
    }
    monster.path = [];
    monster.respawnLeft = monster.def.respawnSeconds;
    monster.windupLeft = 0;
    monster.pending = null;
    monster.target = null;
    monster.effects = [];
    const kills = this.player.kills[monster.def.id] ?? 0;
    this.player.kills[monster.def.id] = kills + 1;
    const firstKill = kills === 0;
    if (monster.def.boss) {
      this.bossReadyAt[monster.spawnKey] = this.time + monster.def.respawnSeconds;
      this.emit({ type: 'message', text: firstKill ? `首次击败${monster.name}` : `${monster.name}已被击败` });
    }
    this.emit({ type: 'death', unit: monster });
    this.rollDrops(monster, firstKill && !!monster.def.boss);
    this.advanceQuests('kill', monster.def.id);
    this.gainExp(monster.def.exp);
  }

  private killSummon(summon: Summon): void {
    summon.hp = 0;
    this.summons.splice(this.summons.indexOf(summon), 1);
    for (const monster of this.monsters) {
      if (monster.target === summon) monster.target = null;
    }
    this.emit({ type: 'death', unit: summon });
  }

  private respawnMonster(monster: Monster): void {
    const cell = this.grid.nearest(monster.home, (c) => this.isFree(c, monster));
    if (!cell) {
      monster.respawnLeft = 1;
      return;
    }
    monster.cell = { ...cell };
    monster.pos = { ...cell };
    this.resetMonster(monster);
    monster.mode = 'idle';
    this.emit({ type: 'respawn', unit: monster });
  }

  /** Boss 掉的法器至少是中品，首杀必掉专属法器。 */
  private rollDrops(monster: Monster, firstKill = false): void {
    const minGrade = monster.def.boss ? 1 : 0;
    for (const entry of monsterDrops(this.config, monster.def)) {
      if (!(firstKill && entry.firstKill) && !this.rng.chance(entry.chance)) continue;
      const def = this.config.items[entry.item];
      const cell = this.grid.nearest(monster.cell, (c) => this.canDropAt(c));
      if (!def || !cell) continue;
      const equipment =
        def.kind === 'equip'
          ? rollEquipment(def, this.config.affixes, this.rng, this.nextId++, minGrade)
          : null;
      this.spawnItem(def, this.rng.int(entry.min ?? 1, entry.max ?? 1), equipment, cell);
    }
  }

  private canDropAt(cell: Cell): boolean {
    return this.grid.isWalkable(cell) && !this.items.some((item) => sameCell(item.cell, cell));
  }

  private spawnItem(
    def: ItemDef,
    amount: number,
    equipment: Equipment | null,
    cell: Cell,
    lifetime = GROUND_ITEM_SECONDS,
  ): GroundItem {
    const item: GroundItem = {
      id: this.nextId++,
      def,
      amount,
      equipment,
      cell,
      expiresAt: this.time + lifetime,
    };
    this.items.push(item);
    this.emit({ type: 'itemDropped', item });
    return item;
  }

  private gainExp(amount: number): void {
    const player = this.player;
    player.exp += amount;
    if (amount > 0) this.emit({ type: 'expGained', amount });
    for (;;) {
      const needed = this.expToNext;
      if (needed === null || player.exp < needed) return;
      if (pendingBreakthrough(this.config.realms, player.level, player.realmPassed)) {
        player.exp = needed;
        return;
      }
      player.exp -= needed;
      player.level += 1;
      refreshStats(this.player, this.config, this.time);
      player.hp = player.stats.maxHp;
      player.mp = player.stats.maxMp;
      this.emit({ type: 'levelUp', level: player.level });
      this.learnSkills();
    }
  }

  /** 只有 1 级的起手功法自动领悟，其余要靠功法书。 */
  private learnSkills(): void {
    const player = this.player;
    for (const skill of Object.values(this.config.skills)) {
      if (skill.classId === player.def.id && skill.level <= 1) this.inventory.learnSkill(skill.id);
    }
  }

  /** 灵石和丹药材料不用走到格子上：出招时也生效，物品飞向角色。 */
  private attractItems(): void {
    const { player } = this;
    const { goldRadius, itemRadius } = this.config.game.pickup;
    for (const item of [...this.items]) {
      if (item.equipment || item.discarded) continue;
      const radius = item.def.kind === 'gold' ? goldRadius : itemRadius;
      if (cellDistance(player.cell, item.cell) > radius) continue;
      this.removeItem(item);
      this.emit({ type: 'pickedUp', item, magnet: true });
      this.takeStack(item);
    }
  }

  private takeStack(item: GroundItem): void {
    if (item.def.kind === 'gold') this.player.gold += item.amount;
    else this.inventory.addToBag(item.def.id, item.amount);
  }

  /** 一键捡起范围内达到品阶线的法器，不捡玩家自己丢弃的。死亡掉落不受品阶线限制。 */
  pickupNearbyEquipment(): void {
    const { player, config } = this;
    if (!player.hp) return;
    const { grades } = config.affixes;
    const lowest = grades.findIndex((grade) => grade.id === player.auto.minGrade);
    const nearby = this.items.filter((item) => {
      if (!item.equipment || item.discarded) return false;
      if (cellDistance(player.cell, item.cell) > config.game.pickup.equipmentRadius) return false;
      const isDeathDrop = this.deathDrops.some((drop) => drop.item === item);
      return isDeathDrop || grades.findIndex((g) => g.id === item.equipment?.grade) >= lowest;
    });
    for (const item of nearby) {
      if (!this.inventory.takeEquipment(item.equipment!)) return;
      this.removeItem(item);
      this.emit({ type: 'pickedUp', item, magnet: true });
    }
  }

  private collectItemsAt(cell: Cell): void {
    for (const item of this.items.filter((candidate) => sameCell(candidate.cell, cell))) {
      if (item.equipment && !this.inventory.takeEquipment(item.equipment)) continue;
      this.removeItem(item);
      this.emit({ type: 'pickedUp', item, magnet: false });
      if (!item.equipment) this.takeStack(item);
    }
  }

  private expireItems(): void {
    for (const item of this.items.filter((candidate) => candidate.expiresAt <= this.time)) {
      this.removeItem(item);
    }
    this.deathDrops = this.deathDrops.filter(({ item }) => item.expiresAt > this.time);
  }

  private removeItem(item: GroundItem): void {
    this.deathDrops = this.deathDrops.filter((drop) => drop.item !== item);
    this.items.splice(this.items.indexOf(item), 1);
    this.emit({ type: 'itemRemoved', item });
  }

  // ---- 目标选择 ----

  private nearestMonster(origin: Cell, range: number): Monster | null {
    let best: Monster | null = null;
    let bestDistance = range + 1;
    for (const monster of this.monsters) {
      const distance = cellDistance(origin, monster.cell);
      if (monster.hp > 0 && distance < bestDistance) {
        best = monster;
        bestDistance = distance;
      }
    }
    return best;
  }

  private nearestHostile(monster: Monster): Unit | null {
    let best: Unit | null = null;
    let bestDistance = monster.def.aggroRange + 1;
    const candidates = this.ignoresSummons(monster) ? [this.player] : [this.player, ...this.summons];
    for (const unit of candidates) {
      const distance = cellDistance(monster.cell, unit.cell);
      if (unit.hp > 0 && distance < bestDistance) {
        best = unit;
        bestDistance = distance;
      }
    }
    return best;
  }

  // ---- 移动 ----

  private planPath(unit: Unit, goal: Cell, stopAdjacent: boolean): void {
    const path = findPath(
      this.grid,
      unit.cell,
      goal,
      (cell) => sameCell(cell, goal) || this.isFree(cell, unit),
      unit === this.player ? Infinity : MONSTER_SEARCH_LIMIT,
    );
    if (!path) {
      unit.path = [];
      return;
    }
    if (stopAdjacent) path.pop();
    unit.path = path;
  }

  /** 沿路径前进，本帧走不完的距离留到下一格继续用。 */
  private advance(unit: Unit, dt: number): void {
    const speed = unit === this.player && this.playerRunning ? this.config.game.runMultiplier : 1;
    let budget = unit.moveSpeed * speed * dt;
    while (budget > 0) {
      if (!this.isStepping(unit)) {
        const next = unit.path[0];
        if (!next) return;
        if (!this.isFree(next, unit)) {
          unit.path = [];
          unit.repathLeft = 0;
          if (unit === this.player && this.player.order?.type === 'move') {
            this.planPath(unit, this.player.order.cell, false);
          }
          return;
        }
        unit.path.shift();
        unit.facing = direction(unit.cell, next);
        unit.cell = { ...next };
      }
      const dx = unit.cell.x - unit.pos.x;
      const dy = unit.cell.y - unit.pos.y;
      const distance = Math.hypot(dx, dy);
      const moved = Math.min(distance, budget);
      unit.pos.x += (dx / distance) * moved;
      unit.pos.y += (dy / distance) * moved;
      if (moved === distance) unit.pos = { ...unit.cell };
      budget -= moved;
    }
  }

  private isStepping(unit: Unit): boolean {
    return unit.pos.x !== unit.cell.x || unit.pos.y !== unit.cell.y;
  }

  private isFree(cell: Cell, self: Unit): boolean {
    if (!this.grid.isWalkable(cell)) return false;
    const taken = (unit: Unit) => unit !== self && unit.hp > 0 && sameCell(unit.cell, cell);
    return !taken(this.player) && !this.monsters.some(taken) && !this.summons.some(taken);
  }

  private monsterTiming(def: MonsterDef) {
    return { ...def, attackRange: def.attackRange ?? 1, attackStat: 'attack' as const };
  }

  private createUnit(
    name: string,
    cell: Cell,
    stats: CombatStats,
    timing: {
      moveSpeed: number;
      attackInterval: number;
      attackWindup: number;
      attackRange: number;
      attackStat: DamageStat;
    },
  ): Unit {
    return {
      id: this.nextId++,
      name,
      cell: { x: cell.x, y: cell.y },
      pos: { x: cell.x, y: cell.y },
      facing: { x: 1, y: 1 },
      hp: stats.maxHp,
      mp: stats.maxMp,
      stats,
      moveSpeed: timing.moveSpeed,
      attackInterval: timing.attackInterval,
      attackWindup: timing.attackWindup,
      attackRange: timing.attackRange,
      attackStat: timing.attackStat,
      path: [],
      attackCooldown: 0,
      windupLeft: 0,
      pending: null,
      repathLeft: 0,
      effects: [],
      stunLeft: 0,
    };
  }

  private emit(event: GameEvent): void {
    this.events.push(event);
  }
}

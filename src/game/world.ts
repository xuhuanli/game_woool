import { AutoPlay, defaultAutoSettings } from './autoPlay';
import { rollAttack, type AttackOptions } from './combat';
import type {
  AbilityDef,
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
import { equipmentName, EQUIP_SLOTS, rollEquipment, type Equipment } from './equipment';
import { cellDistance, Grid, sameCell } from './grid';
import { Inventory } from './inventory';
import {
  estimateIncome,
  OFFLINE_EFFICIENCY,
  OFFLINE_MAX_EQUIPMENT,
  OFFLINE_MAX_SECONDS,
  OFFLINE_MIN_SECONDS,
} from './offline';
import { findPath } from './pathfinding';
import { emptyQuestState, questStatus, recordObjective } from './quests';
import { breakthroughChance, pendingBreakthrough } from './realm';
import { Rng } from './rng';
import { SAVE_VERSION, type SaveData } from '../save/saveData';
import { needsTarget, skillArea } from './skills';
import { refreshStats } from './stats';
import type {
  DeathDrop,
  GameEvent,
  GroundItem,
  HotbarEntry,
  Monster,
  OfflineReport,
  Player,
  Summon,
  Unit,
  Vec,
} from './types';

export * from './types';

export const TICK_SECONDS = 0.05;
export const HOTBAR_SIZE = 8;

const REPATH_SECONDS = 0.3;
const RESPAWN_SECONDS = 3;
const GROUND_ITEM_SECONDS = 90;
const REGEN_DELAY_SECONDS = 5;
const REGEN_FRACTION_PER_SECOND = 0.02;
const MANA_FRACTION_PER_SECOND = 0.03;
const WANDER_MIN_SECONDS = 2;
const WANDER_MAX_SECONDS = 6;
const SUMMON_FOLLOW_DISTANCE = 2;
const SUMMON_TELEPORT_DISTANCE = 12;
const NOTICE_SECONDS = 3;
const TALK_RANGE = 2;
const INTERACT_RANGE = 4;

export class World {
  grid: Grid;
  mapId: string;
  readonly player: Player;
  readonly inventory: Inventory;
  readonly autoPlay: AutoPlay;
  readonly monsters: Monster[] = [];
  readonly summons: Summon[] = [];
  readonly items: GroundItem[] = [];
  /** Boss 下次刷新的游戏内时间，切图后继续计时 */
  bossReadyAt: Record<string, number> = {};
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
      weakUntil: 0,
      lastDeathAt: -Infinity,
      auto: defaultAutoSettings(),
      lastFieldMap: null,
      skills: [],
      skillCooldowns: {},
      hotbar,
      order: null,
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
    );
    this.autoPlay = new AutoPlay(this);
    this.learnSkills();
    this.loadMap(mapId);
    this.drainEvents();
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
      const monster: Monster = {
        ...this.createUnit(def.name, spawn, def.stats, this.monsterTiming(def)),
        kind: 'monster',
        def,
        home: { x: spawn.x, y: spawn.y },
        spawnKey,
        mode: 'idle',
        target: null,
        abilityCooldowns: {},
        phase: 0,
        wanderLeft: this.rng.next() * WANDER_MAX_SECONDS,
        respawnLeft: 0,
      };
      const waiting = (this.bossReadyAt[spawnKey] ?? 0) - this.time;
      if (waiting > 0) {
        monster.hp = 0;
        monster.respawnLeft = waiting;
      }
      this.monsters.push(monster);
    });
  }

  private changeMap(mapId: string, cell: Cell): void {
    const player = this.player;
    player.order = null;
    player.path = [];
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
  static fromSave(config: GameConfig, save: SaveData, seed: number): World {
    const { player } = save;
    const world = new World(config, save.mapId, player.classId, seed, player.name);
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
    player.weakUntil = data.weakUntil;
    player.lastDeathAt = data.lastDeathAt ?? -Infinity;
    player.auto = { ...data.auto, enabled: false };
    player.lastFieldMap = data.lastFieldMap ?? player.lastFieldMap;
    player.skills = data.skills.filter((id) => skills[id]);
    player.hotbar = data.hotbar.map((entry) => {
      const exists = entry?.kind === 'skill' ? skills[entry.id] : entry && items[entry.id];
      return exists ? entry : null;
    });
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

  moveTo(cell: Cell): void {
    const goal = this.grid.nearest(cell, (c) => this.grid.isWalkable(c));
    if (!goal || !this.player.hp) return;
    this.player.order = { type: 'move', cell: goal };
    this.player.repathLeft = 0;
    this.planPath(this.player, goal, false);
    this.autoPlay.pauseForManualInput();
  }

  attack(target: Monster): void {
    if (!this.player.hp || !target.hp) return;
    this.player.order = { type: 'attack', target };
    this.player.repathLeft = 0;
  }

  pickup(item: GroundItem): void {
    if (!this.player.hp) return;
    this.player.order = { type: 'pickup', itemId: item.id };
    this.planPath(this.player, item.cell, false);
  }

  /** 回到复活点，用于低血自动回城。 */
  recall(): void {
    const target = this.map.respawn ?? { ...this.map.playerStart, map: this.mapId };
    this.emit({ type: 'message', text: '生命过低，已回城' });
    this.changeMap(target.map, target);
  }

  /** 结算闭关收益：最多 8 小时，效率为在线的一半，只有经验和灵石。 */
  settleOffline(savedAt: number, now: number): OfflineReport | null {
    const player = this.player;
    const seconds = Math.min((now - savedAt) / 1000, OFFLINE_MAX_SECONDS);
    if (seconds < OFFLINE_MIN_SECONDS) return null;

    const mapId = player.lastFieldMap ?? Object.values(this.config.maps).find((map) => !map.safe)?.id;
    const map = mapId ? this.config.maps[mapId] : undefined;
    if (!map) return null;
    const income = estimateIncome(
      this.config,
      map,
      player.stats,
      player.def.primaryStat,
      player.attackInterval,
    );
    const { expPerSecond, goldPerSecond } = income;
    const exp = Math.floor(expPerSecond * seconds * OFFLINE_EFFICIENCY);
    let gold = Math.floor(goldPerSecond * seconds * OFFLINE_EFFICIENCY);
    const kills = income.killsPerSecond * seconds * OFFLINE_EFFICIENCY;
    const { equipment, soldGold, soldCount } = this.rollOfflineEquipment(kills, income.equipmentPerKill);
    gold += soldGold;
    player.gold += gold;
    this.gainExp(exp);
    return { seconds, exp, gold, equipment, soldCount };
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
        soldGold += this.sellPrice(rolled);
        soldCount += 1;
      } else {
        this.player.equipBag.push(rolled);
        equipment.push(equipmentName(rolled, this.config));
      }
    }
    return { equipment, soldGold, soldCount };
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

  /** 把背包里的法器丢到脚边，丢弃后仍可捡回。 */
  discard(uid: number): void {
    const player = this.player;
    const equipment = player.equipBag.find((candidate) => candidate.uid === uid);
    const item = equipment && this.config.items[equipment.itemId];
    const cell = this.grid.nearest(player.cell, (c) => this.canDropAt(c) && !sameCell(c, player.cell));
    if (!player.hp || !equipment || !item || !cell) return;
    player.equipBag.splice(player.equipBag.indexOf(equipment), 1);
    this.spawnItem(item, 1, equipment, cell).discarded = true;
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

  buy(npc: NpcDef, itemId: string): void {
    const player = this.player;
    const item = this.config.items[itemId];
    if (!item?.price || !npc.shop?.includes(itemId) || !this.isNear(npc)) return;
    if (player.gold < item.price) {
      this.emit({ type: 'message', text: '灵石不足' });
      return;
    }
    if (item.kind === 'equip') {
      const lowest = { ...this.config.affixes, grades: this.config.affixes.grades.slice(0, 1) };
      if (!this.inventory.takeEquipment(rollEquipment(item, lowest, this.rng, this.nextId++))) return;
    } else {
      this.inventory.addToBag(itemId, 1);
    }
    player.gold -= item.price;
    this.emit({ type: 'goldChanged', amount: -item.price });
  }

  sellPrice(equipment: Equipment): number {
    const { affixes, items } = this.config;
    const grade = affixes.grades.find((candidate) => candidate.id === equipment.grade);
    const price = items[equipment.itemId]?.price ?? 0;
    return Math.floor(price * affixes.sellRatio * (grade?.sellMultiplier ?? 1));
  }

  sellEquipment(npc: NpcDef, uid: number): void {
    const player = this.player;
    const equipment = player.equipBag.find((candidate) => candidate.uid === uid);
    if (!equipment || !npc.shop || !this.isNear(npc)) return;
    player.equipBag.splice(player.equipBag.indexOf(equipment), 1);
    const price = this.sellPrice(equipment);
    player.gold += price;
    this.emit({ type: 'goldChanged', amount: price });
  }

  sellItem(npc: NpcDef, itemId: string): void {
    const player = this.player;
    const price = this.config.items[itemId]?.price;
    if (!price || !player.bag[itemId] || !npc.shop || !this.isNear(npc)) return;
    this.inventory.removeFromBag(itemId);
    const earned = Math.floor(price * this.config.affixes.sellRatio);
    player.gold += earned;
    this.emit({ type: 'goldChanged', amount: earned });
  }

  travel(npc: NpcDef, index: number): void {
    const option = npc.travel?.[index];
    const player = this.player;
    if (!option || !this.isNear(npc)) return;
    if (option.requires && !this.questDone(option.requires)) {
      this.emit({ type: 'message', text: '这条路还没有打通' });
      return;
    }
    if ((option.level ?? 1) > player.level) {
      this.emit({ type: 'message', text: `需要等级 ${option.level}` });
      return;
    }
    if (player.gold < option.cost) {
      this.emit({ type: 'message', text: '灵石不足' });
      return;
    }
    player.gold -= option.cost;
    this.changeMap(option.map, option);
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
    this.tickPlayer(dt);
    for (const monster of this.monsters) this.tickMonster(monster, dt);
    for (const summon of [...this.summons]) this.tickSummon(summon, dt);
    this.expireItems();
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
      if (!this.tryAbility(monster, monster.target)) this.pursueAndAttack(monster, monster.target, dt);
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
    if (pending?.ability) this.resolveAbility(unit, pending.ability, pending.cells ?? []);
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

  /** 有技能可用时开始前摇，并在地面预警。 */
  private tryAbility(monster: Monster, target: Unit): boolean {
    if (this.isStepping(monster)) return false;
    const distance = cellDistance(monster.cell, target.cell);
    const ability = monster.def.abilities?.find(
      (candidate) =>
        distance <= candidate.range && (monster.abilityCooldowns[candidate.id] ?? 0) <= 0,
    );
    if (!ability) return false;
    const cells = abilityArea(ability, monster.cell, target.cell);
    monster.abilityCooldowns[ability.id] = ability.cooldown;
    monster.windupLeft = ability.windup;
    monster.pending = { target, skill: null, ability, cells };
    monster.facing = direction(monster.cell, target.cell);
    monster.path = [];
    this.emit({ type: 'attackStart', unit: monster, target: null, color: null });
    this.emit({
      type: 'telegraph',
      name: ability.name,
      cells,
      seconds: ability.windup,
      color: ability.color,
    });
    return true;
  }

  private resolveAbility(caster: Unit, ability: AbilityDef, cells: Cell[]): void {
    for (const unit of [this.player, ...this.summons]) {
      if (unit.hp > 0 && cells.some((cell) => sameCell(cell, unit.cell))) {
        this.resolveHit(caster, unit, { stat: 'attack', multiplier: ability.multiplier });
      }
    }
  }

  private resetMonster(monster: Monster): void {
    monster.stats = monster.def.stats;
    monster.hp = monster.stats.maxHp;
    monster.effects = [];
    monster.phase = 0;
    monster.abilityCooldowns = {};
  }

  /** 生命降到阈值时进入下一阶段，攻击力提高。 */
  private checkPhase(monster: Monster): void {
    const next = monster.def.phases?.[monster.phase];
    if (!next || monster.hp / monster.stats.maxHp >= next.hpBelow) return;
    monster.phase += 1;
    const { attack } = monster.stats;
    monster.stats = {
      ...monster.stats,
      attack: {
        min: Math.round(attack.min * next.attackMultiplier),
        max: Math.round(attack.max * next.attackMultiplier),
      },
    };
    this.emit({ type: 'message', text: next.message });
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
        const hit = this.monsters.filter(
          (monster) => monster.hp > 0 && cells.some((cell) => sameCell(cell, monster.cell)),
        );
        for (const monster of hit) {
          this.resolveHit(caster, monster, effect);
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
          amount: Math.max(1, Math.round(caster.stats[effect.stat].max * effect.multiplier)),
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
      case 'summon':
        this.summon(effect.monster, effect.hpPerLevel, effect.duration);
        break;
    }
  }

  private addEffect(unit: Unit, kind: 'shield' | 'defense', amount: number, duration: number): void {
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
    const result = rollAttack(attacker.stats, this.defendingStats(target), this.rng, {
      ...options,
      stat,
    });
    if (!result.hit) {
      this.emit({ type: 'miss', unit: target });
      this.aggro(target, attacker);
      return;
    }
    this.dealDamage(attacker, target, result.damage, result.maxRoll);
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
    const amount = Math.max(1, Math.round(raw * (1 - shield)));
    target.hp = Math.max(0, target.hp - amount);
    this.emit({ type: 'damage', unit: target, amount, maxRoll, source });

    if (target === this.player) this.player.lastHurtAt = this.time;
    this.aggro(target, source);
    if (target.hp > 0) {
      const monster = this.monsters.find((candidate) => candidate === target);
      if (monster) this.checkPhase(monster);
      return;
    }

    if (target === this.player) this.killPlayer();
    else if (this.monsters.includes(target as Monster)) this.killMonster(target as Monster);
    else this.killSummon(target as Summon);
  }

  private aggro(target: Unit, source: Unit): void {
    const monster = this.monsters.find((candidate) => candidate === target);
    if (!monster || monster.mode === 'return') return;
    monster.mode = 'chase';
    monster.target = source;
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
    monster.path = [];
    monster.respawnLeft = monster.def.respawnSeconds;
    monster.windupLeft = 0;
    monster.pending = null;
    monster.target = null;
    monster.effects = [];
    if (monster.def.boss) {
      this.bossReadyAt[monster.spawnKey] = this.time + monster.def.respawnSeconds;
      this.emit({ type: 'message', text: `${monster.name}已被击败` });
    }
    this.emit({ type: 'death', unit: monster });
    this.rollDrops(monster);
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

  private rollDrops(monster: Monster): void {
    for (const entry of this.config.drops[monster.def.dropTable] ?? []) {
      if (!this.rng.chance(entry.chance)) continue;
      const def = this.config.items[entry.item];
      const cell = this.grid.nearest(monster.cell, (c) => this.canDropAt(c));
      if (!def || !cell) continue;
      const equipment =
        def.kind === 'equip'
          ? rollEquipment(def, this.config.affixes, this.rng, this.nextId++)
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

  private learnSkills(): void {
    const player = this.player;
    const available = Object.values(this.config.skills)
      .filter((skill) => skill.classId === player.def.id && skill.level <= player.level)
      .filter((skill) => !player.skills.includes(skill.id))
      .sort((a, b) => a.level - b.level);
    for (const skill of available) {
      player.skills.push(skill.id);
      const slot = player.hotbar.indexOf(null);
      if (slot >= 0) player.hotbar[slot] = { kind: 'skill', id: skill.id };
      this.emit({ type: 'skillLearned', skill });
    }
  }

  /** 灵石和丹药材料不用走到格子上：出招时也生效，物品飞向角色。 */
  private attractItems(): void {
    const { player } = this;
    const { goldRadius, itemRadius } = this.config.game.pickup;
    for (const item of [...this.items]) {
      if (item.equipment) continue;
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
    for (const unit of [this.player, ...this.summons]) {
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
    let budget = unit.moveSpeed * dt;
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
    return { ...def, attackRange: 1, attackStat: 'attack' as const };
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
    };
  }

  private emit(event: GameEvent): void {
    this.events.push(event);
  }
}

function abilityArea(ability: AbilityDef, origin: Cell, target: Cell): Cell[] {
  const { shape, size } = ability;
  if (shape === 'line') {
    const dir = direction(origin, target);
    return Array.from({ length: size }, (_, i) => ({
      x: origin.x + dir.x * (i + 1),
      y: origin.y + dir.y * (i + 1),
    }));
  }
  const center = shape === 'around' ? origin : target;
  const cells: Cell[] = [];
  for (let y = center.y - size; y <= center.y + size; y++) {
    for (let x = center.x - size; x <= center.x + size; x++) cells.push({ x, y });
  }
  return cells;
}

function direction(from: Cell, to: Cell): Vec {
  return { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) };
}

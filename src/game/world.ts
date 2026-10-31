import { rollAttack, type AttackOptions } from './combat';
import type {
  Cell,
  ClassDef,
  CombatStats,
  DamageStat,
  GameConfig,
  ItemDef,
  MonsterDef,
  SkillDef,
} from './config';
import {
  applyBonus,
  equipmentBonuses,
  EQUIP_SLOTS,
  rollEquipment,
  slotsFor,
  type EquipSlot,
  type Equipment,
} from './equipment';
import { cellDistance, Grid, sameCell } from './grid';
import { findPath } from './pathfinding';
import { Rng } from './rng';
import { needsTarget, skillArea } from './skills';

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
const BAG_FULL_NOTICE_SECONDS = 3;

export interface Vec {
  x: number;
  y: number;
}

export interface StatusEffect {
  kind: 'dot' | 'shield' | 'defense';
  left: number;
  /** dot 为每跳伤害，shield 为减伤比例，defense 为增加的防御 */
  amount: number;
  interval: number;
  nextTick: number;
  source: Unit;
}

interface PendingAction {
  target: Unit | null;
  skill: SkillDef | null;
}

export interface Unit {
  id: number;
  name: string;
  /** 逻辑所在格，开始走一步时就占住目标格 */
  cell: Cell;
  /** 连续坐标，用于平滑显示 */
  pos: Vec;
  facing: Vec;
  hp: number;
  mp: number;
  stats: CombatStats;
  moveSpeed: number;
  attackInterval: number;
  attackWindup: number;
  attackRange: number;
  attackStat: DamageStat;
  path: Cell[];
  attackCooldown: number;
  windupLeft: number;
  pending: PendingAction | null;
  repathLeft: number;
  effects: StatusEffect[];
}

export interface Monster extends Unit {
  kind: 'monster';
  def: MonsterDef;
  home: Cell;
  mode: 'idle' | 'chase' | 'return';
  target: Unit | null;
  wanderLeft: number;
  respawnLeft: number;
}

export interface Summon extends Unit {
  kind: 'summon';
  def: MonsterDef;
  target: Monster | null;
  lifeLeft: number;
}

export type PlayerOrder =
  | { type: 'move'; cell: Cell }
  | { type: 'attack'; target: Monster }
  | { type: 'cast'; skill: SkillDef; target: Monster }
  | { type: 'pickup'; itemId: number };

export type HotbarEntry = { kind: 'skill'; id: string } | { kind: 'item'; id: string };

export interface Player extends Unit {
  kind: 'player';
  def: ClassDef;
  level: number;
  exp: number;
  gold: number;
  /** 可堆叠的丹药和材料 */
  bag: Record<string, number>;
  equipBag: Equipment[];
  equipment: Partial<Record<EquipSlot, Equipment>>;
  skills: string[];
  skillCooldowns: Record<string, number>;
  hotbar: (HotbarEntry | null)[];
  order: PlayerOrder | null;
  /** 出招途中按下的自身技能，出招结束后释放 */
  queuedSkill: SkillDef | null;
  respawnLeft: number;
  lastHurtAt: number;
}

export interface GroundItem {
  id: number;
  def: ItemDef;
  amount: number;
  equipment: Equipment | null;
  cell: Cell;
  expiresAt: number;
}

export type GameEvent =
  | { type: 'attackStart'; unit: Unit; target: Unit | null; color: string | null }
  | { type: 'skillCast'; unit: Unit; skill: SkillDef; cells: Cell[] }
  | { type: 'skillLearned'; skill: SkillDef }
  | { type: 'summoned'; unit: Summon }
  | { type: 'damage'; unit: Unit; amount: number; maxRoll: boolean; source: Unit }
  | { type: 'miss'; unit: Unit }
  | { type: 'death'; unit: Unit }
  | { type: 'respawn'; unit: Unit }
  | { type: 'itemDropped'; item: GroundItem }
  | { type: 'itemRemoved'; item: GroundItem }
  | { type: 'pickedUp'; item: GroundItem }
  | { type: 'equipped'; equipment: Equipment }
  | { type: 'refined'; equipment: Equipment; success: boolean }
  | { type: 'heal'; amount: number }
  | { type: 'mana'; amount: number }
  | { type: 'expGained'; amount: number }
  | { type: 'levelUp'; level: number }
  | { type: 'message'; text: string };

export class World {
  readonly grid: Grid;
  readonly player: Player;
  readonly monsters: Monster[] = [];
  readonly summons: Summon[] = [];
  readonly items: GroundItem[] = [];
  time = 0;

  private readonly rng: Rng;
  private readonly startCell: Cell;
  private nextId = 1;
  private bagFullNoticeAt = -Infinity;
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

    this.grid = new Grid(map);
    this.rng = new Rng(seed);
    this.startCell = map.playerStart;
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
      skills: [],
      skillCooldowns: {},
      hotbar,
      order: null,
      queuedSkill: null,
      respawnLeft: 0,
      lastHurtAt: -Infinity,
    };
    this.learnSkills();
    for (const spawn of map.spawns) {
      const def = config.monsters[spawn.monster];
      if (!def) throw new Error(`未知的怪物：${spawn.monster}`);
      this.monsters.push({
        ...this.createUnit(def.name, spawn, def.stats, this.monsterTiming(def)),
        kind: 'monster',
        def,
        home: { x: spawn.x, y: spawn.y },
        mode: 'idle',
        target: null,
        wanderLeft: this.rng.next() * WANDER_MAX_SECONDS,
        respawnLeft: 0,
      });
    }
    this.drainEvents();
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

  useHotbar(slot: number, target: Monster | null = null): void {
    const entry = this.player.hotbar[slot];
    if (entry?.kind === 'skill') this.castSkill(entry.id, target);
    else if (entry?.kind === 'item') this.useItem(entry.id);
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

  useItem(itemId: string): void {
    const player = this.player;
    const item = this.config.items[itemId];
    if (!player.hp || !item) return;
    if (!player.bag[itemId]) {
      this.emit({ type: 'message', text: `没有${item.name}了` });
      return;
    }
    const healed = Math.min(item.heal ?? 0, player.stats.maxHp - player.hp);
    const refilled = Math.min(item.mana ?? 0, player.stats.maxMp - player.mp);
    if (healed <= 0 && refilled <= 0) return;
    player.hp += healed;
    player.mp += refilled;
    this.removeFromBag(itemId);
    if (healed > 0) this.emit({ type: 'heal', amount: healed });
    if (refilled > 0) this.emit({ type: 'mana', amount: refilled });
  }

  /** 把背包里的法器穿上，同栏位优先用空位，否则替换第一个。 */
  equip(uid: number): void {
    const player = this.player;
    const equipment = player.equipBag.find((candidate) => candidate.uid === uid);
    const item = equipment && this.config.items[equipment.itemId];
    if (!player.hp || !equipment || !item) return;
    if ((item.level ?? 1) > player.level) {
      this.emit({ type: 'message', text: `需要等级 ${item.level}` });
      return;
    }
    const slots = slotsFor(item);
    const slot = slots.find((candidate) => !player.equipment[candidate]) ?? slots[0];
    if (!slot) return;

    player.equipBag.splice(player.equipBag.indexOf(equipment), 1);
    const replaced = player.equipment[slot];
    if (replaced) player.equipBag.push(replaced);
    player.equipment[slot] = equipment;
    this.applyStats();
    this.emit({ type: 'equipped', equipment });
  }

  unequip(slot: EquipSlot): void {
    const player = this.player;
    const equipment = player.equipment[slot];
    if (!player.hp || !equipment) return;
    if (this.bagIsFull()) {
      this.emit({ type: 'message', text: '背包已满' });
      return;
    }
    delete player.equipment[slot];
    player.equipBag.push(equipment);
    this.applyStats();
  }

  /** 把背包里的法器丢到脚边，丢弃后仍可捡回。 */
  discard(uid: number): void {
    const player = this.player;
    const equipment = player.equipBag.find((candidate) => candidate.uid === uid);
    const item = equipment && this.config.items[equipment.itemId];
    const cell = this.grid.nearest(player.cell, (c) => this.canDropAt(c) && !sameCell(c, player.cell));
    if (!player.hp || !equipment || !item || !cell) return;
    player.equipBag.splice(player.equipBag.indexOf(equipment), 1);
    this.spawnItem(item, 1, equipment, cell);
  }

  /** 祭炼武器：消耗祭炼石和灵石，成功加幸运，失败掉幸运。 */
  refine(uid: number): void {
    const player = this.player;
    const { refine } = this.config.affixes;
    const equipment = this.findEquipment(uid);
    if (!player.hp || !equipment) return;
    if (this.config.items[equipment.itemId]?.slot !== 'weapon') {
      this.emit({ type: 'message', text: '只有武器可以祭炼' });
      return;
    }
    if (equipment.luck >= refine.maxLuck) {
      this.emit({ type: 'message', text: '幸运已达上限' });
      return;
    }
    if (!player.bag[refine.material]) {
      this.emit({ type: 'message', text: `缺少${this.config.items[refine.material]?.name}` });
      return;
    }
    if (player.gold < refine.goldCost) {
      this.emit({ type: 'message', text: '灵石不足' });
      return;
    }

    player.gold -= refine.goldCost;
    this.removeFromBag(refine.material);
    const success = this.rng.chance(refine.chances[equipment.luck] ?? 0);
    equipment.luck = success
      ? equipment.luck + 1
      : Math.max(0, equipment.luck - refine.failLoss);
    this.applyStats();
    this.emit({ type: 'refined', equipment, success });
  }

  private findEquipment(uid: number): Equipment | null {
    const worn = Object.values(this.player.equipment);
    return [...worn, ...this.player.equipBag].find((item) => item.uid === uid) ?? null;
  }

  // ---- 主循环 ----

  tick(dt = TICK_SECONDS): void {
    this.time += dt;
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
    }

    this.advance(player, dt);
    if (!this.isStepping(player)) {
      this.collectItemsAt(player.cell);
      const current = player.order?.type;
      if ((current === 'move' || current === 'pickup') && player.path.length === 0) {
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
      this.pursueAndAttack(monster, monster.target, dt);
    } else if (monster.mode === 'return') {
      if (monster.path.length === 0 && !this.isStepping(monster)) {
        monster.mode = 'idle';
        monster.hp = monster.stats.maxHp;
        monster.effects = [];
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
    if (pending?.skill) this.applySkill(unit, pending.skill, pending.target);
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
    if (target.hp > 0) return;

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

  private killPlayer(): void {
    const player = this.player;
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
    const cell = this.grid.nearest(this.startCell, (c) => this.isFree(c, player)) ?? this.startCell;
    player.cell = { ...cell };
    player.pos = { ...cell };
    player.hp = player.stats.maxHp;
    player.mp = player.stats.maxMp;
    player.lastHurtAt = this.time;
    this.emit({ type: 'respawn', unit: player });
  }

  private killMonster(monster: Monster): void {
    monster.path = [];
    monster.respawnLeft = monster.def.respawnSeconds;
    monster.windupLeft = 0;
    monster.pending = null;
    monster.target = null;
    monster.effects = [];
    this.emit({ type: 'death', unit: monster });
    this.rollDrops(monster);
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
    monster.hp = monster.stats.maxHp;
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

  private spawnItem(def: ItemDef, amount: number, equipment: Equipment | null, cell: Cell): void {
    const item: GroundItem = {
      id: this.nextId++,
      def,
      amount,
      equipment,
      cell,
      expiresAt: this.time + GROUND_ITEM_SECONDS,
    };
    this.items.push(item);
    this.emit({ type: 'itemDropped', item });
  }

  private gainExp(amount: number): void {
    const player = this.player;
    player.exp += amount;
    this.emit({ type: 'expGained', amount });
    for (;;) {
      const needed = this.expToNext;
      if (needed === null || player.exp < needed) return;
      player.exp -= needed;
      player.level += 1;
      this.applyStats();
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

  private applyStats(): void {
    const { base, perLevel } = this.player.def;
    const gained = this.player.level - 1;
    const grow = (key: 'attack' | 'magic' | 'dao' | 'defense' | 'magicDefense') => ({
      min: Math.floor(base[key].min + perLevel[key] * gained * 0.5),
      max: Math.floor(base[key].max + perLevel[key] * gained),
    });
    const stats: CombatStats = {
      ...base,
      maxHp: base.maxHp + perLevel.maxHp * gained,
      maxMp: base.maxMp + perLevel.maxMp * gained,
      attack: grow('attack'),
      magic: grow('magic'),
      dao: grow('dao'),
      defense: grow('defense'),
      magicDefense: grow('magicDefense'),
    };
    for (const slot of EQUIP_SLOTS) {
      const equipment = this.player.equipment[slot];
      const item = equipment && this.config.items[equipment.itemId];
      if (!equipment || !item) continue;
      for (const bonus of equipmentBonuses(equipment, item)) {
        applyBonus(stats, this.player.def, bonus);
      }
    }
    this.player.stats = stats;
    this.player.hp = Math.min(this.player.hp, stats.maxHp);
    this.player.mp = Math.min(this.player.mp, stats.maxMp);
  }

  private collectItemsAt(cell: Cell): void {
    for (const item of this.items.filter((candidate) => sameCell(candidate.cell, cell))) {
      if (item.equipment && !this.takeEquipment(item.equipment)) continue;
      this.removeItem(item);
      this.emit({ type: 'pickedUp', item });
      if (item.def.kind === 'gold') this.player.gold += item.amount;
      else if (!item.equipment) this.addToBag(item.def.id, item.amount);
    }
  }

  /** 收下法器，有空栏位且等级够时直接穿上。背包满时返回 false。 */
  private takeEquipment(equipment: Equipment): boolean {
    const player = this.player;
    if (this.bagIsFull()) {
      if (this.time - this.bagFullNoticeAt >= BAG_FULL_NOTICE_SECONDS) {
        this.bagFullNoticeAt = this.time;
        this.emit({ type: 'message', text: '背包已满' });
      }
      return false;
    }
    const item = this.config.items[equipment.itemId];
    player.equipBag.push(equipment);
    if (item && (item.level ?? 1) <= player.level && slotsFor(item).some((s) => !player.equipment[s])) {
      this.equip(equipment.uid);
    }
    return true;
  }

  private bagIsFull(): boolean {
    return this.player.equipBag.length >= this.config.affixes.bagCapacity;
  }

  private addToBag(itemId: string, amount: number): void {
    this.player.bag[itemId] = (this.player.bag[itemId] ?? 0) + amount;
  }

  private removeFromBag(itemId: string): void {
    const remaining = (this.player.bag[itemId] ?? 0) - 1;
    if (remaining > 0) this.player.bag[itemId] = remaining;
    else delete this.player.bag[itemId];
  }

  private expireItems(): void {
    for (const item of this.items.filter((candidate) => candidate.expiresAt <= this.time)) {
      this.removeItem(item);
    }
  }

  private removeItem(item: GroundItem): void {
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

function direction(from: Cell, to: Cell): Vec {
  return { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) };
}

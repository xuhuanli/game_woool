export interface Cell {
  x: number;
  y: number;
}

export interface Range {
  min: number;
  max: number;
}

export type DamageStat = 'attack' | 'magic' | 'dao';

export interface CombatStats {
  maxHp: number;
  maxMp: number;
  attack: Range;
  magic: Range;
  dao: Range;
  defense: Range;
  magicDefense: Range;
  accuracy: number;
  evasion: number;
  luck: number;
}

export interface ClassDef {
  id: string;
  name: string;
  description: string;
  primaryStat: DamageStat;
  base: CombatStats;
  perLevel: {
    maxHp: number;
    maxMp: number;
    attack: number;
    magic: number;
    dao: number;
    defense: number;
    magicDefense: number;
  };
  moveSpeed: number;
  attackInterval: number;
  attackWindup: number;
  attackRange: number;
}

export type SkillEffect =
  | {
      type: 'damage';
      stat: DamageStat;
      multiplier: number;
      shape: 'single' | 'line' | 'around' | 'circle';
      size?: number;
      knockback?: number;
    }
  | { type: 'dot'; stat: DamageStat; multiplier: number; duration: number; interval: number }
  | { type: 'heal'; stat: DamageStat; multiplier: number; flat: number }
  | { type: 'shield'; reduction: number; duration: number }
  | { type: 'defense'; amount: number; duration: number }
  | { type: 'empower'; multiplier: number; duration: number }
  | { type: 'summon'; monster: string; hpPerLevel: number; duration: number };

export interface SkillDef {
  id: string;
  name: string;
  classId: string;
  level: number;
  mpCost: number;
  cooldown: number;
  windup: number;
  range: number;
  color: string;
  effect: SkillEffect;
}

export interface RealmDef {
  id: string;
  name: string;
  minLevel: number;
  maxLevel: number;
  stages: 'layers' | 'phases';
  /** 进入下一境界的条件，最高境界没有 */
  breakthrough?: {
    chance: number;
    /** 每次失败后累加的成功率 */
    failBonus: number;
    requires: { item: string; count: number }[];
  };
}

/** 怪物技能：前摇时地面预警，只命中还站在范围内的目标。 */
export interface AbilityDef {
  id: string;
  name: string;
  cooldown: number;
  windup: number;
  color: string;
  /** 目标进入这个距离才会释放 */
  range: number;
  shape: 'around' | 'target' | 'line';
  size: number;
  multiplier: number;
  /** 命中后中毒 */
  poison?: { damage: number; duration: number };
  /** 前摇结束时冲到目标身边 */
  charge?: boolean;
  /** 召唤小怪，不造成伤害 */
  summon?: { monster: string; count: number };
}

export interface PhaseDef {
  hpBelow: number;
  attackMultiplier: number;
  message: string;
}

export interface MonsterDef {
  id: string;
  name: string;
  stats: CombatStats;
  moveSpeed: number;
  attackInterval: number;
  attackWindup: number;
  aggroRange: number;
  leashRange: number;
  wanderRadius: number;
  exp: number;
  respawnSeconds: number;
  dropTable: string;
  /** 普攻距离，缺省为近战 */
  attackRange?: number;
  boss?: boolean;
  abilities?: AbilityDef[];
  phases?: PhaseDef[];
  look: { fur: string; head: string; scale: number };
}

export type BonusStat =
  | 'primary'
  | 'maxHp'
  | 'maxMp'
  | 'attack'
  | 'magic'
  | 'dao'
  | 'defense'
  | 'magicDefense'
  | 'accuracy'
  | 'evasion'
  | 'luck';

export type SpecialDef =
  | { kind: 'stun'; chance: number; seconds: number }
  | { kind: 'revive'; ratio: number; seconds: number }
  | { kind: 'manaShield'; ratio: number }
  | { kind: 'teleport'; seconds: number };

export interface ItemDef {
  id: string;
  name: string;
  kind: 'gold' | 'potion' | 'material' | 'equip' | 'scroll';
  scroll?: 'recall' | 'random';
  special?: SpecialDef;
  heal?: number;
  mana?: number;
  slot?: 'weapon' | 'armor' | 'helmet' | 'necklace' | 'bracelet' | 'ring';
  level?: number;
  bonus?: Partial<Record<BonusStat, number>>;
  price?: number;
}

export interface GradeDef {
  id: string;
  name: string;
  color: string;
  weight: number;
  affixes: number;
  sellMultiplier: number;
}

export interface AffixDef {
  stat: BonusStat;
  name: string;
  min: number;
  max: number;
}

export interface RefineConfig {
  material: string;
  goldCost: number;
  maxLuck: number;
  /** 按当前幸运查成功率 */
  chances: number[];
  failLoss: number;
}

export interface AffixConfig {
  grades: GradeDef[];
  pool: AffixDef[];
  refine: RefineConfig;
  bagCapacity: number;
  storageCapacity: number;
  sellRatio: number;
  death: {
    dropChance: number;
    /** 挂机时的掉装概率 */
    autoDropChance: number;
    pickupSeconds: number;
    /** 这个等级及以下不掉装 */
    safeLevel: number;
    /** 死亡后这段时间内再死不掉装 */
    graceSeconds: number;
  };
}

export interface SetDef {
  id: string;
  name: string;
  pieces: string[];
  bonuses: { count: number; bonus: Partial<Record<BonusStat, number>> }[];
}

export interface DropEntry {
  item: string;
  chance: number;
  min?: number;
  max?: number;
}

export interface PortalDef {
  x: number;
  y: number;
  name: string;
  toMap: string;
  toX: number;
  toY: number;
  /** 完成这个任务后才能通过 */
  requires?: string;
}

export interface DecorDef {
  prop: string;
  x: number;
  y: number;
  scale: number;
  flip: boolean;
  tint: number;
  /** 建筑占地，用来判断人在建筑前面还是后面 */
  foot?: { x0: number; y0: number; x1: number; y1: number };
}

export interface MapDef {
  id: string;
  name: string;
  safe?: boolean;
  /** Tiled 地图文件，尺寸、地形和物件都从文件读取 */
  tiled?: string;
  /** 地形编号，来自 Tiled 的 ground 图层 */
  ground?: number[];
  /** 树石等景观，有它时地面走预渲染 */
  decor?: DecorDef[];
  /** 画面色调和浓度 */
  tone?: { color: string; alpha: number };
  width: number;
  height: number;
  playerStart: Cell;
  /** 死亡后的复活点，缺省时在本图出生点 */
  respawn?: Cell & { map: string };
  obstacles: { x: number; y: number; w: number; h: number }[];
  portals?: PortalDef[];
  spawns: { monster: string; x: number; y: number }[];
}

export interface TravelOption {
  name: string;
  map: string;
  x: number;
  y: number;
  cost: number;
  level?: number;
  requires?: string;
}

export interface NpcDef {
  id: string;
  name: string;
  map: string;
  x: number;
  y: number;
  color: string;
  greeting: string;
  /** 完成这个任务后才出现 */
  requires?: string;
  /** 完成这个任务后消失 */
  hiddenAfter?: string;
  shop?: string[];
  storage?: boolean;
  travel?: TravelOption[];
}

export type ObjectiveType = 'kill' | 'talk' | 'reach' | 'collect';

export interface QuestObjective {
  type: ObjectiveType;
  target: string;
  count: number;
}

export interface QuestDef {
  id: string;
  name: string;
  giver: string;
  level: number;
  main?: boolean;
  prev?: string;
  summary: string;
  objectives: QuestObjective[];
  rewards: {
    exp: number;
    gold: number;
    items: { item: string; count: number }[];
    /** 章节结束时把玩家送到下一章 */
    teleport?: { map: string; x: number; y: number };
  };
  offer: string;
  finish: string;
}

export interface GameSettings {
  startMap: string;
  /** 跑步相对行走的速度倍数 */
  runMultiplier: number;
  /** 突破失败后属性降低的比例 */
  weakFactor: number;
  weakSeconds: number;
  skillUpgrade: { material: string; goldCost: number; maxLevel: number; powerPerLevel: number };
  pickup: { goldRadius: number; itemRadius: number; equipmentRadius: number };
}

export interface GameConfig {
  game: GameSettings;
  classes: Record<string, ClassDef>;
  levels: { expToNext: number[] };
  realms: RealmDef[];
  skills: Record<string, SkillDef>;
  monsters: Record<string, MonsterDef>;
  items: Record<string, ItemDef>;
  affixes: AffixConfig;
  sets: Record<string, SetDef>;
  drops: Record<string, DropEntry[]>;
  maps: Record<string, MapDef>;
  npcs: Record<string, NpcDef>;
  quests: Record<string, QuestDef>;
  dialogues: Record<string, string[]>;
}

/** 快捷栏 8 格，后两格固定放丹药 */
export const SKILL_SLOTS = 6;

export const CONFIG_FILES = [
  'game',
  'classes',
  'levels',
  'realms',
  'skills',
  'monsters',
  'items',
  'affixes',
  'sets',
  'drops',
  'maps',
  'npcs',
  'quests',
  'dialogues',
] as const;

/** 返回配置表中所有悬空引用，空数组表示配置有效。 */
export function validateConfig(config: GameConfig): string[] {
  const errors: string[] = [];
  for (const monster of Object.values(config.monsters)) {
    if (!config.drops[monster.dropTable]) {
      errors.push(`怪物 ${monster.id} 的掉落表 ${monster.dropTable} 不存在`);
    }
  }
  for (const [tableId, table] of Object.entries(config.drops)) {
    for (const entry of table) {
      if (!config.items[entry.item]) errors.push(`掉落表 ${tableId} 的物品 ${entry.item} 不存在`);
    }
  }
  for (const map of Object.values(config.maps)) {
    for (const spawn of map.spawns) {
      if (!config.monsters[spawn.monster]) {
        errors.push(`地图 ${map.id} 的怪物 ${spawn.monster} 不存在`);
      }
    }
  }
  for (const map of Object.values(config.maps)) {
    for (const portal of map.portals ?? []) {
      if (!config.maps[portal.toMap]) errors.push(`地图 ${map.id} 的传送点 ${portal.toMap} 不存在`);
    }
    if (map.respawn && !config.maps[map.respawn.map]) {
      errors.push(`地图 ${map.id} 的复活地图 ${map.respawn.map} 不存在`);
    }
  }
  for (const npc of Object.values(config.npcs)) {
    if (!config.maps[npc.map]) errors.push(`NPC ${npc.id} 的地图 ${npc.map} 不存在`);
    if (!config.dialogues[npc.greeting]) errors.push(`NPC ${npc.id} 的对话 ${npc.greeting} 不存在`);
    for (const item of npc.shop ?? []) {
      if (config.items[item]?.price === undefined) errors.push(`商品 ${item} 没有价格`);
    }
    for (const option of npc.travel ?? []) {
      if (!config.maps[option.map]) errors.push(`传送目的地 ${option.map} 不存在`);
    }
  }
  for (const quest of Object.values(config.quests)) {
    if (!config.npcs[quest.giver]) errors.push(`任务 ${quest.id} 的 NPC ${quest.giver} 不存在`);
    if (quest.prev && !config.quests[quest.prev]) errors.push(`任务 ${quest.id} 的前置不存在`);
    for (const id of [quest.offer, quest.finish]) {
      if (!config.dialogues[id]) errors.push(`任务 ${quest.id} 的对话 ${id} 不存在`);
    }
    for (const { item } of quest.rewards.items) {
      if (!config.items[item]) errors.push(`任务 ${quest.id} 的奖励 ${item} 不存在`);
    }
    for (const { type, target } of quest.objectives) {
      const table = { kill: config.monsters, talk: config.npcs, reach: config.maps, collect: config.items }[type];
      if (!table[target]) errors.push(`任务 ${quest.id} 的目标 ${target} 不存在`);
    }
  }
  for (const skill of Object.values(config.skills)) {
    if (!config.classes[skill.classId]) {
      errors.push(`技能 ${skill.id} 的职业 ${skill.classId} 不存在`);
    }
    if (skill.windup <= 0) errors.push(`技能 ${skill.id} 的前摇必须大于 0`);
    if (skill.effect.type === 'summon' && !config.monsters[skill.effect.monster]) {
      errors.push(`技能 ${skill.id} 的召唤物 ${skill.effect.monster} 不存在`);
    }
  }
  for (const item of Object.values(config.items)) {
    if (item.kind === 'equip' && !item.slot) errors.push(`法器 ${item.id} 缺少栏位`);
  }
  for (const classDef of Object.values(config.classes)) {
    const count = Object.values(config.skills).filter((skill) => skill.classId === classDef.id).length;
    if (count > SKILL_SLOTS) errors.push(`职业 ${classDef.id} 的技能超过快捷栏 ${SKILL_SLOTS} 格`);
  }
  for (const set of Object.values(config.sets)) {
    for (const piece of set.pieces) {
      if (!config.items[piece]) errors.push(`套装 ${set.id} 的 ${piece} 不存在`);
    }
  }
  for (const monster of Object.values(config.monsters)) {
    for (const ability of monster.abilities ?? []) {
      if (ability.summon && !config.monsters[ability.summon.monster]) {
        errors.push(`怪物 ${monster.id} 的召唤物 ${ability.summon.monster} 不存在`);
      }
    }
  }
  const { refine } = config.affixes;
  if (config.items[refine.material]?.kind !== 'material') {
    errors.push(`祭炼材料 ${refine.material} 不存在`);
  }
  if (refine.chances.length < refine.maxLuck) errors.push('祭炼成功率少于幸运上限');
  for (const realm of config.realms) {
    for (const { item } of realm.breakthrough?.requires ?? []) {
      if (!config.items[item]) errors.push(`境界 ${realm.id} 的突破材料 ${item} 不存在`);
    }
  }
  const maxLevel = config.levels.expToNext.length + 1;
  for (let level = 1; level <= maxLevel; level++) {
    if (!config.realms.some((realm) => level >= realm.minLevel && level <= realm.maxLevel)) {
      errors.push(`等级 ${level} 没有对应的境界`);
    }
  }
  return errors;
}

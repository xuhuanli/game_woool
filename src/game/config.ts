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
  | { type: 'summon'; monster: string; hpPerLevel: number; duration: number }
  /** 冲到射程内的目标身前打一击，并把它定身 stun 秒 */
  | { type: 'charge'; stat: DamageStat; multiplier: number; stun: number }
  /** 在目标处留下一片地面，持续时间内每隔 interval 秒伤害范围内的怪 */
  | { type: 'field'; stat: DamageStat; multiplier: number; size: number; duration: number; interval: number };

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
  /** 进阶功法：学会后替换掉这门旧功法，占同一格 */
  replaces?: string;
}

export interface RealmDef {
  id: string;
  name: string;
  minLevel: number;
  maxLevel: number;
  stages: 'layers' | 'phases';
  /** 每个小境界的起始等级，按原著进度对齐；不填就把境界平均分成初、中、后期 */
  phaseStarts?: number[];
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
  /** 共用掉落表之外，只有这种怪才掉的东西 */
  extraDrops?: DropEntry[];
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
  kind: 'gold' | 'potion' | 'material' | 'equip' | 'scroll' | 'book';
  /** 功法书学会的功法 */
  skill?: string;
  scroll?: 'recall' | 'random';
  special?: SpecialDef;
  /** Boss 专属法器，填掉落它的 Boss */
  boss?: string;
  /** 种子种出的灵药 */
  seed?: string;
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
  /** 首次击杀必掉 */
  firstKill?: boolean;
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
  /** 背景音乐，缺省时主城用 town */
  music?: string;
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

export type AchievementCondition =
  | { type: 'kills' | 'bossTypes' | 'level' | 'codexItems' | 'refine' | 'set' | 'sideQuests' | 'gold'; count: number }
  | { type: 'killMonster'; target: string }
  /** 收集到至少这个品阶的法器 */
  | { type: 'grade'; target: string };

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  condition: AchievementCondition;
  reward: { gold: number; items: { item: string; count: number }[] };
}

export interface GardenHerbDef {
  /** 收获的灵药 */
  item: string;
  seed: string;
  growSeconds: number;
  /** 每株收几个 */
  yield: number;
  level: number;
}

export interface GardenConfig {
  /** 完成这个任务后开启掌天瓶 */
  unlockQuest: string;
  /** 按境界取值：凝一滴绿液的秒数、绿液上限；灵药长到 minGrowth 以后才能催熟 */
  dew: { perSeconds: number[]; max: number[]; minGrowth: number };
  plots: { initial: number; expansions: { level: number; gold: number }[] };
  herbs: GardenHerbDef[];
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
  achievements: Record<string, AchievementDef>;
  garden: GardenConfig;
  dialogues: Record<string, string[]>;
}

/** 快捷栏 9 格，后两格固定放丹药 */
export const SKILL_SLOTS = 7;

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
  'achievements',
  'garden',
] as const;

/** 一种怪的全部掉落：共用掉落表加上它自己的专属掉落。 */
export function monsterDrops(config: GameConfig, monster: MonsterDef): DropEntry[] {
  return [...(config.drops[monster.dropTable] ?? []), ...(monster.extraDrops ?? [])];
}

/** 返回配置表中所有悬空引用，空数组表示配置有效。 */
export function validateConfig(config: GameConfig): string[] {
  const errors: string[] = [];
  for (const monster of Object.values(config.monsters)) {
    if (!config.drops[monster.dropTable]) {
      errors.push(`怪物 ${monster.id} 的掉落表 ${monster.dropTable} 不存在`);
    }
    for (const entry of monster.extraDrops ?? []) {
      if (!config.items[entry.item]) errors.push(`怪物 ${monster.id} 的专属掉落 ${entry.item} 不存在`);
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
    if (item.kind === 'book' && !config.skills[item.skill ?? '']) errors.push(`功法书 ${item.id} 的功法不存在`);
    if (item.boss) {
      const boss = config.monsters[item.boss];
      const table = boss ? config.drops[boss.dropTable] : undefined;
      if (!table?.some((entry) => entry.item === item.id && entry.firstKill)) {
        errors.push(`专属法器 ${item.id} 不在 ${item.boss} 的首杀掉落里`);
      }
    }
  }
  for (const skill of Object.values(config.skills)) {
    const hasBook = Object.values(config.items).some((item) => item.kind === 'book' && item.skill === skill.id);
    if (skill.level > 1 && !hasBook) errors.push(`功法 ${skill.id} 没有功法书`);
  }
  for (const skill of Object.values(config.skills)) {
    if (!skill.replaces) continue;
    const old = config.skills[skill.replaces];
    if (!old || old.classId !== skill.classId || old.level >= skill.level) {
      errors.push(`进阶功法 ${skill.id} 替换的 ${skill.replaces} 不存在、不是同职业或等级不低于它`);
    }
  }
  const replaced = new Set(Object.values(config.skills).map((skill) => skill.replaces).filter(Boolean));
  for (const classDef of Object.values(config.classes)) {
    // 被进阶替换掉的旧功法不再占格
    const count = Object.values(config.skills).filter(
      (skill) => skill.classId === classDef.id && !replaced.has(skill.id),
    ).length;
    if (count > SKILL_SLOTS) errors.push(`职业 ${classDef.id} 的技能超过快捷栏 ${SKILL_SLOTS} 格`);
  }
  for (const achievement of Object.values(config.achievements)) {
    const { condition, reward } = achievement;
    if (condition.type === 'killMonster' && !config.monsters[condition.target]) {
      errors.push(`成就 ${achievement.id} 的怪物 ${condition.target} 不存在`);
    }
    if (condition.type === 'grade' && !config.affixes.grades.some((grade) => grade.id === condition.target)) {
      errors.push(`成就 ${achievement.id} 的品阶 ${condition.target} 不存在`);
    }
    for (const { item } of reward.items) {
      if (!config.items[item]) errors.push(`成就 ${achievement.id} 的奖励 ${item} 不存在`);
    }
  }
  const { garden } = config;
  if (!config.quests[garden.unlockQuest]) errors.push(`药园的开启任务 ${garden.unlockQuest} 不存在`);
  for (const herb of garden.herbs) {
    const seed = config.items[herb.seed];
    if (!config.items[herb.item]) errors.push(`灵药 ${herb.item} 不存在`);
    if (seed?.seed !== herb.item) errors.push(`灵药 ${herb.item} 的种子 ${herb.seed} 不存在或种不出它`);
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

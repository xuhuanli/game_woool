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

export interface ItemDef {
  id: string;
  name: string;
  kind: 'gold' | 'potion' | 'material' | 'equip';
  heal?: number;
  mana?: number;
  slot?: 'weapon' | 'armor' | 'helmet' | 'necklace' | 'bracelet' | 'ring';
  level?: number;
  bonus?: Partial<Record<BonusStat, number>>;
}

export interface GradeDef {
  id: string;
  name: string;
  color: string;
  weight: number;
  affixes: number;
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
}

export interface DropEntry {
  item: string;
  chance: number;
  min?: number;
  max?: number;
}

export interface MapDef {
  id: string;
  name: string;
  width: number;
  height: number;
  playerStart: Cell;
  obstacles: { x: number; y: number; w: number; h: number }[];
  spawns: { monster: string; x: number; y: number }[];
}

export interface GameConfig {
  classes: Record<string, ClassDef>;
  levels: { expToNext: number[] };
  realms: RealmDef[];
  skills: Record<string, SkillDef>;
  monsters: Record<string, MonsterDef>;
  items: Record<string, ItemDef>;
  affixes: AffixConfig;
  drops: Record<string, DropEntry[]>;
  maps: Record<string, MapDef>;
}

export const CONFIG_FILES = [
  'classes',
  'levels',
  'realms',
  'skills',
  'monsters',
  'items',
  'affixes',
  'drops',
  'maps',
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
  const { refine } = config.affixes;
  if (config.items[refine.material]?.kind !== 'material') {
    errors.push(`祭炼材料 ${refine.material} 不存在`);
  }
  if (refine.chances.length < refine.maxLuck) errors.push('祭炼成功率少于幸运上限');
  const maxLevel = config.levels.expToNext.length + 1;
  for (let level = 1; level <= maxLevel; level++) {
    if (!config.realms.some((realm) => level >= realm.minLevel && level <= realm.maxLevel)) {
      errors.push(`等级 ${level} 没有对应的境界`);
    }
  }
  return errors;
}

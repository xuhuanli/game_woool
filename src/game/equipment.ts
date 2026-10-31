import type {
  AffixConfig,
  BonusStat,
  ClassDef,
  CombatStats,
  GameConfig,
  GradeDef,
  ItemDef,
} from './config';
import type { Rng } from './rng';

export const EQUIP_SLOTS = [
  'weapon',
  'armor',
  'helmet',
  'necklace',
  'braceletLeft',
  'braceletRight',
  'ringLeft',
  'ringRight',
] as const;

export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export const SLOT_NAMES: Record<EquipSlot, string> = {
  weapon: '武器',
  armor: '衣服',
  helmet: '头盔',
  necklace: '项链',
  braceletLeft: '左手镯',
  braceletRight: '右手镯',
  ringLeft: '左戒指',
  ringRight: '右戒指',
};

export interface Affix {
  stat: BonusStat;
  value: number;
}

/** 掉落时生成的法器实例，同名法器的品阶和附加属性各不相同。 */
export interface Equipment {
  uid: number;
  itemId: string;
  grade: string;
  affixes: Affix[];
  /** 祭炼获得的幸运，只有武器才有 */
  luck: number;
}

export function rollEquipment(
  item: ItemDef,
  affixes: AffixConfig,
  rng: Rng,
  uid: number,
): Equipment {
  const grade = rollGrade(affixes.grades, rng);
  const pool = [...affixes.pool];
  const rolled: Affix[] = [];
  for (let i = 0; i < grade.affixes && pool.length > 0; i++) {
    const [entry] = pool.splice(rng.int(0, pool.length - 1), 1);
    if (entry) rolled.push({ stat: entry.stat, value: rng.int(entry.min, entry.max) });
  }
  return { uid, itemId: item.id, grade: grade.id, affixes: rolled, luck: 0 };
}

function rollGrade(grades: GradeDef[], rng: Rng): GradeDef {
  const total = grades.reduce((sum, grade) => sum + grade.weight, 0);
  let roll = rng.next() * total;
  for (const grade of grades) {
    roll -= grade.weight;
    if (roll < 0) return grade;
  }
  return grades.at(-1)!;
}

/** 这件法器可以穿在哪些栏位。 */
export function slotsFor(item: ItemDef): EquipSlot[] {
  switch (item.slot) {
    case 'bracelet':
      return ['braceletLeft', 'braceletRight'];
    case 'ring':
      return ['ringLeft', 'ringRight'];
    case undefined:
      return [];
    default:
      return [item.slot];
  }
}

export function equipmentName(equipment: Equipment, config: GameConfig): string {
  const grade = config.affixes.grades.find((candidate) => candidate.id === equipment.grade);
  const name = config.items[equipment.itemId]?.name ?? equipment.itemId;
  const luck = equipment.luck > 0 ? ` +${equipment.luck}` : '';
  return `${grade?.name ?? ''}·${name}${luck}`;
}

export function equipmentColor(equipment: Equipment, config: GameConfig): string {
  return (
    config.affixes.grades.find((candidate) => candidate.id === equipment.grade)?.color ?? '#efe6d0'
  );
}

/** 列出法器提供的全部属性，基础属性在前，附加属性在后。 */
export function equipmentBonuses(equipment: Equipment, item: ItemDef): Affix[] {
  const base = Object.entries(item.bonus ?? {}).map(([stat, value]) => ({
    stat: stat as BonusStat,
    value,
  }));
  const luck: Affix[] = equipment.luck > 0 ? [{ stat: 'luck', value: equipment.luck }] : [];
  return [...base, ...equipment.affixes, ...luck];
}

export function applyBonus(stats: CombatStats, classDef: ClassDef, bonus: Affix): void {
  const stat = bonus.stat === 'primary' ? classDef.primaryStat : bonus.stat;
  switch (stat) {
    case 'attack':
    case 'magic':
    case 'dao':
    case 'defense':
    case 'magicDefense':
      stats[stat].max += bonus.value;
      break;
    default:
      stats[stat] += bonus.value;
  }
}

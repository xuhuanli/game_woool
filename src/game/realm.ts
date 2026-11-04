import type { RealmDef } from './config';

const LAYERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三'];
const PHASES = ['初期', '中期', '后期'];

/** 按等级显示境界，比如 练气三层、筑基中期。 */
export function realmName(realms: RealmDef[], level: number): string {
  const realm = realms.find((candidate) => level >= candidate.minLevel && level <= candidate.maxLevel);
  if (!realm) return '';
  const step = level - realm.minLevel;
  if (realm.stages === 'layers') return `${realm.name}${LAYERS.at(step) ?? ''}层`;
  if (realm.phaseStarts) {
    const phase = realm.phaseStarts.filter((start) => level >= start).length - 1;
    return `${realm.name}${PHASES.at(Math.max(0, phase))}`;
  }
  const span = realm.maxLevel - realm.minLevel + 1;
  return `${realm.name}${PHASES.at(Math.floor((step * PHASES.length) / span))}`;
}

/** 突破成功率：每次失败累加，最高 100%。 */
export function breakthroughChance(realm: RealmDef, fails: number): number {
  const { chance, failBonus } = realm.breakthrough ?? { chance: 0, failBonus: 0 };
  return Math.min(1, chance + failBonus * fails);
}

/** 当前等级已到境界上限且尚未突破时，返回这个境界。 */
export function pendingBreakthrough(
  realms: RealmDef[],
  level: number,
  passed: string[],
): RealmDef | null {
  const realm = realms.find((candidate) => candidate.maxLevel === level);
  return realm?.breakthrough && !passed.includes(realm.id) ? realm : null;
}

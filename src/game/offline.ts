import { hitChance } from './combat';
import type { CombatStats, GameConfig, MapDef } from './config';

export const OFFLINE_MAX_SECONDS = 8 * 3600;
export const OFFLINE_EFFICIENCY = 0.5;
export const OFFLINE_MIN_SECONDS = 60;
/** 每杀一只怪在路上和拾取花的时间 */
const TRAVEL_SECONDS = 5;

export interface IncomeRates {
  expPerSecond: number;
  goldPerSecond: number;
}

function average(range: { min: number; max: number }): number {
  return (range.min + range.max) / 2;
}

/** 按普攻估算在这张地图挂机的每秒收益，不算 Boss 和技能。 */
export function estimateIncome(
  config: GameConfig,
  map: MapDef,
  stats: CombatStats,
  primary: 'attack' | 'magic' | 'dao',
  attackInterval: number,
): IncomeRates {
  let seconds = 0;
  let exp = 0;
  let gold = 0;
  let kills = 0;
  for (const spawn of map.spawns) {
    const monster = config.monsters[spawn.monster];
    if (!monster || monster.boss) continue;
    const defense = primary === 'attack' ? monster.stats.defense : monster.stats.magicDefense;
    const perHit = Math.max(1, average(stats[primary]) - average(defense));
    const perSecond = (perHit * hitChance(stats, monster.stats)) / attackInterval;
    seconds += monster.stats.maxHp / perSecond + TRAVEL_SECONDS;
    exp += monster.exp;
    kills += 1;
    for (const entry of config.drops[monster.dropTable] ?? []) {
      if (entry.item !== 'gold') continue;
      gold += entry.chance * average({ min: entry.min ?? 1, max: entry.max ?? 1 });
    }
  }
  if (kills === 0) return { expPerSecond: 0, goldPerSecond: 0 };
  return { expPerSecond: exp / seconds, goldPerSecond: gold / seconds };
}

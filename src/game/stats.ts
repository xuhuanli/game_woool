import type { CombatStats, GameConfig } from './config';
import { applyBonus, equipmentBonuses, EQUIP_SLOTS } from './equipment';
import type { Player } from './types';

function weaken(stats: CombatStats, scale: number): void {
  stats.maxHp = Math.floor(stats.maxHp * scale);
  stats.maxMp = Math.floor(stats.maxMp * scale);
  for (const key of ['attack', 'magic', 'dao', 'defense', 'magicDefense'] as const) {
    stats[key] = { min: Math.floor(stats[key].min * scale), max: Math.floor(stats[key].max * scale) };
  }
}

/** 按等级和穿戴的法器重新计算属性，生命和灵力不超过新上限。 */
export function refreshStats(player: Player, config: GameConfig, now: number): void {
  const { base, perLevel } = player.def;
  const gained = player.level - 1;
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
    const equipment = player.equipment[slot];
    const item = equipment && config.items[equipment.itemId];
    if (!equipment || !item) continue;
    for (const bonus of equipmentBonuses(equipment, item)) applyBonus(stats, player.def, bonus);
  }
  if (player.weakUntil > now) weaken(stats, 1 - config.game.weakFactor);
  player.stats = stats;
  player.hp = Math.min(player.hp, stats.maxHp);
  player.mp = Math.min(player.mp, stats.maxMp);
}

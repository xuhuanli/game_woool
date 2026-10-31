import type { CombatStats, GameConfig } from './config';
import { applyBonus, equipmentBonuses, EQUIP_SLOTS } from './equipment';
import type { Player } from './types';

/** 按等级和穿戴的法器重新计算属性，生命和灵力不超过新上限。 */
export function refreshStats(player: Player, config: GameConfig): void {
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
  player.stats = stats;
  player.hp = Math.min(player.hp, stats.maxHp);
  player.mp = Math.min(player.mp, stats.maxMp);
}

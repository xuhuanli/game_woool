import type { AchievementDef, GameConfig } from './config';
import { EQUIP_SLOTS } from './equipment';
import type { Player } from './types';

/** 成就当前进度和目标。 */
export function achievementProgress(
  def: AchievementDef,
  player: Player,
  config: GameConfig,
): { value: number; goal: number } {
  const { condition } = def;
  const owned = [...Object.values(player.equipment), ...player.equipBag, ...player.storage];
  switch (condition.type) {
    case 'kills':
      return { value: Object.values(player.kills).reduce((sum, count) => sum + count, 0), goal: condition.count };
    case 'killMonster':
      return { value: Math.min(1, player.kills[condition.target] ?? 0), goal: 1 };
    case 'bossTypes': {
      const bosses = Object.keys(player.kills).filter((id) => config.monsters[id]?.boss);
      return { value: bosses.length, goal: condition.count };
    }
    case 'level':
      return { value: player.level, goal: condition.count };
    case 'codexItems':
      return { value: Object.keys(player.codexItems).length, goal: condition.count };
    case 'grade': {
      const goal = config.affixes.grades.findIndex((grade) => grade.id === condition.target);
      const best = Math.max(-1, ...Object.values(player.codexItems));
      return { value: best >= goal ? 1 : 0, goal: 1 };
    }
    case 'refine':
      return { value: Math.max(0, ...owned.map((equipment) => equipment.luck)), goal: condition.count };
    case 'set': {
      const worn = EQUIP_SLOTS.map((slot) => player.equipment[slot]?.itemId);
      const pieces = Object.values(config.sets).map(
        (set) => set.pieces.filter((piece) => worn.includes(piece)).length,
      );
      return { value: Math.max(0, ...pieces), goal: condition.count };
    }
    case 'sideQuests': {
      const done = player.quests.completed.filter((id) => config.quests[id] && !config.quests[id].main);
      return { value: done.length, goal: condition.count };
    }
    case 'gold':
      return { value: player.gold, goal: condition.count };
  }
}

/** 把身上、背包和仓库里的法器记进图鉴，保留见过的最高品阶。 */
export function recordCodexItems(player: Player, config: GameConfig): void {
  const { grades } = config.affixes;
  for (const equipment of [...Object.values(player.equipment), ...player.equipBag, ...player.storage]) {
    const grade = grades.findIndex((candidate) => candidate.id === equipment.grade);
    if (grade > (player.codexItems[equipment.itemId] ?? -1)) player.codexItems[equipment.itemId] = grade;
  }
}

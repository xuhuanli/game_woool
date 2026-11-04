import { monsterDrops, type GameConfig, type MapDef, type MonsterDef } from './config';
import type { Player } from './types';

/** 同一种怪打满这么多只，才显示掉率 */
export const RATE_REVEAL_KILLS = 50;
/** 来源太多时只列前几条 */
const MAX_SOURCES = 6;

function spawnMaps(config: GameConfig, monster: MonsterDef): MapDef[] {
  return Object.values(config.maps).filter((map) => map.spawns.some((spawn) => spawn.monster === monster.id));
}

function percent(chance: number): string {
  return chance < 0.01 ? '不到 1%' : `${Math.round(chance * 100)}%`;
}

/**
 * 物品的获取途径。商店、任务、成就和 Boss 专属一直公开；
 * 怪物掉落要先击败过这种怪才写出名字，没打过的只给地图，打满 50 只再显示掉率。
 */
export function itemSources(config: GameConfig, player: Player, itemId: string): string[] {
  const item = config.items[itemId];
  if (!item) return [];
  const fixed: string[] = [];

  const boss = item.boss ? config.monsters[item.boss] : undefined;
  if (boss) {
    const where = spawnMaps(config, boss).map((map) => map.name).join('、');
    const chance = monsterDrops(config, boss).find((entry) => entry.item === itemId)?.chance ?? 0;
    fixed.push(`${boss.name}（${where}）首杀必掉，之后 ${percent(chance)}`);
  }
  for (const npc of Object.values(config.npcs)) {
    if (npc.shop?.includes(itemId)) fixed.push(`${npc.name}（${config.maps[npc.map]?.name ?? npc.map}）有售`);
  }
  for (const quest of Object.values(config.quests)) {
    if (quest.rewards.items.some((reward) => reward.item === itemId)) fixed.push(`任务「${quest.name}」奖励`);
  }
  for (const achievement of Object.values(config.achievements)) {
    if (achievement.reward.items.some((reward) => reward.item === itemId)) fixed.push(`成就「${achievement.name}」奖励`);
  }

  const known: { text: string; chance: number }[] = [];
  const hidden = new Set<string>();
  for (const monster of Object.values(config.monsters)) {
    if (monster.id === item.boss) continue;
    const entry = monsterDrops(config, monster).find((candidate) => candidate.item === itemId);
    const maps = spawnMaps(config, monster);
    if (!entry || maps.length === 0) continue;
    const kills = player.kills[monster.id] ?? 0;
    const where = maps.map((map) => map.name).join('、');
    if (!kills) {
      for (const map of maps) hidden.add(map.name);
      continue;
    }
    const rate = kills >= RATE_REVEAL_KILLS ? ` ${entry.chance < 0.01 ? '' : '约 '}${percent(entry.chance)}` : '';
    known.push({ text: `${monster.name}（${where}）${rate}`, chance: entry.chance });
  }
  known.sort((a, b) => b.chance - a.chance);
  const drops = [...known.map((source) => source.text), ...[...hidden].map((map) => `？？？（${map}）`)];

  const all = [...fixed, ...drops];
  if (all.length <= MAX_SOURCES) return all;
  return [...all.slice(0, MAX_SOURCES), `等 ${all.length - MAX_SOURCES} 处`];
}

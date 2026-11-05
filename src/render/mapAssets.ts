import type { GameConfig } from '../game/config';

/** 进一张地图要用到的精灵表和景观物件，切图时只加载这些，其余的释放掉。 */
export interface MapAssets {
  sprites: Set<string>;
  props: Set<string>;
}

export function mapAssets(config: GameConfig, mapId: string, classId: string): MapAssets {
  const sprites = new Set<string>([classId]);
  const addMonster = (monsterId: string) => {
    if (sprites.has(monsterId)) return;
    sprites.add(monsterId);
    // Boss 召唤的小怪也要提前备好
    for (const ability of config.monsters[monsterId]?.abilities ?? []) {
      if (ability.summon) addMonster(ability.summon.monster);
    }
  };
  for (const skill of Object.values(config.skills)) {
    if (skill.classId === classId && skill.effect.type === 'summon') addMonster(skill.effect.monster);
  }
  const map = config.maps[mapId];
  for (const spawn of map?.spawns ?? []) addMonster(spawn.monster);
  for (const npc of Object.values(config.npcs)) {
    if (npc.map === mapId) sprites.add(`npc-${npc.id}`);
  }
  const props = new Set((map?.decor ?? []).map((item) => item.prop));
  return { sprites, props };
}

import { monsterDrops, type PortalDef, type QuestDef } from './config';
import { questStatus } from './quests';
import type { Player, RouteTarget } from './types';
import type { World } from './world';

/** 用广度优先搜索找到去目标地图要走的第一个传送点，跳过未解锁的传送点。 */
export function nextPortal(world: World, targetMap: string): PortalDef | null {
  const { maps } = world.config;
  const visited = new Set([world.mapId]);
  let frontier: { mapId: string; first: PortalDef | null }[] = [{ mapId: world.mapId, first: null }];
  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const { mapId, first } of frontier) {
      for (const portal of maps[mapId]?.portals ?? []) {
        if (portal.requires && !world.questDone(portal.requires)) continue;
        if (visited.has(portal.toMap)) continue;
        const route = first ?? portal;
        if (portal.toMap === targetMap) return route;
        visited.add(portal.toMap);
        next.push({ mapId: portal.toMap, first: route });
      }
    }
    frontier = next;
  }
  return null;
}

function mapWithMonster(world: World, monsterId: string): RouteTarget | null {
  for (const map of Object.values(world.config.maps)) {
    const spawn = map.spawns.find((candidate) => candidate.monster === monsterId);
    if (spawn) return { mapId: map.id, cell: { x: spawn.x, y: spawn.y } };
  }
  return null;
}

function mapDropping(world: World, itemId: string): RouteTarget | null {
  const { config } = world;
  const source = Object.values(config.monsters).find((monster) =>
    monsterDrops(config, monster).some((entry) => entry.item === itemId),
  );
  return source ? mapWithMonster(world, source.id) : null;
}

function npcTarget(world: World, npcId: string): RouteTarget | null {
  const npc = world.config.npcs[npcId];
  return npc ? { mapId: npc.map, cell: { x: npc.x, y: npc.y }, npc } : null;
}

/** 找到任务下一步要去的地方：完成了就回交任务的 NPC，否则去第一个未完成的目标。 */
export function questDestination(world: World, quest: QuestDef, player: Player): RouteTarget | null {
  if (questStatus(quest, player.quests, player.level, player.bag) === 'ready') {
    return npcTarget(world, quest.giver);
  }
  const progress = player.quests.active.find((candidate) => candidate.id === quest.id);
  const index = quest.objectives.findIndex((objective, i) => {
    const count =
      objective.type === 'collect' ? (player.bag[objective.target] ?? 0) : (progress?.counts[i] ?? 0);
    return count < objective.count;
  });
  const objective = quest.objectives[index];
  if (!objective) return null;
  switch (objective.type) {
    case 'kill':
      return mapWithMonster(world, objective.target);
    case 'talk':
      return npcTarget(world, objective.target);
    case 'collect':
      return mapDropping(world, objective.target);
    case 'reach': {
      const map = world.config.maps[objective.target];
      return map ? { mapId: map.id, cell: map.playerStart } : null;
    }
  }
}

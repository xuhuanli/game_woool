import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG_FILES, validateConfig, type GameConfig } from './config';
import { Grid } from './grid';
import { findPath } from './pathfinding';
import { questStatus } from './quests';
import { TICK_SECONDS, World, type GameEvent } from './world';

const config = Object.fromEntries(
  CONFIG_FILES.map((name) => [
    name,
    JSON.parse(readFileSync(`public/data/${name}.json`, 'utf8')) as unknown,
  ]),
) as unknown as GameConfig;

const npc = (id: string) => config.npcs[id]!;
const town = () => new World(config, 'huangfeng-valley', 'body', 1);

function run(world: World, seconds: number, until?: () => boolean): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += TICK_SECONDS) {
    world.tick();
    if (until?.()) return;
  }
}

function standBy(world: World, id: string): void {
  world.talkTo(npc(id));
  run(world, 15, () => world.player.order === null);
}

const status = (world: World, id: string) =>
  questStatus(config.quests[id]!, world.player.quests, world.player.level, world.player.bag);

describe('内容配置', () => {
  it('没有悬空引用', () => {
    expect(validateConfig(config)).toEqual([]);
  });

  it('每张图的出生点、传送点、刷怪点和 NPC 都连通', () => {
    for (const map of Object.values(config.maps)) {
      const npcs = Object.values(config.npcs).filter((candidate) => candidate.map === map.id);
      const grid = new Grid(map, npcs);
      const reachable = (cell: { x: number; y: number }) =>
        findPath(grid, map.playerStart, cell, () => true) !== null;
      for (const portal of map.portals ?? []) expect(reachable(portal), portal.name).toBe(true);
      for (const spawn of map.spawns) expect(reachable(spawn), spawn.monster).toBe(true);
      for (const candidate of npcs) {
        const beside = grid.nearest(candidate, (c) => grid.isWalkable(c))!;
        expect(reachable(beside), candidate.id).toBe(true);
      }
    }
  });

  it('传送点到达的位置可行走', () => {
    for (const map of Object.values(config.maps)) {
      for (const portal of map.portals ?? []) {
        const target = config.maps[portal.toMap]!;
        expect(new Grid(target).isWalkable({ x: portal.toX, y: portal.toY }), portal.name).toBe(true);
      }
    }
  });
});

describe('切图', () => {
  it('踩上传送点进入新地图并重新生成怪物', () => {
    const world = town();
    expect(world.monsters).toHaveLength(0);
    const portal = world.portals[0]!;
    world.moveTo(portal);
    run(world, 20, () => world.mapId !== 'huangfeng-valley');
    expect(world.mapId).toBe('starter-field');
    expect(world.player.cell).toEqual({ x: portal.toX, y: portal.toY });
    expect(world.monsters.length).toBeGreaterThan(0);
  });

  it('到达后不会被传送点弹回去', () => {
    const world = town();
    world.moveTo(world.portals[0]!);
    run(world, 20, () => world.mapId !== 'huangfeng-valley');
    run(world, 3);
    expect(world.mapId).toBe('starter-field');
  });

  it('野外死亡后回到主城', () => {
    const world = new World(config, 'starter-field', 'body', 1);
    world.player.hp = 1;
    const monster = world.monsters[0]!;
    monster.cell = { x: world.player.cell.x + 1, y: world.player.cell.y };
    monster.pos = { ...monster.cell };
    monster.home = { ...monster.cell };
    run(world, 30, () => world.player.hp === 0);
    run(world, 4, () => world.player.hp > 0);
    expect(world.mapId).toBe('huangfeng-valley');
    expect(world.player.cell).toEqual({ x: 12, y: 14 });
  });

  it('传送阵扣灵石并到达目的地，等级和灵石不够时拒绝', () => {
    const world = town();
    standBy(world, 'gate-steward');
    world.player.gold = 5;
    world.travel(npc('gate-steward'), 0);
    expect(world.mapId).toBe('huangfeng-valley');
    world.player.gold = 100;
    world.travel(npc('gate-steward'), 1);
    expect(world.mapId).toBe('huangfeng-valley');
    world.travel(npc('gate-steward'), 0);
    expect(world.mapId).toBe('starter-field');
    expect(world.player.gold).toBe(90);
  });
});

describe('Boss', () => {
  const lair = () => {
    const world = new World(config, 'taina-mountain', 'body', 1);
    return { world, boss: world.monsters.find((monster) => monster.def.boss)! };
  };
  const kill = (world: World, boss: World['monsters'][number]) => {
    boss.hp = 1;
    boss.stats = { ...boss.stats, evasion: 0, defense: { min: 0, max: 0 } };
    const c = { x: boss.cell.x - 1, y: boss.cell.y };
    world.player.cell = { ...c };
    world.player.pos = { ...c };
    world.attack(boss);
    run(world, 10, () => boss.hp === 0);
  };

  it('切图不能重置 Boss 刷新时间', () => {
    const { world, boss } = lair();
    kill(world, boss);
    expect(boss.hp).toBe(0);
    world.player.cell = { ...world.portals[0]! };
    world.player.pos = { ...world.portals[0]! };
    world.moveTo({ x: 3, y: 2 });
    world.moveTo(world.portals[0]!);
    run(world, 1);
    expect(world.mapId).toBe('starter-field');
    world.moveTo({ x: 29, y: 29 });
    run(world, 2, () => world.mapId === 'taina-mountain');
    expect(world.mapId).toBe('taina-mountain');
    expect(world.monsters.find((monster) => monster.def.boss)!.hp).toBe(0);
  });

  it('Boss 到时间重生，并且刷新时间写入存档', () => {
    const { world, boss } = lair();
    kill(world, boss);
    const save = world.toSave(1);
    expect(Object.keys(save.bossReadyAt)).toHaveLength(1);
    const loaded = World.fromSave(config, save, 2);
    const again = loaded.monsters.find((monster) => monster.def.boss)!;
    expect(again.hp).toBe(0);
    for (const monster of loaded.monsters) monster.def = { ...monster.def, aggroRange: 0 };
    run(loaded, boss.def.respawnSeconds + 1);
    expect(loaded.monsters.find((monster) => monster.def.boss)!.hp).toBeGreaterThan(0);
  });
});

describe('商店', () => {
  const shop = () => {
    const world = town();
    standBy(world, 'herb-keeper');
    return world;
  };

  it('买丹药扣灵石，灵石不够时拒绝', () => {
    const world = shop();
    world.player.gold = 25;
    world.buy(npc('herb-keeper'), 'small-potion');
    expect(world.player.bag['small-potion']).toBe(1);
    expect(world.player.gold).toBe(5);
    world.buy(npc('herb-keeper'), 'small-potion');
    expect(world.player.bag['small-potion']).toBe(1);
  });

  it('不能买不在货架上的物品，离开后不能交易', () => {
    const world = shop();
    world.player.gold = 9999;
    world.buy(npc('herb-keeper'), 'blue-sword');
    expect(world.player.equipBag).toHaveLength(0);
    world.moveTo({ x: 20, y: 20 });
    run(world, 15, () => world.player.order === null);
    world.buy(npc('herb-keeper'), 'small-potion');
    expect(world.player.bag['small-potion']).toBeUndefined();
  });

  it('商店法器是下品，售价随品阶提高', () => {
    const world = shop();
    world.player.gold = 100;
    world.buy(npc('herb-keeper'), 'cloth-robe');
    const robe = world.player.equipment.armor!;
    expect(robe.grade).toBe('low');
    expect(robe.affixes).toEqual([]);
    expect(world.sellPrice(robe)).toBe(18);
    expect(world.sellPrice({ ...robe, grade: 'top' })).toBe(180);
  });

  it('卖法器和材料', () => {
    const world = shop();
    world.player.equipBag.push({ uid: 900, itemId: 'cloth-robe', grade: 'high', affixes: [], luck: 0 });
    world.player.bag['ape-fur'] = 2;
    world.sellEquipment(npc('herb-keeper'), 900);
    world.sellItem(npc('herb-keeper'), 'ape-fur');
    expect(world.player.equipBag).toEqual([]);
    expect(world.player.bag['ape-fur']).toBe(1);
    expect(world.player.gold).toBe(72 + 4);
  });
});

describe('任务', () => {
  it('对话任务：接取、拜见、回来交付、解锁下一个', () => {
    const world = town();
    expect(status(world, 'join-sect')).toBe('available');
    expect(status(world, 'clear-rats')).toBe('locked');

    world.acceptQuest('join-sect');
    expect(status(world, 'join-sect')).toBe('active');
    standBy(world, 'herb-keeper');
    expect(status(world, 'join-sect')).toBe('ready');

    world.turnInQuest('join-sect');
    expect(status(world, 'join-sect')).toBe('done');
    expect(world.player.gold).toBe(100);
    expect(world.player.bag['small-potion']).toBe(5);
    expect(world.player.level).toBe(2);
    expect(status(world, 'clear-rats')).toBe('available');
  });

  it('未完成时不能交付，已完成的不能重复领奖', () => {
    const world = town();
    world.turnInQuest('join-sect');
    expect(world.player.gold).toBe(0);
    world.acceptQuest('join-sect');
    world.turnInQuest('join-sect');
    expect(world.player.gold).toBe(0);
    standBy(world, 'herb-keeper');
    world.turnInQuest('join-sect');
    world.turnInQuest('join-sect');
    world.acceptQuest('join-sect');
    expect(world.player.gold).toBe(100);
  });

  it('击杀任务累计进度，不超过目标数', () => {
    const world = new World(config, 'starter-field', 'body', 4);
    world.player.quests.completed.push('join-sect');
    world.acceptQuest('clear-rats');
    world.drainEvents();
    const events: GameEvent[] = [];
    for (const monster of world.monsters.slice(0, 7)) {
      monster.hp = 1;
      monster.stats = { ...monster.stats, evasion: 0, defense: { min: 0, max: 0 } };
      monster.cell = { x: world.player.cell.x + 1, y: world.player.cell.y };
      monster.pos = { ...monster.cell };
      monster.home = { ...monster.cell };
      world.attack(monster);
      run(world, 8, () => monster.hp === 0);
      events.push(...world.drainEvents());
    }
    expect(world.player.quests.active[0]?.counts).toEqual([5]);
    expect(events.filter((event) => event.type === 'questProgress')).toHaveLength(5);
    expect(status(world, 'clear-rats')).toBe('ready');
  });

  it('到达任务：已在目标地图时接取即完成', () => {
    const world = new World(config, 'taina-mountain', 'body', 1);
    world.player.level = 3;
    world.player.quests.completed.push('clear-rats');
    world.acceptQuest('taina-meeting');
    expect(status(world, 'taina-meeting')).toBe('ready');
  });

  it('收集任务按背包计算，交付时扣除材料', () => {
    const world = town();
    world.player.level = 3;
    world.acceptQuest('ape-fur');
    world.player.bag['ape-fur'] = 2;
    expect(status(world, 'ape-fur')).toBe('active');
    world.player.bag['ape-fur'] = 4;
    expect(status(world, 'ape-fur')).toBe('ready');
    world.turnInQuest('ape-fur');
    expect(world.player.bag['ape-fur']).toBe(1);
  });

  it('背包放不下法器奖励时不能交付', () => {
    const world = town();
    world.player.level = 6;
    world.player.quests.completed.push('taina-meeting');
    world.player.quests.active.push({ id: 'slay-serpent', counts: [1] });
    for (let uid = 0; uid < config.affixes.bagCapacity; uid++) {
      world.player.equipBag.push({ uid: 1000 + uid, itemId: 'cloth-robe', grade: 'low', affixes: [], luck: 0 });
    }
    world.turnInQuest('slay-serpent');
    expect(status(world, 'slay-serpent')).toBe('ready');
  });

  it('任务进度写入存档', () => {
    const world = town();
    world.acceptQuest('join-sect');
    standBy(world, 'herb-keeper');
    const loaded = World.fromSave(config, world.toSave(1), 2);
    expect(status(loaded, 'join-sect')).toBe('ready');
  });
});

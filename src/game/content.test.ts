import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG_FILES, validateConfig, type GameConfig } from './config';
import { Grid } from './grid';
import { findPath } from './pathfinding';
import { questStatus } from './quests';
import { realmName } from './realm';
import { Rng } from './rng';
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

describe('境界突破', () => {
  const capped = () => {
    const world = town();
    const { player } = world;
    player.level = 13;
    return { world, player };
  };
  const stock = (world: World) => {
    world.player.bag['foundation-pill'] = 1;
    world.player.bag['serpent-scale'] = 3;
  };
  const give = (world: World, amount: number) => {
    (world as unknown as { gainExp(amount: number): void }).gainExp(amount);
  };
  const seedFor = (success: boolean) => {
    for (let seed = 1; seed < 100; seed++) {
      const roll = new Rng(seed).next();
      if (roll < 0.6 === success) return seed;
    }
    throw new Error('找不到种子');
  };

  it('到境界上限后不再升级，经验封顶', () => {
    const { world, player } = capped();
    give(world, 999999);
    expect(player.level).toBe(13);
    expect(player.exp).toBe(world.expToNext);
  });

  it('上限以下不受影响', () => {
    const world = town();
    give(world, world.expToNext!);
    expect(world.player.level).toBe(2);
  });

  it('缺材料或修为不满时不消耗', () => {
    const { world, player } = capped();
    stock(world);
    world.attemptBreakthrough();
    expect(player.bag['foundation-pill']).toBe(1);
    expect(world.drainEvents()).toContainEqual({ type: 'message', text: '修为尚未圆满' });

    give(world, 999999);
    delete player.bag['serpent-scale'];
    world.attemptBreakthrough();
    expect(player.bag['foundation-pill']).toBe(1);
    expect(player.realmPassed).toEqual([]);
  });

  it('突破成功后继续升级，进入筑基', () => {
    const { world, player } = capped();
    Object.assign(world, { rng: new Rng(seedFor(true)) });
    stock(world);
    give(world, 999999);
    world.attemptBreakthrough();
    expect(player.realmPassed).toEqual(['qi']);
    expect(player.level).toBe(14);
    expect(player.bag).toEqual({});
    expect(realmName(config.realms, player.level)).toBe('筑基初期');
  });

  it('突破失败消耗材料，不掉等级，可以再试', () => {
    const { world, player } = capped();
    Object.assign(world, { rng: new Rng(seedFor(false)) });
    stock(world);
    give(world, 999999);
    world.attemptBreakthrough();
    expect(player.level).toBe(13);
    expect(player.realmPassed).toEqual([]);
    expect(player.bag).toEqual({});
    expect(player.exp).toBe(world.expToNext);
  });

  it('突破记录写入存档', () => {
    const { world, player } = capped();
    player.realmPassed.push('qi');
    player.level = 14;
    expect(World.fromSave(config, world.toSave(1), 2).player.realmPassed).toEqual(['qi']);
  });
});

describe('死亡掉装', () => {
  const sword = { uid: 900, itemId: 'rusty-sword', grade: 'top', affixes: [], luck: 2 };
  const alwaysDrop: GameConfig = {
    ...config,
    affixes: { ...config.affixes, death: { dropChance: 1, pickupSeconds: 60 } },
  };
  const dying = (setup: GameConfig = alwaysDrop) => {
    const world = new World(setup, 'starter-field', 'body', 1);
    const { player } = world;
    player.equipment.weapon = structuredClone(sword);
    player.hp = 1;
    const monster = world.monsters[0]!;
    monster.cell = { x: player.cell.x + 1, y: player.cell.y };
    monster.pos = { ...monster.cell };
    monster.home = { ...monster.cell };
    monster.stats = { ...monster.stats, accuracy: 1e9, attack: { min: 50, max: 50 } };
    run(world, 10, () => player.hp === 0);
    return world;
  };

  it('死亡时按概率掉身上法器，属性随之下降，背包不掉', () => {
    const world = new World(alwaysDrop, 'starter-field', 'body', 1);
    world.player.equipBag.push({ ...sword, uid: 901 });
    world.player.equipment.weapon = structuredClone(sword);
    world.player.hp = 1;
    const monster = world.monsters[0]!;
    monster.cell = { x: world.player.cell.x + 1, y: world.player.cell.y };
    monster.pos = { ...monster.cell };
    monster.home = { ...monster.cell };
    monster.stats = { ...monster.stats, accuracy: 1e9, attack: { min: 50, max: 50 } };
    run(world, 10, () => world.player.hp === 0);
    expect(world.player.equipment.weapon).toBeUndefined();
    expect(world.player.equipBag).toHaveLength(1);
    expect(world.items.map((item) => item.equipment?.uid)).toContain(900);
    expect(world.deathDrops).toHaveLength(1);
  });

  it('掉落概率为 0 时不掉', () => {
    const noDrop = { ...alwaysDrop, affixes: { ...alwaysDrop.affixes, death: { dropChance: 0, pickupSeconds: 60 } } };
    const world = dying(noDrop);
    expect(world.player.equipment.weapon?.uid).toBe(900);
    expect(world.deathDrops).toEqual([]);
  });

  it('复活回城后掉落还在，回到原地能捡回', () => {
    const world = dying();
    run(world, 4, () => world.player.hp > 0);
    expect(world.mapId).toBe('huangfeng-valley');
    expect(world.items).toEqual([]);
    expect(world.deathDrops).toHaveLength(1);

    world.moveTo(world.portals[0]!);
    run(world, 15, () => world.mapId === 'starter-field');
    const dropped = world.items.find((item) => item.equipment?.uid === 900)!;
    expect(dropped).toBeDefined();
    world.pickup(dropped);
    run(world, 10, () => world.deathDrops.length === 0);
    expect(world.player.equipment.weapon).toEqual(sword);
  });

  it('超过限时后消失，在别的地图也会计时', () => {
    const world = dying();
    run(world, 4, () => world.player.hp > 0);
    run(world, 61);
    expect(world.deathDrops).toEqual([]);
  });

  it('死亡掉落写入存档，读档后还能在原地图看到', () => {
    const world = dying();
    const loaded = World.fromSave(alwaysDrop, world.toSave(1), 2);
    expect(loaded.deathDrops).toHaveLength(1);
    expect(loaded.deathDrops[0]?.item.equipment?.uid).toBe(900);
    expect(loaded.deathDrops[0]?.item.expiresAt).toBe(world.deathDrops[0]?.item.expiresAt);
  });
});

describe('自动挂机', () => {
  const field = (classId = 'body', seed = 1) => {
    const world = new World(config, 'starter-field', classId, seed);
    world.player.auto.enabled = true;
    return world;
  };

  it('关闭时什么都不做', () => {
    const world = field();
    world.player.auto.enabled = false;
    for (const monster of world.monsters) monster.def = { ...monster.def, aggroRange: 0 };
    run(world, 5);
    expect(world.player.order).toBeNull();
  });

  it('三个职业都能自动打怪并拾取', () => {
    for (const classId of Object.keys(config.classes)) {
      const world = field(classId);
      run(world, 240);
      expect(world.player.exp + world.player.level * 1000, classId).toBeGreaterThan(1000);
      expect(world.player.gold, classId).toBeGreaterThan(0);
    }
  });

  it('自动使用技能', () => {
    const world = field('spell');
    run(world, 30, () => Object.keys(world.player.skillCooldowns).length > 0);
    expect(world.player.skillCooldowns['spell-fire']).toBeDefined();
  });

  it('生命低于阈值时吃药', () => {
    const world = field();
    world.player.bag['small-potion'] = 2;
    world.player.hp = 10;
    run(world, 1);
    expect(world.player.bag['small-potion']).toBeLessThan(2);
  });

  it('低血回城后关闭挂机', () => {
    const world = field();
    world.player.hp = 5;
    run(world, 1);
    expect(world.mapId).toBe('huangfeng-valley');
    expect(world.player.auto.enabled).toBe(false);
  });

  it('回城阈值为 0 时不回城', () => {
    const world = field();
    world.player.auto.recallBelow = 0;
    world.player.hp = 5;
    for (const monster of world.monsters) monster.def = { ...monster.def, aggroRange: 0 };
    run(world, 0.5);
    expect(world.mapId).toBe('starter-field');
  });

  it('不打 Boss', () => {
    const world = new World(config, 'taina-mountain', 'body', 1);
    world.player.auto.enabled = true;
    for (const monster of world.monsters) {
      if (!monster.def.boss) monster.hp = 0;
      monster.respawnLeft = 999;
    }
    run(world, 3);
    expect(world.player.order).toBeNull();
  });

  it('品阶过滤：不捡低于设置的法器，灵石和丹药照捡', () => {
    const world = field();
    for (const monster of world.monsters) {
      monster.hp = 0;
      monster.respawnLeft = 999;
    }
    world.player.auto.minGrade = 'high';
    const at = (x: number, y: number) => ({ x: world.player.cell.x + x, y: world.player.cell.y + y });
    const spawn = (...args: unknown[]) =>
      (world as unknown as { spawnItem(...args: unknown[]): void }).spawnItem(...args);
    spawn(config.items['rusty-sword'], 1, { uid: 800, itemId: 'rusty-sword', grade: 'low', affixes: [], luck: 0 }, at(1, 0));
    spawn(config.items.gold, 7, null, at(2, 0));
    run(world, 4);
    expect(world.player.gold).toBe(7);
    expect(world.items.map((item) => item.equipment?.uid)).toContain(800);
  });

  it('手动移动后暂停，之后继续挂机', () => {
    const world = field();
    for (const monster of world.monsters) monster.def = { ...monster.def, aggroRange: 0 };
    const start = { x: world.player.cell.x, y: world.player.cell.y + 1 };
    world.moveTo(start);
    run(world, 2);
    expect(world.player.cell).toEqual(start);
    run(world, 2);
    expect(world.player.order?.type).toBe('attack');
  });

  it('设置写入存档，读档后挂机保持关闭', () => {
    const world = field();
    world.player.auto.minGrade = 'high';
    const loaded = World.fromSave(config, world.toSave(1), 2);
    expect(loaded.player.auto.minGrade).toBe('high');
    expect(loaded.player.auto.enabled).toBe(false);
  });
});

describe('闭关', () => {
  const hour = 3600 * 1000;
  const fielded = () => {
    const world = new World(config, 'starter-field', 'body', 1);
    world.player.level = 3;
    return world;
  };

  it('不足一分钟没有收益，时钟倒退也没有', () => {
    const world = fielded();
    expect(world.settleOffline(0, 30 * 1000)).toBeNull();
    expect(world.settleOffline(hour, 0)).toBeNull();
    expect(world.player.gold).toBe(0);
  });

  it('收益随时间增长，超过 8 小时不再增加', () => {
    const one = fielded().settleOffline(0, hour)!;
    const eight = fielded().settleOffline(0, 8 * hour)!;
    const ten = fielded().settleOffline(0, 10 * hour)!;
    expect(one.exp).toBeGreaterThan(0);
    expect(eight.gold).toBeGreaterThan(one.gold * 7);
    expect(ten).toEqual(eight);
  });

  it('只给经验和灵石，不给法器，不会死亡', () => {
    const world = fielded();
    world.player.hp = 1;
    world.settleOffline(0, 8 * hour);
    expect(world.player.equipBag).toEqual([]);
    expect(world.player.hp).toBeGreaterThan(0);
  });

  it('到境界上限时经验封顶', () => {
    const world = fielded();
    world.player.level = 13;
    world.settleOffline(0, 8 * hour);
    expect(world.player.level).toBe(13);
  });

  it('在主城下线按最后到过的野外地图结算', () => {
    const world = fielded();
    const save = world.toSave(0);
    save.mapId = 'huangfeng-valley';
    save.player.cell = { x: 12, y: 14 };
    const loaded = World.fromSave(config, save, 2);
    expect(loaded.settleOffline(0, hour)?.gold).toBeGreaterThan(0);
  });

  it('旧存档没有野外记录时，在野外读档会记下当前地图', () => {
    const save = fielded().toSave(0);
    save.player.lastFieldMap = null;
    expect(World.fromSave(config, save, 2).player.lastFieldMap).toBe('starter-field');
  });

  it('从未去过野外时也能结算', () => {
    const world = town();
    expect(world.settleOffline(0, hour)?.exp).toBeGreaterThan(0);
  });
});


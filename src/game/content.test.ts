import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { monsterDrops, validateConfig, type GameConfig } from './config';
import type { Equipment } from './equipment';
import { cellDistance, Grid } from './grid';
import { findPath } from './pathfinding';
import { questDestination } from './navigation';
import { questStatus } from './quests';
import { loadConfigFromDisk } from './testConfig';
import { breakthroughChance, realmName } from './realm';
import { Rng } from './rng';
import { itemSources } from './sources';
import { mapAssets } from '../render/mapAssets';
import { TICK_SECONDS, World, type GameEvent } from './world';

const config = await loadConfigFromDisk();

const npc = (id: string) => config.npcs[id]!;
/** 前两章已通关，能进入黄枫谷和太南山。 */
const passChapterOne = (world: World) => {
  world.player.quests.completed.push('ch1-boss', 'ch2-enter', 'ch2-token');
  return world;
};
const town = () => passChapterOne(new World(config, 'huangfeng-valley', 'body', 1));

/** 研读本职业当前等级能学的全部功法书。 */
function readBooks(world: World): void {
  for (const item of Object.values(config.items)) {
    const skill = config.skills[item.skill ?? ''];
    if (item.kind !== 'book' || skill?.classId !== world.player.def.id || skill.level > world.player.level) continue;
    world.player.bag[item.id] = 1;
    world.inventory.useItem(item.id);
  }
}

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
    expect(world.mapId).toBe('qixuan-gate');
    expect(world.player.cell).toEqual({ x: 20, y: 22 });
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
    return { world, boss: world.monsters.find((monster) => monster.def.id === 'flood-serpent')! };
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
    passChapterOne(world);
    kill(world, boss);
    expect(boss.hp).toBe(0);
    world.player.cell = { ...world.portals[0]! };
    world.player.pos = { ...world.portals[0]! };
    world.moveTo({ x: 3, y: 2 });
    world.moveTo(world.portals[0]!);
    run(world, 1);
    expect(world.mapId).toBe('starter-field');
    world.moveTo({ x: 111, y: 111 });
    run(world, 2, () => world.mapId === 'taina-mountain');
    expect(world.mapId).toBe('taina-mountain');
    expect(world.monsters.find((monster) => monster.def.id === 'flood-serpent')!.hp).toBe(0);
  });

  it('Boss 到时间重生，并且刷新时间写入存档', () => {
    const { world, boss } = lair();
    kill(world, boss);
    const save = world.toSave(1);
    expect(Object.keys(save.bossReadyAt)).toHaveLength(1);
    const loaded = World.fromSave(config, save, 2);
    const again = loaded.monsters.find((monster) => monster.def.id === 'flood-serpent')!;
    expect(again.hp).toBe(0);
    for (const monster of loaded.monsters) monster.def = { ...monster.def, aggroRange: 0 };
    run(loaded, boss.def.respawnSeconds + 1);
    expect(loaded.monsters.find((monster) => monster.def.id === 'flood-serpent')!.hp).toBeGreaterThan(0);
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
    expect(status(world, 'ch3-trial')).toBe('locked');

    world.acceptQuest('join-sect');
    expect(status(world, 'join-sect')).toBe('active');
    standBy(world, 'herb-keeper');
    expect(status(world, 'join-sect')).toBe('ready');

    world.turnInQuest('join-sect');
    expect(status(world, 'join-sect')).toBe('done');
    expect(world.player.gold).toBe(100);
    expect(world.player.bag['small-potion']).toBe(5);
    expect(world.player.level).toBe(2);
    expect(status(world, 'ch3-trial')).toBe('locked');
    world.player.level = 11;
    expect(status(world, 'ch3-trial')).toBe('available');
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
    world.player.quests.completed.push('ch1-enter');
    world.acceptQuest('ch1-herbs');
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
    expect(status(world, 'ch1-herbs')).toBe('ready');
  });

  it('到达任务：已在目标地图时接取即完成', () => {
    const setup = structuredClone(config);
    setup.quests['arrive'] = {
      ...config.quests['ch1-enter']!,
      id: 'arrive',
      objectives: [{ type: 'reach', target: 'taina-mountain', count: 1 }],
    };
    const world = new World(setup, 'taina-mountain', 'body', 1);
    world.acceptQuest('arrive');
    expect(world.player.quests.active[0]?.counts).toEqual([1]);
  });

  it('收集任务按背包计算，交付时扣除材料', () => {
    const world = town();
    world.player.level = 3;
    world.player.quests.completed.push('join-sect');
    world.acceptQuest('ape-fur');
    world.player.bag['ape-fur'] = 2;
    expect(status(world, 'ape-fur')).toBe('active');
    world.player.bag['ape-fur'] = 4;
    expect(status(world, 'ape-fur')).toBe('ready');
    world.turnInQuest('ape-fur');
    expect(world.player.bag['ape-fur']).toBe(1);
  });

  it('背包放不下法器奖励时不能交付', () => {
    const setup = structuredClone(config);
    const quest = setup.quests['join-sect']!;
    quest.rewards.items = [{ item: 'steel-sword', count: 1 }];
    const world = passChapterOne(new World(setup, 'huangfeng-valley', 'body', 1));
    world.player.quests.active.push({ id: 'join-sect', counts: [1] });
    for (let uid = 0; uid < config.affixes.bagCapacity; uid++) {
      world.player.equipBag.push({ uid: 1000 + uid, itemId: 'cloth-robe', grade: 'low', affixes: [], luck: 0 });
    }
    world.turnInQuest('join-sect');
    expect(world.player.quests.completed).not.toContain('join-sect');
    expect(world.player.quests.active.map((active) => active.id)).toContain('join-sect');
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
    expect(player.breakthroughFails.qi).toBe(1);
  });

  it('失败后虚弱 10 分钟，属性降低 20%，到时恢复', () => {
    const { world, player } = capped();
    Object.assign(world, { rng: new Rng(seedFor(false)) });
    stock(world);
    give(world, 999999);
    world.attemptBreakthrough();
    const weakened = player.stats.maxHp;
    run(world, 601);
    expect(weakened).toBe(Math.floor(player.stats.maxHp * 0.8));
    expect(player.weakUntil).toBe(0);
  });

  it('失败累积成功率，3 次后必定成功', () => {
    const realm = config.realms[0]!;
    expect(breakthroughChance(realm, 0)).toBeCloseTo(0.6);
    expect(breakthroughChance(realm, 1)).toBeCloseTo(0.75);
    expect(breakthroughChance(realm, 3)).toBe(1);
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
  const withDeath = (patch: Partial<GameConfig['affixes']['death']>): GameConfig => ({
    ...config,
    affixes: { ...config.affixes, death: { ...config.affixes.death, ...patch } },
  });
  const alwaysDrop = withDeath({ dropChance: 1, autoDropChance: 1, pickupSeconds: 60 });

  const killPlayer = (world: World) => {
    const { player } = world;
    player.hp = 1;
    const monster = world.monsters.find((candidate) => candidate.hp > 0)!;
    monster.cell = { x: player.cell.x + 1, y: player.cell.y };
    monster.pos = { ...monster.cell };
    monster.home = { ...monster.cell };
    monster.mode = 'idle';
    monster.stats = { ...monster.stats, accuracy: 1e9, attack: { min: 50, max: 50 } };
    run(world, 10, () => player.hp === 0);
  };
  const dying = (setup: GameConfig = alwaysDrop, level = 11) => {
    const world = new World(setup, 'starter-field', 'body', 1);
    world.player.level = level;
    world.player.equipment.weapon = structuredClone(sword);
    killPlayer(world);
    return world;
  };

  it('死亡时掉 1 件身上法器，背包不掉', () => {
    const world = new World(alwaysDrop, 'starter-field', 'body', 1);
    world.player.level = 11;
    world.player.equipBag.push({ ...sword, uid: 901 });
    world.player.equipment.weapon = structuredClone(sword);
    world.player.equipment.armor = { ...sword, uid: 902, itemId: 'cloth-robe' };
    killPlayer(world);
    expect(Object.keys(world.player.equipment)).toHaveLength(1);
    expect(world.player.equipBag).toHaveLength(1);
    expect(world.deathDrops).toHaveLength(1);
  });

  it('掉落概率为 0 时不掉', () => {
    const world = dying(withDeath({ dropChance: 0 }));
    expect(world.player.equipment.weapon?.uid).toBe(900);
  });

  it('10 级及以下不掉装', () => {
    const world = dying(alwaysDrop, 10);
    expect(world.player.equipment.weapon?.uid).toBe(900);
    expect(world.deathDrops).toEqual([]);
  });

  it('死后 5 分钟内再死不掉装', () => {
    const world = new World(alwaysDrop, 'starter-field', 'body', 1);
    world.player.level = 11;
    world.player.equipment.weapon = structuredClone(sword);
    world.player.lastDeathAt = world.time;
    killPlayer(world);
    expect(world.player.equipment.weapon?.uid).toBe(900);
  });

  it('挂机时使用减半的掉装概率', () => {
    const noAuto = withDeath({ dropChance: 1, autoDropChance: 0 });
    const world = new World(noAuto, 'starter-field', 'body', 1);
    world.player.level = 11;
    world.player.auto.enabled = true;
    world.player.auto.recallBelow = 0;
    world.player.equipment.weapon = structuredClone(sword);
    killPlayer(world);
    expect(world.player.equipment.weapon?.uid).toBe(900);
  });

  it('复活回城后掉落还在，回到原地能捡回', () => {
    const world = dying();
    run(world, 4, () => world.player.hp > 0);
    expect(world.mapId).toBe('qixuan-gate');
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

describe('拾取', () => {
  const spawnAt = (world: World, itemId: string, x: number, y: number, equipment: Equipment | null = null, amount = 1) =>
    (world as unknown as {
      spawnItem(def: unknown, amount: number, equipment: unknown, cell: unknown): World['items'][number];
    }).spawnItem(config.items[itemId], amount, equipment, {
      x: world.player.cell.x + x,
      y: world.player.cell.y + y,
    });
  const blade = (uid: number, grade: string): Equipment => ({ uid, itemId: 'rusty-sword', grade, affixes: [], luck: 0 });
  const quiet = () => {
    const world = new World(config, 'huangfeng-valley', 'body', 1);
    world.player.cell = { x: 12, y: 14 };
    world.player.pos = { x: 12, y: 14 };
    return world;
  };

  it('6 格内的灵石自动飞来，更远的不会', () => {
    const world = quiet();
    spawnAt(world, 'gold', 6, 0, null, 10);
    spawnAt(world, 'gold', 7, 0, null, 99);
    run(world, 0.2);
    expect(world.player.gold).toBe(10);
    expect(world.items).toHaveLength(1);
  });

  it('2 格内的丹药自动拾取，3 格不会', () => {
    const world = quiet();
    spawnAt(world, 'small-potion', 2, 0);
    spawnAt(world, 'small-mana', 3, 0);
    run(world, 0.2);
    expect(world.player.bag).toEqual({ 'small-potion': 1 });
  });

  it('出招时也能吸灵石', () => {
    const world = quiet();
    world.player.windupLeft = 5;
    spawnAt(world, 'gold', 3, 0, null, 4);
    run(world, 0.2);
    expect(world.player.gold).toBe(4);
  });

  it('法器不会自动拾取', () => {
    const world = quiet();
    spawnAt(world, 'rusty-sword', 1, 0, blade(800, 'top'));
    run(world, 0.5);
    expect(world.items).toHaveLength(1);
  });

  it('空格捡起范围内达到品阶线的法器', () => {
    const world = quiet();
    world.player.auto.minGrade = 'mid';
    spawnAt(world, 'rusty-sword', 4, 0, blade(800, 'high'));
    spawnAt(world, 'rusty-sword', 5, 0, blade(801, 'low'));
    spawnAt(world, 'rusty-sword', 7, 0, blade(802, 'top'));
    world.pickupNearbyEquipment();
    expect(world.player.equipment.weapon?.uid).toBe(800);
    expect(world.items.map((item) => item.equipment?.uid).sort()).toEqual([801, 802]);
  });

  it('空格不捡自己丢弃的法器，但可以手动点', () => {
    const world = quiet();
    world.player.equipment.weapon = blade(1, 'low');
    world.player.equipBag.push(blade(800, 'top'));
    world.discard(800);
    world.pickupNearbyEquipment();
    expect(world.items).toHaveLength(1);
    world.pickup(world.items[0]!);
    run(world, 2, () => world.items.length === 0);
    expect(world.player.equipBag.map((equipment) => equipment.uid)).toEqual([800]);
  });

  it('背包满时空格不捡', () => {
    const world = quiet();
    world.player.equipment.weapon = blade(1, 'low');
    for (let uid = 0; uid < config.affixes.bagCapacity; uid++) world.player.equipBag.push(blade(1000 + uid, 'low'));
    spawnAt(world, 'rusty-sword', 1, 0, blade(800, 'top'));
    world.pickupNearbyEquipment();
    expect(world.items).toHaveLength(1);
  });
});

describe('怪物技能', () => {
  const lair = () => {
    const world = new World(config, 'taina-mountain', 'body', 1);
    const boss = world.monsters.find((monster) => monster.def.id === 'flood-serpent')!;
    for (const monster of world.monsters) {
      if (monster !== boss) {
        monster.hp = 0;
        monster.respawnLeft = 9999;
      }
    }
    const { player } = world;
    player.stats = { ...player.stats, maxHp: 5000, evasion: 0 };
    player.hp = 5000;
    const cell = { x: boss.cell.x + 2, y: boss.cell.y };
    player.cell = { ...cell };
    player.pos = { ...cell };
    return { world, boss, player };
  };

  it('前摇时地面预警，站着不动会被命中', () => {
    const { world, player } = lair();
    const events: GameEvent[] = [];
    run(world, 4, () => {
      events.push(...world.drainEvents());
      return player.hp < 5000;
    });
    const warning = events.find((event) => event.type === 'telegraph');
    expect(warning).toBeDefined();
    expect(player.hp).toBeLessThan(5000);
  });

  it('前摇期间走出范围就能躲开', () => {
    const { world, boss, player } = lair();
    run(world, 2, () => boss.windupLeft > 0);
    expect(boss.windupLeft).toBeGreaterThan(0);
    const safe = { x: boss.cell.x + 5, y: boss.cell.y + 3 };
    player.cell = { ...safe };
    player.pos = { ...safe };
    run(world, 1.2);
    expect(player.hp).toBe(5000);
  });

  it('生命低于阈值进入狂暴，脱战后复原', () => {
    const { world, boss, player } = lair();
    const attack = boss.stats.attack.max;
    (world as unknown as { dealDamage(a: unknown, b: unknown, c: number, d: boolean): void }).dealDamage(player, boss, 400, false);
    expect(boss.phase).toBe(1);
    expect(boss.stats.attack.max).toBeGreaterThan(attack);
    boss.mode = 'return';
    boss.path = [];
    run(world, 0.5);
    expect(boss.phase).toBe(0);
    expect(boss.stats.attack.max).toBe(attack);
    expect(boss.hp).toBe(boss.stats.maxHp);
  });
});

describe('剧情开关', () => {
  const withStory = (): GameConfig => ({
    ...config,
    npcs: {
      ...config.npcs,
      hidden: { ...config.npcs['guide-senior']!, id: 'hidden', x: 3, y: 12, requires: 'join-sect' },
      early: { ...config.npcs['guide-senior']!, id: 'early', x: 3, y: 13, hiddenAfter: 'join-sect' },
    },
    quests: {
      ...config.quests,
      'join-sect': {
        ...config.quests['join-sect']!,
        rewards: {
          ...config.quests['join-sect']!.rewards,
          teleport: { map: 'starter-field', x: 12, y: 12 },
        },
      },
    },
  });

  it('任务完成后 NPC 出现或消失，并传送到下一章', () => {
    const world = passChapterOne(new World(withStory(), 'huangfeng-valley', 'body', 1));
    expect(world.npcs.map((npc) => npc.id)).toContain('early');
    expect(world.npcs.map((npc) => npc.id)).not.toContain('hidden');
    world.player.quests.active.push({ id: 'join-sect', counts: [1] });
    world.turnInQuest('join-sect');
    expect(world.mapId).toBe('starter-field');
    expect(world.player.cell).toEqual({ x: 12, y: 12 });
    world.moveTo(world.portals.find((portal) => portal.name === '黄枫谷')!);
    run(world, 10, () => world.mapId === 'huangfeng-valley');
    expect(world.npcs.map((npc) => npc.id)).toContain('hidden');
    expect(world.npcs.map((npc) => npc.id)).not.toContain('early');
  });

  it('未解锁的传送点走上去不会切图', () => {
    const locked = structuredClone(config);
    locked.maps['huangfeng-valley']!.portals![0]!.requires = 'join-sect';
    const world = new World(locked, 'huangfeng-valley', 'body', 1);
    world.moveTo(world.portals[0]!);
    run(world, 12);
    expect(world.mapId).toBe('huangfeng-valley');
  });
});

describe('Tiled 地图', () => {
  it('彩霞山能从 Tiled 文件解析', () => {
    const map = config.maps['starter-field']!;
    expect(map.width).toBe(120);
    expect(map.spawns).toHaveLength(44);
    expect(map.portals).toHaveLength(3);
    expect(map.playerStart).toEqual({ x: 12, y: 12 });
    expect(map.ground).toHaveLength(120 * 120);
    expect(new Grid(map).isWalkable({ x: 0, y: 0 })).toBe(false);
    expect(new Grid(map).isWalkable({ x: 12, y: 12 })).toBe(true);
  });

  it('景观都在地图内，树挡路，草不挡路', () => {
    const map = config.maps['starter-field']!;
    const grid = new Grid(map);
    const placed = (prefix: string) => map.decor!.filter((item) => item.prop.startsWith(prefix));
    expect(placed('tree').length).toBeGreaterThan(200);
    for (const item of map.decor!) {
      expect(item.x > 0 && item.y > 0 && item.x < 120 && item.y < 120).toBe(true);
    }
    for (const item of placed('tree')) {
      expect(grid.isWalkable({ x: Math.floor(item.x), y: Math.floor(item.y) })).toBe(false);
    }
    for (const item of placed('grass')) {
      expect(grid.isWalkable({ x: Math.floor(item.x), y: Math.floor(item.y) })).toBe(true);
    }
  });

  it('两座主城：40×40，建筑挡路，NPC 站在能走到的地方', () => {
    for (const mapId of ['qixuan-gate', 'huangfeng-valley']) {
      const map = config.maps[mapId]!;
      const grid = new Grid(map);
      expect(map.width).toBe(40);
      expect(map.safe).toBe(true);
      expect(map.spawns).toHaveLength(0);
      expect(grid.isWalkable(map.playerStart)).toBe(true);
      expect(map.decor!.filter((item) => item.foot).length).toBeGreaterThan(3);
      for (const { foot } of map.decor!.filter((item) => item.foot)) {
        expect(grid.isWalkable({ x: foot!.x0, y: foot!.y0 })).toBe(false);
      }
      for (const npc of Object.values(config.npcs).filter((candidate) => candidate.map === mapId)) {
        expect(grid.isWalkable(npc), npc.id).toBe(true);
        expect(findPath(grid, map.playerStart, npc, () => true), npc.id).not.toBeNull();
      }
      for (const portal of map.portals!) {
        expect(findPath(grid, map.playerStart, portal, () => true)).not.toBeNull();
      }
    }
  });

  it('牌楼中间能穿过，彩霞山的怪物保持间距', () => {
    const grid = new Grid(config.maps['qixuan-gate']!);
    expect(grid.isWalkable({ x: 20, y: 29 })).toBe(true);
    expect(grid.isWalkable({ x: 17, y: 29 })).toBe(false);
    const { spawns } = config.maps['starter-field']!;
    for (const a of spawns) {
      for (const b of spawns) {
        if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(5);
      }
    }
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
    expect(world.mapId).toBe('qixuan-gate');
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

  it('产出普通法器，不出极品，单次最多 10 件，不会死亡', () => {
    const generous: GameConfig = structuredClone(config);
    for (const entry of generous.drops['ash-rat']!) entry.chance = 1;
    const world = new World(generous, 'starter-field', 'body', 1);
    world.player.hp = 1;
    const report = world.settleOffline(0, 8 * hour)!;
    expect(report.equipment.length + report.soldCount).toBe(10);
    expect(world.player.equipBag.every((equipment) => equipment.grade !== 'top')).toBe(true);
    expect(world.player.hp).toBeGreaterThan(0);
  });

  it('背包放不下的法器换成灵石', () => {
    const generous: GameConfig = structuredClone(config);
    for (const entry of generous.drops['ash-rat']!) entry.chance = 1;
    const world = new World(generous, 'starter-field', 'body', 1);
    for (let uid = 0; uid < config.affixes.bagCapacity; uid++) {
      world.player.equipBag.push({ uid: 5000 + uid, itemId: 'cloth-robe', grade: 'low', affixes: [], luck: 0 });
    }
    const report = world.settleOffline(0, 8 * hour)!;
    expect(report.equipment).toEqual([]);
    expect(report.soldCount).toBe(10);
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

describe('40 级内容', () => {
  const levelTo = (world: World, level: number) => {
    const { player } = world;
    world.player.realmPassed = config.realms.map((realm) => realm.id);
    while (player.level < level) {
      (world as unknown as { gainExp(amount: number): void }).gainExp(world.expToNext!);
    }
    readBooks(world);
  };

  it('三职业到 40 级技能都能放进快捷栏，丹药格不被占用', () => {
    for (const classId of Object.keys(config.classes)) {
      const world = new World(config, 'huangfeng-valley', classId, 1);
      levelTo(world, 40);
      const skills = Object.values(config.skills).filter((skill) => skill.classId === classId && skill.level <= 40);
      expect(world.player.skills, classId).toHaveLength(skills.length);
      expect(skills.length, classId).toBeGreaterThanOrEqual(6);
      const slotted = world.player.hotbar.filter((entry) => entry?.kind === 'skill');
      expect(slotted, classId).toHaveLength(skills.length);
      expect(world.player.hotbar.filter((entry) => entry?.kind === 'item')).toHaveLength(2);
    }
  });

  it('进阶功法替换旧功法，占原来的快捷栏格子，层数带过去', () => {
    const world = new World(config, 'huangfeng-valley', 'spell', 1);
    levelTo(world, 40);
    const { player } = world;
    const slot = player.hotbar.findIndex((entry) => entry?.kind === 'skill' && entry.id === 'spell-qingyuan');
    player.skillLevels['spell-qingyuan'] = 3;
    player.bag['book-spell-qingyuan-2'] = 1;
    world.inventory.useItem('book-spell-qingyuan-2');
    expect(player.skills).not.toContain('spell-qingyuan-2');
    levelTo(world, 47);
    expect(player.skills).toContain('spell-qingyuan-2');
    expect(player.skills).not.toContain('spell-qingyuan');
    expect(player.hotbar[slot]).toEqual({ kind: 'skill', id: 'spell-qingyuan-2' });
    expect(player.skillLevels['spell-qingyuan-2']).toBe(3);
    player.bag['book-spell-qingyuan'] = 1;
    world.inventory.useItem('book-spell-qingyuan');
    expect(player.skills).not.toContain('spell-qingyuan');
  });

  it('三职业到 55 级学全进阶功法，功法仍是 7 门，丹药格不被占用', () => {
    for (const classId of Object.keys(config.classes)) {
      const world = new World(config, 'huangfeng-valley', classId, 1);
      levelTo(world, 55);
      const advanced = Object.values(config.skills).filter((skill) => skill.classId === classId && skill.replaces);
      expect(advanced, classId).toHaveLength(3);
      for (const skill of advanced) {
        expect(world.player.skills, classId).toContain(skill.id);
        expect(world.player.skills, classId).not.toContain(skill.replaces);
      }
      expect(world.player.skills, classId).toHaveLength(7);
      expect(world.player.hotbar.filter((entry) => entry?.kind === 'item')).toHaveLength(2);
    }
  });

  it('等级到 55 级，40 级以后每级多要的经验不超过 8%', () => {
    const curve = config.levels.expToNext;
    expect(curve).toHaveLength(54);
    for (let level = 40; level < 55; level++) {
      expect(curve[level - 1]! / curve[level - 2]!, String(level)).toBeLessThanOrEqual(1.08);
    }
  });

  it('每个境界每个栏位都有法器，等级和属性逐级提高', () => {
    const slots = ['weapon', 'armor', 'helmet', 'necklace', 'bracelet', 'ring'] as const;
    for (const slot of slots) {
      const tiers = Object.values(config.items)
        .filter((item) => item.slot === slot && !item.boss)
        .sort((a, b) => (a.level ?? 1) - (b.level ?? 1));
      const highest = tiers.at(-1)!;
      expect(highest.level, slot).toBe(44);
      for (const level of [14, 27, 35, 44]) {
        expect(tiers.some((item) => item.level === level), `${slot} ${level}`).toBe(true);
      }
      const power = (item: (typeof tiers)[number]) =>
        Object.values(item.bonus ?? {}).reduce((sum, value) => sum + value, 0);
      const byLevel = tiers.filter((item) => (item.level ?? 1) >= 14).map(power);
      expect([...byLevel].sort((a, b) => a - b)).toEqual(byLevel);
    }
  });

  it('增伤功法提高伤害，到时结束', () => {
    const world = new World(config, 'huangfeng-valley', 'body', 1);
    levelTo(world, 34);
    const { player } = world;
    const brahma = 'body-brahma';
    player.skillCooldowns[brahma] = 0;
    world.castSkill(brahma);
    run(world, 0.5);
    expect(player.effects.map((effect) => effect.kind)).toContain('empower');
    run(world, 16);
    expect(player.effects).toEqual([]);
  });

  it('傀儡替换灵虫，只保留一个召唤物', () => {
    const world = new World(config, 'starter-field', 'spirit', 1);
    for (const monster of world.monsters) monster.def = { ...monster.def, aggroRange: 0 };
    levelTo(world, 16);
    const { player } = world;
    world.castSkill('spirit-summon');
    run(world, 0.6);
    expect(world.summons[0]?.def.id).toBe('gold-bug');
    player.mp = player.stats.maxMp;
    world.castSkill('spirit-puppet');
    run(world, 0.7);
    expect(world.summons.map((summon) => summon.def.id)).toEqual(['iron-puppet']);
  });

  it('自动挂机能用新功法', () => {
    const world = new World(config, 'taina-mountain', 'spell', 3);
    levelTo(world, 30);
    world.player.auto.enabled = true;
    world.player.auto.recallBelow = 0;
    run(world, 120);
    expect(Object.keys(world.player.skillCooldowns)).toContain('spell-bixie');
  });
});

describe('图标', () => {
  it('每个功法和物品都生成了图标', () => {
    const ids = [...Object.keys(config.skills), ...Object.keys(config.items)];
    const missing = ids.filter((id) => !existsSync(`public/assets/icons/${id}.svg`));
    expect(missing).toEqual([]);
  });
});

describe('背景音乐', () => {
  it('每张野外地图都配了本章的音乐，主城用默认音乐', () => {
    for (const map of Object.values(config.maps)) {
      if (map.safe) expect(map.music, map.id).toBeUndefined();
      else expect(map.music, map.id).toBeTruthy();
    }
    expect(config.maps['xutian-hall']!.music).toBe(config.maps['xutian-mist']!.music);
  });

  it('地图用到的曲子和 Boss 战曲子都有文件', () => {
    const source = readFileSync('src/render/audio.ts', 'utf8');
    const block = source.slice(source.indexOf('const MUSIC'), source.indexOf('};', source.indexOf('const MUSIC')));
    const files = Object.fromEntries([...block.matchAll(/(\w+): '([\w.-]+)'/g)].map((match) => [match[1], match[2]]));
    const keys = new Set(['town', 'boss', ...Object.values(config.maps).map((map) => map.music).filter(Boolean)]);
    for (const key of keys) {
      expect(files[key!], key).toBeDefined();
      expect(existsSync(`public/assets/audio/${files[key!]}`), key).toBe(true);
    }
  });
});

describe('功法书', () => {
  it('升级不再自动领悟，研读本职业的功法书才学会，书用掉', () => {
    const world = new World(config, 'huangfeng-valley', 'spell', 1);
    const { player } = world;
    expect(player.skills).toEqual(['spell-fire']);
    player.bag['book-spell-thunder'] = 1;
    world.inventory.useItem('book-spell-thunder');
    expect(player.skills).not.toContain('spell-thunder');
    while (player.level < 3) (world as unknown as { gainExp(amount: number): void }).gainExp(world.expToNext!);
    expect(player.skills).not.toContain('spell-thunder');
    world.inventory.useItem('book-spell-thunder');
    expect(player.skills).toContain('spell-thunder');
    expect(player.hotbar).toContainEqual({ kind: 'skill', id: 'spell-thunder' });
    expect(player.bag['book-spell-thunder'] ?? 0).toBe(0);
    player.bag['book-body-pierce'] = 1;
    world.inventory.useItem('book-body-pierce');
    expect(player.skills).not.toContain('body-pierce');
    expect(player.bag['book-body-pierce']).toBe(1);
  });

  it('每门功法都能在商店买到书，低级书在前期主城就有', () => {
    const sold = new Map<string, string[]>();
    for (const npc of Object.values(config.npcs)) {
      for (const itemId of npc.shop ?? []) sold.set(itemId, [...(sold.get(itemId) ?? []), npc.map]);
    }
    for (const item of Object.values(config.items).filter((candidate) => candidate.kind === 'book')) {
      expect(sold.get(item.id), item.id).toBeDefined();
      if (config.skills[item.skill!]!.level <= 8) expect(sold.get(item.id), item.id).toContain('qixuan-gate');
    }
  });
});

describe('地面持续功法', () => {
  it('火墙留在目标脚下，按间隔多次伤害站在上面的怪，到时消失', () => {
    const world = new World(config, 'taina-mountain', 'spell', 1);
    world.player.skills.push('spell-firewall');
    world.player.mp = world.player.stats.maxMp;
    const ape = world.monsters.find((monster) => monster.def.id === 'mountain-ape')!;
    world.player.cell = { x: ape.cell.x - 3, y: ape.cell.y };
    world.player.pos = { ...world.player.cell };
    ape.stats = { ...ape.stats, maxHp: 100000 };
    ape.hp = 100000;
    ape.moveSpeed = 0;
    world.castSkill('spell-firewall', ape);
    run(world, 1);
    expect(world.fields).toHaveLength(1);
    const hits = () => world.drainEvents().filter((event) => event.type === 'damage' && event.unit === ape).length;
    world.player.order = null;
    world.player.auto.enabled = false;
    hits();
    const fieldHits: number[] = [];
    for (let second = 0; second < 7; second++) {
      run(world, 1);
      fieldHits.push(hits());
    }
    expect(fieldHits.filter((count) => count > 0).length).toBeGreaterThanOrEqual(3);
    expect(world.fields).toHaveLength(0);
  });

  it('法修和御灵修士 20 级各有一门地面功法，快捷栏放得下', () => {
    const fields = Object.values(config.skills).filter((skill) => skill.effect.type === 'field' && !skill.replaces);
    expect(fields.map((skill) => skill.classId).sort()).toEqual(['spell', 'spirit']);
    for (const skill of fields) expect(skill.level).toBe(20);
  });

  it('撼山冲闪到目标身边打一击并定身', () => {
    const world = new World(config, 'taina-mountain', 'body', 1);
    world.player.skills.push('body-charge');
    world.player.mp = world.player.stats.maxMp;
    world.player.auto.enabled = false;
    const ape = world.monsters.find((monster) => monster.def.id === 'mountain-ape')!;
    world.player.cell = { x: ape.cell.x - 3, y: ape.cell.y };
    world.player.pos = { ...world.player.cell };
    ape.stats = { ...ape.stats, maxHp: 100000 };
    ape.hp = 100000;
    world.drainEvents();
    world.castSkill('body-charge', ape);
    run(world, 0.3);
    expect(cellDistance(world.player.cell, ape.cell)).toBe(1);
    const events = world.drainEvents();
    expect(events.some((event) => event.type === 'stunned' && event.unit === ape)).toBe(true);
    expect(ape.stunLeft).toBeGreaterThan(1);
  });

  it('体修 20 级有招牌功法撼山冲', () => {
    const charge = config.skills['body-charge']!;
    expect(charge.classId).toBe('body');
    expect(charge.level).toBe(20);
    expect(config.items['book-body-charge']?.skill).toBe('body-charge');
  });
});

describe('Boss 掉落', () => {
  const kill = (world: World, monster: unknown) =>
    (world as unknown as { killMonster(monster: unknown): void }).killMonster(monster);

  it('每个 Boss 都有一件专属法器', () => {
    const bosses = Object.values(config.monsters).filter((monster) => monster.boss);
    for (const boss of bosses) {
      const own = Object.values(config.items).filter((item) => item.boss === boss.id);
      expect(own, boss.id).toHaveLength(1);
    }
  });

  it('首杀必掉专属法器，Boss 掉的法器至少是中品，击杀次数进存档', () => {
    const world = new World(config, 'taina-mountain', 'body', 1);
    const serpent = world.monsters.find((monster) => monster.def.id === 'flood-serpent')!;
    kill(world, serpent);
    const drops = world.items.filter((item) => item.equipment);
    expect(drops.some((item) => item.def.id === 'boss-serpent-armor')).toBe(true);
    for (const item of drops) expect(item.equipment!.grade).not.toBe('low');
    expect(world.toSave(0).player.kills).toEqual({ 'flood-serpent': 1 });

    const again = World.fromSave(config, world.toSave(0), 2);
    expect(again.player.kills['flood-serpent']).toBe(1);
    let signature = 0;
    for (let i = 0; i < 40; i++) {
      again.items.length = 0;
      kill(again, again.monsters.find((monster) => monster.def.id === 'flood-serpent')!);
      signature += again.items.filter((item) => item.def.id === 'boss-serpent-armor').length;
    }
    expect(signature).toBeLessThan(15);
  });
});

describe('Boss 仇恨', () => {
  it('召唤物打 Boss 时，Boss 仍然追玩家；小怪会被召唤物拉走', () => {
    const world = new World(config, 'taina-mountain', 'spirit', 1);
    world.player.skills.push('spirit-summon');
    world.player.mp = world.player.stats.maxMp;
    world.castSkill('spirit-summon');
    run(world, 0.6);
    const [summon] = world.summons;
    expect(summon).toBeDefined();
    const boss = world.monsters.find((monster) => monster.def.id === 'flood-serpent')!;
    const ape = world.monsters.find((monster) => monster.def.id === 'mountain-ape')!;
    const hit = (monster: typeof boss) =>
      (world as unknown as { dealDamage(source: unknown, target: unknown, amount: number, max: boolean): void })
        .dealDamage(summon, monster, 1, false);
    hit(boss);
    hit(ape);
    expect(boss.target).toBe(world.player);
    expect(ape.target).toBe(summon);
  });
});

describe('怪物种类', () => {
  const fight = (monsterId: string) => {
    const setup = structuredClone(config);
    setup.maps['starter-field']!.spawns = [{ monster: monsterId, x: 16, y: 12 }];
    setup.maps['starter-field']!.portals = [];
    const world = new World(setup, 'starter-field', 'body', 2);
    const { player } = world;
    player.stats = { ...player.stats, maxHp: 900, evasion: 0 };
    player.hp = 900;
    return { world, player, monster: world.monsters[0]! };
  };

  it('远程怪站在原地射击', () => {
    const { world, player, monster } = fight('thorn-sprite');
    run(world, 6, () => player.hp < 900);
    expect(player.hp).toBeLessThan(900);
    expect(cellDistance(monster.cell, player.cell)).toBeGreaterThan(1);
  });

  it('放毒的怪让玩家持续掉血', () => {
    const { world, player } = fight('venom-spider');
    run(world, 6, () => player.effects.some((effect) => effect.kind === 'dot'));
    expect(player.effects.map((effect) => effect.kind)).toContain('dot');
    const before = player.hp;
    run(world, 2.5);
    expect(player.hp).toBeLessThan(before);
  });

  it('冲锋的怪瞬间贴到身边', () => {
    const { world, player, monster } = fight('wolf-rider');
    monster.cell = { x: player.cell.x + 5, y: player.cell.y };
    monster.pos = { ...monster.cell };
    monster.home = { ...monster.cell };
    run(world, 4, () => Math.abs(monster.cell.x - player.cell.x) <= 1 && player.hp < 900);
    expect(Math.abs(monster.cell.x - player.cell.x)).toBeLessThanOrEqual(1);
    expect(player.hp).toBeLessThan(900);
  });

  it('召唤怪叫小怪，小怪有上限且死后不重生', () => {
    const { world, player, monster } = fight('ape-shaman');
    run(world, 3, () => world.monsters.length > 1);
    expect(world.monsters).toHaveLength(3);
    run(world, 20);
    expect(world.monsters.filter((candidate) => candidate.temporary).length).toBeLessThanOrEqual(2);
    const minion = world.monsters.find((candidate) => candidate.temporary)!;
    player.stats = { ...player.stats, attack: { min: 999, max: 999 }, accuracy: 1e9 };
    minion.stats = { ...minion.stats, defense: { min: 0, max: 0 } };
    monster.stats = { ...monster.stats, defense: { min: 0, max: 0 } };
    world.attack(minion);
    run(world, 8, () => !world.monsters.includes(minion));
    expect(world.monsters).not.toContain(minion);
  });
});

describe('特殊法宝', () => {
  const ring = (itemId: string) => ({ uid: 700, itemId, grade: 'low', affixes: [], luck: 0 });
  const fightSetup = (itemId: string) => {
    const world = new World(config, 'starter-field', 'body', 1);
    world.player.equipment.ringLeft = ring(itemId);
    return { world, player: world.player, monster: world.monsters[0]! };
  };
  const hit = (world: World, source: unknown, target: unknown, amount: number) =>
    (world as unknown as { dealDamage(a: unknown, b: unknown, c: number, d: boolean): void }).dealDamage(source, target, amount, false);

  it('定身戒让怪物停止行动', () => {
    const { world, player, monster } = fightSetup('stun-ring');
    player.stats = { ...player.stats, accuracy: 1e9, attack: { min: 1, max: 1 } };
    monster.stats = { ...monster.stats, maxHp: 1e6 };
    monster.hp = 1e6;
    const c = { x: player.cell.x + 1, y: player.cell.y };
    monster.cell = { ...c };
    monster.pos = { ...c };
    monster.home = { ...c };
    world.attack(monster);
    run(world, 60, () => monster.stunLeft > 0);
    expect(monster.stunLeft).toBeGreaterThan(0);
  });

  it('被定身的怪不攻击', () => {
    const { world, player, monster } = fightSetup('stun-ring');
    const c = { x: player.cell.x + 1, y: player.cell.y };
    monster.cell = { ...c };
    monster.pos = { ...c };
    monster.home = { ...c };
    monster.stunLeft = 5;
    const hp = player.hp;
    run(world, 2);
    expect(player.hp).toBe(hp);
  });

  it('涅槃戒复活一次，冷却内再死就真死', () => {
    const { world, player, monster } = fightSetup('revive-ring');
    hit(world, monster, player, 9999);
    expect(player.hp).toBe(Math.ceil(player.stats.maxHp * 0.3));
    hit(world, monster, player, 9999);
    expect(player.hp).toBe(0);
  });

  it('护身戒用灵力分担伤害', () => {
    const { world, player, monster } = fightSetup('guard-ring');
    const { hp, mp } = player;
    hit(world, monster, player, 10);
    expect(player.mp).toBe(mp - 3);
    expect(player.hp).toBe(hp - 7);
  });

  it('遁光戒随机传送并进入冷却', () => {
    const { world, player } = fightSetup('blink-ring');
    const start = { ...player.cell };
    world.useTeleportRing();
    expect(player.cell).not.toEqual(start);
    const landed = { ...player.cell };
    world.useTeleportRing();
    expect(player.cell).toEqual(landed);
  });
});

describe('套装', () => {
  it('凑齐件数时属性生效，脱下后消失', () => {
    const world = new World(config, 'huangfeng-valley', 'body', 1);
    const { player } = world;
    player.level = 14;
    const piece = (uid: number, itemId: string) => {
      player.equipBag.push({ uid, itemId, grade: 'low', affixes: [], luck: 0 });
      world.inventory.equip(uid);
    };
    piece(1, 'sword-14');
    const one = player.stats.maxHp;
    piece(2, 'crown-14');
    expect(player.stats.maxHp).toBe(one + 40);
    world.inventory.unequip('helmet');
    expect(player.stats.maxHp).toBe(one);
  });
});

describe('功法修炼', () => {
  it('消耗残卷和灵石提高威力，有上限', () => {
    const world = new World(config, 'huangfeng-valley', 'body', 1);
    const { player, inventory } = world;
    player.gold = 9999;
    player.bag['skill-tome'] = 5;
    inventory.upgradeSkill('body-smash');
    expect(player.skillLevels['body-smash']).toBe(2);
    expect(inventory.skillPower('body-smash')).toBeCloseTo(1.15);
    inventory.upgradeSkill('body-smash');
    inventory.upgradeSkill('body-smash');
    expect(player.skillLevels['body-smash']).toBe(3);
    expect(player.bag['skill-tome']).toBe(3);
  });

  it('没学会的功法不能修炼，修炼等级写入存档', () => {
    const world = new World(config, 'huangfeng-valley', 'body', 1);
    const { player, inventory } = world;
    player.gold = 9999;
    player.bag['skill-tome'] = 5;
    inventory.upgradeSkill('body-whirl');
    expect(player.skillLevels['body-whirl']).toBeUndefined();
    inventory.upgradeSkill('body-smash');
    expect(World.fromSave(config, world.toSave(1), 2).player.skillLevels['body-smash']).toBe(2);
  });
});

describe('符、仓库、批量卖出', () => {
  it('回城符回到主城，随机传送符留在本图', () => {
    const world = new World(config, 'starter-field', 'body', 1);
    world.player.bag['random-scroll'] = 1;
    world.player.bag['recall-scroll'] = 1;
    const start = { ...world.player.cell };
    world.inventory.useItem('random-scroll');
    expect(world.mapId).toBe('starter-field');
    expect(world.player.cell).not.toEqual(start);
    world.inventory.useItem('recall-scroll');
    expect(world.mapId).toBe('qixuan-gate');
    expect(world.player.bag).toEqual({});
  });

  it('仓库存取，写入存档，离开后不能操作', () => {
    const world = town();
    standBy(world, 'vault-keeper');
    const keeper = npc('vault-keeper');
    world.player.equipBag.push({ uid: 900, itemId: 'cloth-robe', grade: 'top', affixes: [], luck: 0 });
    world.deposit(keeper, 900);
    expect(world.player.equipBag).toEqual([]);
    expect(world.player.storage).toHaveLength(1);
    expect(World.fromSave(config, world.toSave(1), 2).player.storage[0]?.uid).toBe(900);
    world.withdraw(keeper, 900);
    expect(world.player.equipBag).toHaveLength(1);
    world.moveTo({ x: 20, y: 20 });
    run(world, 15, () => world.player.order === null);
    world.deposit(keeper, 900);
    expect(world.player.storage).toEqual([]);
  });

  it('批量卖出不高于指定品阶的法器', () => {
    const world = town();
    standBy(world, 'herb-keeper');
    const item = (uid: number, grade: string) => ({ uid, itemId: 'cloth-robe', grade, affixes: [], luck: 0 });
    world.player.equipBag.push(item(1, 'low'), item(2, 'mid'), item(3, 'high'), item(4, 'top'));
    world.sellAllUpToGrade(npc('herb-keeper'), 'mid');
    expect(world.player.equipBag.map((equipment) => equipment.uid)).toEqual([3, 4]);
    expect(world.player.gold).toBe(18 + 36);
  });
});

describe('Boss 刷新提示', () => {
  it('在别的地图也能收到提示，只提示一次', () => {
    const world = town();
    const serpent = config.maps['taina-mountain']!.spawns.findIndex((spawn) => spawn.monster === 'flood-serpent');
    world.bossReadyAt[`taina-mountain:${serpent}`] = world.time + 1;
    const events: GameEvent[] = [];
    run(world, 3, () => {
      events.push(...world.drainEvents());
      return false;
    });
    const notices = events.filter((event) => event.type === 'bossReady');
    expect(notices).toEqual([{ type: 'bossReady', name: '铁甲蛟', mapName: '太南山' }]);
  });
});

describe('自动寻路', () => {
  it('跨两张地图走到目的地', () => {
    const world = town();
    world.navigate({ mapId: 'taina-mountain', cell: { x: 13, y: 13 } });
    run(world, 120, () => world.player.route === null && world.player.order === null);
    expect(world.mapId).toBe('taina-mountain');
    expect(world.player.cell).toEqual({ x: 13, y: 13 });
  });

  it('到达后自动和 NPC 对话', () => {
    const world = passChapterOne(new World(config, 'starter-field', 'body', 1));
    for (const monster of world.monsters) monster.def = { ...monster.def, aggroRange: 0 };
    const guide = npc('guide-senior');
    world.navigate({ mapId: guide.map, cell: guide, npc: guide });
    const events: GameEvent[] = [];
    run(world, 40, () => {
      events.push(...world.drainEvents());
      return events.some((event) => event.type === 'npcOpened');
    });
    expect(events).toContainEqual({ type: 'npcOpened', npc: guide });
  });

  it('手动移动会取消寻路', () => {
    const world = town();
    world.navigate({ mapId: 'starter-field', cell: { x: 6, y: 6 } });
    world.moveTo({ x: 13, y: 14 });
    expect(world.player.route).toBeNull();
  });

  it('任务目的地：击杀去刷怪点，收集去掉落地图，完成后回 NPC', () => {
    const world = town();
    world.player.level = 3;
    world.player.quests.completed.push('ch1-enter', 'join-sect');
    world.acceptQuest('ch1-herbs');
    world.acceptQuest('ape-fur');
    expect(questDestination(world, config.quests['ch1-herbs']!, world.player)?.mapId).toBe('starter-field');
    expect(questDestination(world, config.quests['ape-fur']!, world.player)?.mapId).toBe('taina-mountain');
    world.player.bag['ape-fur'] = 3;
    expect(questDestination(world, config.quests['ape-fur']!, world.player)?.npc?.id).toBe('herb-keeper');
  });

  const herbQuest = () => {
    const world = town();
    world.player.level = 3;
    world.player.quests.completed.push('ch1-enter', 'join-sect');
    world.acceptQuest('ch1-herbs');
    return { world, target: questDestination(world, config.quests['ch1-herbs']!, world.player)! };
  };

  it('寻路能经过传送 NPC，跨章节回到早期地图', () => {
    const world = new World(config, 'cangl-tribe', 'body', 1);
    world.player.level = 45;
    world.player.gold = 5000;
    world.player.quests.completed.push('ch4-abandon', 'ch5-return', 'ch6-invite');
    world.navigate({ mapId: 'starter-field', cell: { x: 10, y: 10 } });
    const visited = new Set<string>();
    run(world, 600, () => {
      visited.add(world.mapId);
      return world.mapId === 'starter-field';
    });
    expect(world.mapId).toBe('starter-field');
    expect([...visited]).toEqual(expect.arrayContaining(['luoyun-sect', 'tianxing-city', 'huangfeng-valley']));
  });

  it('付不起传送费就停下寻路', () => {
    const world = new World(config, 'tianxing-city', 'body', 1);
    world.player.gold = 0;
    world.navigate({ mapId: 'huangfeng-valley', cell: { x: 10, y: 10 } });
    run(world, 60, () => world.player.route === null);
    expect(world.player.route).toBeNull();
    expect(world.mapId).toBe('tianxing-city');
  });

  it('点任务寻路立刻放下正在打的怪', () => {
    const world = new World(config, 'starter-field', 'body', 1);
    world.attack(world.monsters[0]!);
    world.navigate({ mapId: 'qixuan-gate', cell: { x: 5, y: 5 } });
    expect(world.player.order?.type).toBe('move');
    expect(world.player.route?.mapId).toBe('qixuan-gate');
  });

  it('寻路到刷怪地图后自动挂机，优先打任务要的怪', () => {
    const { world, target } = herbQuest();
    expect(target.hunt).toBeDefined();
    world.player.auto.enabled = false;
    world.navigate(target);
    run(world, 300, () => world.mapId === target.mapId && world.player.route === null);
    expect(world.mapId).toBe(target.mapId);
    expect(world.player.auto.enabled).toBe(true);
    expect(world.autoPlay.hunt).toBe(target.hunt);
  });

  it('飞行靴直接飞到任务目的地并开始挂机，没有靴子就不动', () => {
    const { world, target } = herbQuest();
    world.player.bag['flying-boots'] = 0;
    world.flyTo(target);
    expect(world.mapId).toBe('huangfeng-valley');
    world.player.bag['flying-boots'] = 2;
    world.flyTo(target);
    expect(world.mapId).toBe(target.mapId);
    expect(world.player.bag['flying-boots']).toBe(1);
    expect(world.player.auto.enabled).toBe(true);
    expect(cellDistance(world.player.cell, target.cell)).toBeLessThanOrEqual(3);
  });

  it('任务完成后飞行靴飞回交任务的 NPC 并对话', () => {
    const world = new World(config, 'starter-field', 'body', 1);
    world.player.bag['flying-boots'] = 1;
    const npc = config.npcs[config.quests['ch1-enter']!.giver]!;
    world.flyTo({ mapId: npc.map, cell: { x: npc.x, y: npc.y }, npc });
    expect(world.mapId).toBe(npc.map);
    expect(world.player.order).toMatchObject({ type: 'talk', npc });
  });

  it('所有怪都有 1% 掉飞行靴，前期任务也送', () => {
    for (const monster of Object.values(config.monsters)) {
      expect(monsterDrops(config, monster)).toContainEqual({ item: 'flying-boots', chance: 0.01 });
    }
    const gifts = Object.values(config.quests)
      .flatMap((quest) => quest.rewards.items)
      .filter((reward) => reward.item === 'flying-boots')
      .reduce((sum, reward) => sum + reward.count, 0);
    expect(gifts).toBeGreaterThanOrEqual(10);
  });
});

describe('丢弃物品', () => {
  it('整叠丹药丢到脚边，不会被自动吸回', () => {
    const world = new World(config, 'starter-field', 'body', 1);
    world.player.bag['small-potion'] = 5;
    world.discardStack('small-potion');
    expect(world.player.bag['small-potion']).toBeUndefined();
    expect(world.items.find((item) => item.def.id === 'small-potion')).toMatchObject({ amount: 5, discarded: true });
    run(world, 2);
    expect(world.player.bag['small-potion']).toBeUndefined();
  });

  it('整理背包：丹药在材料前，法器按栏位和等级排', () => {
    const world = new World(config, 'starter-field', 'body', 1);
    world.player.equipBag.length = 0;
    world.player.bag = { 'ape-fur': 2, 'small-potion': 3, 'recall-scroll': 1 };
    const add = (uid: number, itemId: string) =>
      world.player.equipBag.push({ uid, itemId, grade: 'low', affixes: [], luck: 0 } as Equipment);
    add(1, 'ring-14');
    add(2, 'sword-14');
    add(3, 'sword-27');
    world.inventory.sortBag();
    expect(Object.keys(world.player.bag)).toEqual(['small-potion', 'recall-scroll', 'ape-fur']);
    expect(world.player.equipBag.map((equipment) => equipment.itemId)).toEqual(['sword-27', 'sword-14', 'ring-14']);
  });

  it('丹药只能拖进快捷栏最后两格', () => {
    const world = new World(config, 'starter-field', 'body', 1);
    world.setHotbarItem(0, 'mid-potion');
    expect(world.player.hotbar[0]?.kind).not.toBe('item');
    world.setHotbarItem(7, 'mid-potion');
    expect(world.player.hotbar[7]).toEqual({ kind: 'item', id: 'mid-potion' });
    world.setHotbarItem(8, 'flying-boots');
    expect(world.player.hotbar[8]?.id).not.toBe('flying-boots');
  });

  it('绑定物品和 Boss 专属法器丢不掉', () => {
    const world = new World(config, 'starter-field', 'body', 1);
    world.player.bag['fengjia-key'] = 1;
    world.discardStack('fengjia-key');
    expect(world.player.bag['fengjia-key']).toBe(1);
    const boss = Object.values(config.items).find((item) => item.boss)!;
    world.player.equipBag.push({ uid: 900, itemId: boss.id, grade: 'low', affixes: [], luck: 0 } as Equipment);
    world.discard(900);
    expect(world.player.equipBag.some((equipment) => equipment.uid === 900)).toBe(true);
  });
});


describe('章节主线', () => {
  const finish = (world: World, questId: string) => {
    expect(status(world, questId), questId).toBe('available');
    world.acceptQuest(questId);
    const quest = config.quests[questId]!;
    const progress = world.player.quests.active.find((active) => active.id === questId)!;
    progress.counts = quest.objectives.map((objective) => objective.count);
    world.turnInQuest(questId);
    expect(status(world, questId), questId).toBe('done');
  };
  const CHAPTER_ONE = ['ch1-enter', 'ch1-herbs', 'ch1-spider', 'ch1-friend', 'ch1-wolves', 'ch1-report', 'ch1-boss'];

  it('开局在七玄门，按章节解锁太南山和黄枫谷', () => {
    expect(config.game.startMap).toBe('qixuan-gate');
    const world = new World(config, 'starter-field', 'body', 1);
    const requires = (name: string) => world.portals.find((portal) => portal.name === name)?.requires;
    expect(requires('太南山')).toBe('ch1-boss');
    expect(requires('黄枫谷')).toBe('ch2-token');
    expect(status(world, 'join-sect')).toBe('locked');
  });

  it('第 1 章结束升到 7 级，带着升仙令到太南山', () => {
    const world = new World(config, 'qixuan-gate', 'body', 1);
    for (const questId of CHAPTER_ONE) finish(world, questId);
    expect(world.player.level).toBe(7);
    expect(world.player.bag['ascension-token']).toBe(1);
    expect(world.mapId).toBe('taina-mountain');
    expect(status(world, 'ch2-road')).toBe('available');
  });

  it('第 2 章结束升到 11 级，交出升仙令换筑基丹，到黄枫谷', () => {
    const world = new World(config, 'qixuan-gate', 'body', 1);
    for (const questId of CHAPTER_ONE) finish(world, questId);
    expect(world.npcs.map((npc) => npc.id)).toContain('wan-xiaoshan');
    finish(world, 'ch2-road');
    finish(world, 'ch2-enter');
    expect(world.mapId).toBe('taina-valley');

    finish(world, 'ch2-market');
    world.player.bag['ape-fur'] = 4;
    finish(world, 'ch2-brush');
    expect(world.player.bag['ape-fur']).toBeUndefined();
    expect(world.player.bag['jinzhu-brush']).toBe(1);
    finish(world, 'ch2-watch');
    finish(world, 'ch2-signup');
    finish(world, 'ch2-arena');
    finish(world, 'ch2-token');

    expect(world.player.level).toBe(11);
    expect(world.player.bag['ascension-token']).toBeUndefined();
    expect(world.player.bag['foundation-pill']).toBe(1);
    expect(world.mapId).toBe('huangfeng-valley');
    expect(status(world, 'join-sect')).toBe('available');
  });

  it('野外地图的复活点都在有商店的安全地图', () => {
    const shopMaps = new Set(Object.values(config.npcs).filter((npc) => npc.shop).map((npc) => npc.map));
    for (const map of Object.values(config.maps)) {
      if (map.safe) continue;
      expect(config.maps[map.respawn!.map]?.safe, map.id).toBe(true);
      expect(shopMaps.has(map.respawn!.map), map.id).toBe(true);
    }
  });

  it('七派执事离擂台足够远，报名时不会惊动青纹道人', () => {
    const judge = config.npcs['sect-judge']!;
    const boss = config.maps['taina-mountain']!.spawns.find((spawn) => spawn.monster === 'qingwen-daoren')!;
    const talkRange = 2;
    expect(Math.hypot(judge.x - boss.x, judge.y - boss.y) - talkRange).toBeGreaterThan(
      config.monsters['qingwen-daoren']!.aggroRange,
    );
  });

  it('第 3 章：禁地取药、斩墨蛟、拜入李门，筑基材料齐全', () => {
    const world = passChapterOne(new World(config, 'huangfeng-valley', 'body', 1));
    while (world.player.level < 11) {
      world.player.exp = world.expToNext!;
      (world as unknown as { gainExp(amount: number): void }).gainExp(0);
    }
    world.player.bag['foundation-pill'] = 1;
    finish(world, 'join-sect');
    finish(world, 'ch3-trial');
    expect(world.mapId).toBe('blood-forbidden');
    for (const questId of ['ch3-spider', 'ch3-snake', 'ch3-rival', 'ch3-fengyue']) finish(world, questId);
    expect(world.npcs.map((npc) => npc.id)).toContain('nangong-wan');
    finish(world, 'ch3-serpent');
    expect(world.mapId).toBe('huangfeng-valley');
    Object.assign(world.player.bag, { 'jade-marrow': 3, 'purple-monkey': 3, 'sky-fruit': 2, 'serpent-scale': 3 });
    finish(world, 'ch3-master');
    expect(world.player.level).toBe(13);
    expect(world.player.bag['foundation-pill']).toBe(2);
    expect(world.player.bag['jade-marrow']).toBeUndefined();
    const realm = config.realms[0]!.breakthrough!;
    for (const { item, count } of realm.requires) {
      expect(world.player.bag[item] ?? 0, item).toBeGreaterThanOrEqual(count);
    }
  });

  it('禁地里的灵药有怪物会掉，南宫婉不会惊动墨蛟', () => {
    for (const herb of ['jade-marrow', 'purple-monkey', 'sky-fruit']) {
      expect(Object.values(config.drops).some((table) => table.some((entry) => entry.item === herb)), herb).toBe(true);
    }
    const nangong = config.npcs['nangong-wan']!;
    const boss = config.maps['blood-forbidden']!.spawns.find((spawn) => spawn.monster === 'mo-jiao')!;
    expect(Math.hypot(nangong.x - boss.x, nangong.y - boss.y) - 2).toBeGreaterThan(config.monsters['mo-jiao']!.aggroRange);
  });

  it('第 4 章：燕翎堡、灵矿、金鼓原，拿到大挪移令后被当作弃子', () => {
    const world = passChapterOne(new World(config, 'huangfeng-valley', 'body', 1));
    world.player.quests.completed.push('join-sect', 'ch3-master');
    world.player.realmPassed.push('qi');
    const reach = (level: number) => {
      while (world.player.level < level) {
        world.player.exp = world.expToNext!;
        (world as unknown as { gainExp(amount: number): void }).gainExp(0);
      }
    };
    const steps: [string, string?][] = [
      ['ch4-invite', 'yanling-fort'],
      ['ch4-souls'],
      ['ch4-wedding'],
      ['ch4-breakout'],
      ['ch4-wangchan', 'huangfeng-valley'],
      ['ch4-mine', 'spirit-mine'],
      ['ch4-corpse'],
      ['ch4-raid'],
      ['ch4-deep'],
      ['ch4-array', 'jingu-plain'],
      ['ch4-front'],
      ['ch4-toads'],
      ['ch4-night'],
      ['ch4-commander'],
      ['ch4-abandon', 'tianxing-city'],
    ];
    for (const [questId, mapId] of steps) {
      reach(config.quests[questId]!.level);
      if (questId === 'ch4-array') world.player.bag['great-transfer-token'] = 1;
      finish(world, questId);
      if (mapId) expect(world.mapId, questId).toBe(mapId);
    }
    expect(world.player.bag['great-transfer-token']).toBe(1);
    expect(world.npcs.map((npc) => npc.id)).toContain('star-steward');
  });

  it('第 5 章：外星海猎妖，随乌丑进虚天殿，夺得虚天鼎后拿到定灵丹', () => {
    const world = new World(config, 'tianxing-city', 'body', 1);
    world.player.quests.completed.push('ch4-abandon');
    world.player.realmPassed.push('qi', 'foundation');
    const reach = (level: number) => {
      while (world.player.level < level) {
        world.player.exp = world.expToNext!;
        (world as unknown as { gainExp(amount: number): void }).gainExp(0);
      }
    };
    const portal = (name: string) => world.portals.find((candidate) => candidate.name === name)!;
    expect(portal('外星海').requires).toBe('ch5-arrive');
    expect(portal('虚天殿').requires).toBe('ch5-map');
    const steps: [string, string?][] = [
      ['ch5-arrive'],
      ['ch5-squid'],
      ['ch5-fish'],
      ['ch5-ray'],
      ['ch5-seaking'],
      ['ch5-map', 'xutian-mist'],
      ['ch5-mist'],
      ['ch5-skull'],
      ['ch5-meet'],
      ['ch5-puppets'],
      ['ch5-seekers'],
      ['ch5-jiyin'],
      ['ch5-demons'],
      ['ch5-shadows'],
      ['ch5-cauldron', 'tianxing-city'],
      ['ch5-return', 'luoyun-sect'],
    ];
    for (const [questId, mapId] of steps) {
      reach(config.quests[questId]!.level);
      if (questId === 'ch5-cauldron') world.player.bag['xutian-cauldron'] = 1;
      finish(world, questId);
      if (mapId) expect(world.mapId, questId).toBe(mapId);
      if (questId === 'ch5-arrive') expect(world.player.bag['core-pill']).toBe(1);
    }
    expect(world.player.bag['xutian-cauldron']).toBe(1);
    expect(world.player.bag['nascent-pill']).toBe(1);
  });

  it('虚天殿三层按任务解锁，第 5 章经验约四成来自任务，Boss 离 NPC 足够远', () => {
    expect(config.maps['xutian-mist']!.portals!.find((portal) => portal.toMap === 'xutian-hall')!.requires).toBe('ch5-skull');
    expect(config.maps['xutian-hall']!.portals!.find((portal) => portal.toMap === 'xutian-core')!.requires).toBe('ch5-jiyin');
    const levels = config.levels.expToNext.slice(25, 33).reduce((sum, exp) => sum + exp, 0);
    const quests = Object.values(config.quests)
      .filter((quest) => quest.id.startsWith('ch5'))
      .reduce((sum, quest) => sum + quest.rewards.exp, 0);
    expect(quests / levels).toBeGreaterThan(0.3);
    expect(quests / levels).toBeLessThan(0.5);
    for (const [mapId, bossId] of [
      ['outer-sea', 'sea-king'],
      ['xutian-hall', 'jiyin'],
      ['xutian-core', 'xuangu'],
    ] as const) {
      const boss = config.maps[mapId]!.spawns.find((spawn) => spawn.monster === bossId)!;
      for (const npc of Object.values(config.npcs).filter((candidate) => candidate.map === mapId)) {
        expect(Math.hypot(npc.x - boss.x, npc.y - boss.y) - 2, npc.id).toBeGreaterThan(config.monsters[bossId]!.aggroRange);
      }
    }
  });

  it('第 4 章的经验大约四成来自任务，Boss 都离 NPC 足够远', () => {
    const levels = config.levels.expToNext.slice(13, 25).reduce((sum, exp) => sum + exp, 0);
    const quests = Object.values(config.quests)
      .filter((quest) => quest.id.startsWith('ch4'))
      .reduce((sum, quest) => sum + quest.rewards.exp, 0);
    expect(quests / levels).toBeGreaterThan(0.3);
    expect(quests / levels).toBeLessThan(0.5);
    for (const [mapId, bossId] of [
      ['yanling-fort', 'wang-chan'],
      ['spirit-mine', 'blood-guardian'],
      ['jingu-plain', 'demon-commander'],
    ] as const) {
      const boss = config.maps[mapId]!.spawns.find((spawn) => spawn.monster === bossId)!;
      for (const npc of Object.values(config.npcs).filter((candidate) => candidate.map === mapId)) {
        expect(Math.hypot(npc.x - boss.x, npc.y - boss.y) - 2, npc.id).toBeGreaterThan(config.monsters[bossId]!.aggroRange);
      }
    }
  });

  it('第 6 章：随南陇侯入坠魔谷，古魔夺舍，斩魔后回落云宗', () => {
    const world = new World(config, 'luoyun-sect', 'body', 1);
    world.player.quests.completed.push('ch5-return');
    world.player.realmPassed.push('qi', 'foundation', 'core');
    const reach = (level: number) => {
      while (world.player.level < level) {
        world.player.exp = world.expToNext!;
        (world as unknown as { gainExp(amount: number): void }).gainExp(0);
      }
    };
    expect(world.portals.find((portal) => portal.name === '坠魔谷')!.requires).toBe('ch6-invite');
    const steps: [string, string?][] = [
      ['ch6-arrive'],
      ['ch6-invite', 'zhuomo-outer'],
      ['ch6-beasts'],
      ['ch6-wraiths'],
      ['ch6-warden'],
      ['ch6-meet-lu'],
      ['ch6-apes'],
      ['ch6-spirits'],
      ['ch6-cultists'],
      ['ch6-gate', 'blood-gate'],
      ['ch6-shades'],
      ['ch6-nanlong', 'luoyun-sect'],
      ['ch6-ending'],
    ];
    for (const [questId, mapId] of steps) {
      reach(config.quests[questId]!.level);
      finish(world, questId);
      if (mapId) expect(world.mapId, questId).toBe(mapId);
    }
    expect(world.npcs.map((npc) => npc.id)).not.toContain('nanlong-hou');
  });

  it('坠魔谷三张图按任务解锁，第 6 章经验约四成来自任务，Boss 离 NPC 足够远', () => {
    expect(config.maps['zhuomo-outer']!.portals!.find((portal) => portal.toMap === 'zhuomo-inner')!.requires).toBe('ch6-warden');
    expect(config.maps['zhuomo-inner']!.portals!.find((portal) => portal.toMap === 'blood-gate')!.requires).toBe('ch6-gate');
    const levels = config.levels.expToNext.slice(33, 39).reduce((sum, exp) => sum + exp, 0);
    const quests = Object.values(config.quests)
      .filter((quest) => quest.id.startsWith('ch6'))
      .reduce((sum, quest) => sum + quest.rewards.exp, 0);
    expect(quests / levels).toBeGreaterThan(0.3);
    expect(quests / levels).toBeLessThan(0.5);
    for (const [mapId, bossId] of [
      ['zhuomo-outer', 'valley-warden'],
      ['blood-gate', 'demon-nanlong'],
    ] as const) {
      const boss = config.maps[mapId]!.spawns.find((spawn) => spawn.monster === bossId)!;
      for (const npc of Object.values(config.npcs).filter((candidate) => candidate.map === mapId)) {
        expect(Math.hypot(npc.x - boss.x, npc.y - boss.y) - 2, npc.id).toBeGreaterThan(config.monsters[bossId]!.aggroRange);
      }
    }
  });

  it('万小山带路后离开，太南谷的传送点要先过第二个任务', () => {
    const world = new World(config, 'taina-mountain', 'body', 1);
    const valley = world.portals.find((portal) => portal.name === '太南谷')!;
    expect(valley.requires).toBe('ch2-enter');
    world.player.quests.completed.push('ch2-enter');
    expect(world.npcs.map((npc) => npc.id)).not.toContain('wan-xiaoshan');
    expect(world.npcs.map((npc) => npc.id)).toContain('sect-judge');
  });
});

describe('支线任务', () => {
  const side = Object.values(config.quests).filter((quest) => !quest.main);

  it('每章都有支线，发布者、前置和目标都对得上', () => {
    expect(side.length).toBeGreaterThanOrEqual(18);
    const spawned = new Set(Object.values(config.maps).flatMap((map) => map.spawns.map((spawn) => spawn.monster)));
    for (const quest of side) {
      expect(config.npcs[quest.giver], quest.id).toBeDefined();
      if (quest.prev) expect(config.quests[quest.prev], quest.id).toBeDefined();
      for (const objective of quest.objectives) {
        if (objective.type === 'kill') expect(spawned.has(objective.target), quest.id).toBe(true);
        if (objective.type === 'collect') {
          const droppers = Object.values(config.monsters).filter(
            (monster) =>
              spawned.has(monster.id) &&
              monsterDrops(config, monster).some((entry) => entry.item === objective.target),
          );
          expect(droppers.length, quest.id).toBeGreaterThan(0);
        }
      }
      expect(config.dialogues[quest.offer], quest.id).toBeDefined();
      expect(config.dialogues[quest.finish], quest.id).toBeDefined();
    }
    for (const chapter of ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6']) {
      const count = side.filter((quest) => quest.prev?.startsWith(chapter) || quest.id.startsWith(`side-${chapter}`)).length;
      expect(count, chapter).toBeGreaterThanOrEqual(2);
    }
  });

  it('支线经验不超过同章主线的三成', () => {
    for (const chapter of ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6']) {
      const main = Object.values(config.quests)
        .filter((quest) => quest.id.startsWith(chapter))
        .reduce((sum, quest) => sum + quest.rewards.exp, 0);
      const extra = side
        .filter((quest) => quest.id.startsWith(`side-${chapter}`))
        .reduce((sum, quest) => sum + quest.rewards.exp, 0);
      expect(extra / main, chapter).toBeLessThan(0.3);
    }
  });
});

describe('图鉴和成就', () => {
  it('全收集类成就的目标数和实际内容一致', () => {
    const goal = (id: string) => {
      const condition = config.achievements[id]!.condition;
      return 'count' in condition ? condition.count : 0;
    };
    expect(goal('codex-all')).toBe(Object.values(config.items).filter((item) => item.kind === 'equip').length);
    expect(goal('boss-all')).toBe(Object.values(config.monsters).filter((monster) => monster.boss).length);
    expect(goal('side-all')).toBe(Object.values(config.quests).filter((quest) => !quest.main).length);
  });

  it('击败妖兽记进图鉴，达成成就发奖励，进度随存档保留', () => {
    const world = new World(config, 'taina-mountain', 'body', 1);
    const ape = world.monsters.find((monster) => monster.def.id === 'mountain-ape')!;
    (world as unknown as { killMonster(monster: unknown): void }).killMonster(ape);
    world.player.equipBag.push({ uid: 9999, itemId: 'rusty-sword', grade: 'mid', affixes: [], luck: 0 });
    const gold = world.player.gold;
    world.drainEvents();
    world.checkAchievements();
    expect(world.player.kills['mountain-ape']).toBe(1);
    expect(world.player.achievements).toContain('first-blood');
    expect(world.player.gold).toBe(gold + config.achievements['first-blood']!.reward.gold);
    expect(world.drainEvents().some((event) => event.type === 'achievement')).toBe(true);
    expect(world.player.codexItems['rusty-sword']).toBe(1);

    const loaded = World.fromSave(config, world.toSave(0), 2);
    expect(loaded.player.kills['mountain-ape']).toBe(1);
    expect(loaded.player.achievements).toContain('first-blood');
    expect(loaded.player.codexItems).toEqual(world.player.codexItems);
    loaded.checkAchievements();
    expect(loaded.player.achievements.filter((id) => id === 'first-blood')).toHaveLength(1);
  });
});

describe('物品来源', () => {
  it('商店和 Boss 专属一直公开，怪物掉落打过才写名字，打满 50 只才有掉率', () => {
    const world = new World(config, 'taina-mountain', 'body', 1);
    const { player } = world;
    expect(itemSources(config, player, 'boss-serpent-armor')[0]).toContain('铁甲蛟');
    expect(itemSources(config, player, 'small-potion').some((source) => source.includes('有售'))).toBe(true);

    expect(itemSources(config, player, 'bat-wing')).toEqual(['？？？（太南山）']);
    player.kills['night-bat'] = 1;
    expect(itemSources(config, player, 'bat-wing')).toEqual(['夜蝠（太南山）']);
    player.kills['night-bat'] = 50;
    expect(itemSources(config, player, 'bat-wing')[0]).toMatch(/约 35%$/);
  });

  it('每件法器和任务材料都至少有一个来源', () => {
    const world = new World(config, 'taina-mountain', 'body', 1);
    const collected = Object.values(config.quests).flatMap((quest) =>
      quest.objectives.filter((objective) => objective.type === 'collect').map((objective) => objective.target),
    );
    const story = new Set(['ascension-token', 'great-transfer-token', 'xutian-cauldron', 'jade-marrow', 'purple-monkey', 'sky-fruit']);
    for (const item of Object.values(config.items)) {
      if (item.kind !== 'equip' && !collected.includes(item.id)) continue;
      if (story.has(item.id)) continue;
      expect(itemSources(config, world.player, item.id).length, item.id).toBeGreaterThan(0);
    }
  });
});

describe('第 7 章 天澜草原', () => {
  it('主线接在第 6 章后面，地图按任务开放，任务经验约占 40～45 级的四成', () => {
    const chain = Object.values(config.quests).filter((quest) => quest.id.startsWith('ch7-'));
    expect(chain[0]!.prev).toBe('ch6-ending');
    for (const quest of chain) expect(quest.main, quest.id).toBe(true);
    expect(config.maps['tianlan-grass']!.portals!.find((portal) => portal.toMap === 'tuwu-camp')!.requires).toBe('ch7-fengyue');
    expect(config.maps['tuwu-camp']!.portals!.find((portal) => portal.toMap === 'beast-altar')!.requires).toBe('ch7-hu');
    const levels = config.levels.expToNext.slice(39, 44).reduce((sum, exp) => sum + exp, 0);
    const quests = chain.reduce((sum, quest) => sum + quest.rewards.exp, 0);
    expect(quests / levels).toBeGreaterThan(0.3);
    expect(quests / levels).toBeLessThan(0.5);
    for (const [mapId, bossId] of [
      ['tuwu-camp', 'hu-xianshi'],
      ['beast-altar', 'tianlan-beast'],
      ['mulan-border', 'le-shangshi'],
    ] as const) {
      const boss = config.maps[mapId]!.spawns.find((spawn) => spawn.monster === bossId)!;
      for (const npc of Object.values(config.npcs).filter((candidate) => candidate.map === mapId)) {
        expect(Math.hypot(npc.x - boss.x, npc.y - boss.y) - 2, npc.id).toBeGreaterThan(config.monsters[bossId]!.aggroRange);
      }
    }
  });

  it('慕兰之战支线从落云宗开始，打赢乐上师结束', () => {
    const chain = ['side-mulan-call', 'side-mulan-riders', 'side-mulan-mages', 'side-mulan-lamp'];
    expect(config.quests[chain[0]!]!.prev).toBe('ch6-arrive');
    for (let i = 1; i < chain.length; i++) expect(config.quests[chain[i]!]!.prev).toBe(chain[i - 1]);
    expect(config.quests['side-mulan-lamp']!.objectives[0]).toEqual({ type: 'kill', target: 'le-shangshi', count: 1 });
    expect(config.npcs['luoyun-gate']!.travel!.some((option) => option.map === 'mulan-border')).toBe(true);
  });

  it('44 级天澜套能从第 7 章的怪和 Boss 身上掉', () => {
    const world = new World(config, 'tianlan-grass', 'body', 1);
    for (const piece of config.sets['tianlan']!.pieces) {
      expect(itemSources(config, world.player, piece).length, piece).toBeGreaterThan(0);
    }
  });
});

describe('第 8 章 大晋', () => {
  const chain = Object.values(config.quests).filter((quest) => quest.id.startsWith('ch8-'));

  it('第 7 章结局漂进大晋，主线接在后面，任务经验约占 45～50 级的四成', () => {
    expect(config.quests['ch7-beast']!.rewards.teleport?.map).toBe('jinxi-market');
    expect(chain[0]!.prev).toBe('ch7-beast');
    for (const quest of chain) expect(quest.main, quest.id).toBe(true);
    const levels = config.levels.expToNext.slice(44, 49).reduce((sum, exp) => sum + exp, 0);
    const quests = chain.reduce((sum, quest) => sum + quest.rewards.exp, 0);
    expect(quests / levels).toBeGreaterThan(0.3);
    expect(quests / levels).toBeLessThan(0.5);
  });

  it('按顺序做完第 8 章主线，传送阵跟着任务开放', () => {
    const world = new World(config, 'jinxi-market', 'body', 1);
    const { player } = world;
    player.level = 49;
    player.quests.completed.push(...Object.keys(config.quests).filter((id) => !id.startsWith('ch8-')));
    const guide = config.npcs['jinxi-guide']!;
    const option = (map: string) => guide.travel!.find((candidate) => candidate.map === map)!;
    expect(option('fengjia-cave').requires).toBe('ch8-ginseng');
    expect(option('kuzhu-island').requires).toBe('ch8-invite');
    for (const quest of chain) {
      expect(questStatus(quest, player.quests, player.level, player.bag), quest.id).toBe('available');
      world.acceptQuest(quest.id);
      const progress = player.quests.active.find((active) => active.id === quest.id)!;
      progress.counts = quest.objectives.map((objective) => objective.count);
      world.turnInQuest(quest.id);
      expect(player.quests.completed, quest.id).toContain(quest.id);
    }
  });

  it('方尖山二魔同在山顶，Boss 离 NPC 足够远', () => {
    const spawns = config.maps['fangjian-mountain']!.spawns;
    const elder = spawns.find((spawn) => spawn.monster === 'fangjian-elder')!;
    const younger = spawns.find((spawn) => spawn.monster === 'fangjian-younger')!;
    expect(Math.hypot(elder.x - younger.x, elder.y - younger.y)).toBeLessThan(10);
    expect(config.quests['ch8-twins']!.objectives.map((objective) => objective.target)).toEqual([
      'fangjian-elder',
      'fangjian-younger',
    ]);
    for (const [mapId, bossId] of [
      ['fangjian-mountain', 'fangjian-elder'],
      ['fangjian-mountain', 'yin-mo'],
      ['kuzhu-island', 'kuzhu-elder'],
    ] as const) {
      const boss = config.maps[mapId]!.spawns.find((spawn) => spawn.monster === bossId)!;
      for (const npc of Object.values(config.npcs).filter((candidate) => candidate.map === mapId)) {
        expect(Math.hypot(npc.x - boss.x, npc.y - boss.y) - 2, npc.id).toBeGreaterThan(config.monsters[bossId]!.aggroRange);
      }
    }
  });
});

describe('素材清单', () => {
  const index = JSON.parse(readFileSync('public/assets/sprites/index.json', 'utf8')) as Record<string, unknown>;

  it('精灵表索引和烘焙出的文件一致，烘焙名单里的都烘焙过了', async () => {
    const files = readdirSync('public/assets/sprites')
      .filter((file) => file.endsWith('.json') && file !== 'index.json')
      .map((file) => file.slice(0, -'.json'.length));
    expect(Object.keys(index).sort()).toEqual(files.sort());
    for (const key of files) {
      expect(index[key], key).toEqual(JSON.parse(readFileSync(`public/assets/sprites/${key}.json`, 'utf8')));
    }
    const { ROSTER } = await import('../../tools/bake/roster');
    for (const entry of ROSTER) expect(index[entry.key], entry.key).toBeDefined();
  });

  it('每张地图的素材清单包含它的怪、召唤物和 NPC', () => {
    for (const map of Object.values(config.maps)) {
      for (const classId of Object.keys(config.classes)) {
        const { sprites, props } = mapAssets(config, map.id, classId);
        expect(sprites.has(classId)).toBe(true);
        for (const spawn of map.spawns) expect(sprites.has(spawn.monster), `${map.id} ${spawn.monster}`).toBe(true);
        for (const npc of Object.values(config.npcs).filter((candidate) => candidate.map === map.id)) {
          expect(sprites.has(`npc-${npc.id}`), npc.id).toBe(true);
        }
        for (const item of map.decor ?? []) expect(props.has(item.prop)).toBe(true);
      }
    }
    expect(mapAssets(config, 'mulan-border', 'body').sprites.has('sacred-bird')).toBe(true);
    expect(mapAssets(config, 'starter-field', 'spirit').sprites.size).toBeGreaterThan(1);
  });
});

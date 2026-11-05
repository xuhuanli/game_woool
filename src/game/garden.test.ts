import { describe, expect, it } from 'vitest';
import { loadConfigFromDisk } from './testConfig';
import { World } from './world';

const config = await loadConfigFromDisk();
const MINUTE = 60_000;

function setup(level = 1) {
  let now = 1_000_000;
  const clock = () => now;
  const world = new World(config, 'qixuan-gate', 'body', 1, '测试', clock);
  world.player.level = level;
  world.player.gold = 100_000;
  world.player.quests.completed.push(config.garden.unlockQuest);
  return {
    world,
    garden: world.garden,
    state: world.player.garden,
    advance: (ms: number) => (now += ms),
    clock,
  };
}

describe('掌天瓶药园', () => {
  it('没完成墨大夫的任务前不能种', () => {
    const { world, garden } = setup();
    world.player.quests.completed = [];
    expect(garden.unlocked).toBe(false);
    expect(garden.plant(0, 'herb-huichun')).toBe(false);
  });

  it('到点才能收，收获数量对，收完地空出来', () => {
    const { world, garden, state, advance } = setup();
    expect(state.plots).toHaveLength(2);
    expect(garden.plant(0, 'herb-huichun')).toBe(true);
    advance(29 * MINUTE);
    expect(garden.harvest(0)).toBe(false);
    advance(MINUTE);
    expect(garden.harvest(0)).toBe(true);
    expect(world.player.bag['herb-huichun']).toBe(2);
    expect(state.plots[0]!.herb).toBeNull();
    expect(state.harvested['herb-huichun']).toBe(2);
  });

  it('背包没种子时就地扣灵石买，有种子时先用种子', () => {
    const { world, garden } = setup();
    const price = config.items['seed-huichun']!.price!;
    garden.plant(0, 'herb-huichun');
    expect(world.player.gold).toBe(100_000 - price);
    world.player.bag['seed-ningqi'] = 1;
    garden.plant(1, 'herb-ningqi');
    expect(world.player.bag['seed-ningqi'] ?? 0).toBe(0);
    expect(world.player.gold).toBe(100_000 - price);
  });

  it('等级不够的灵药种不了', () => {
    const { garden } = setup(10);
    expect(garden.plant(0, 'herb-yangyuan')).toBe(false);
  });

  it('绿液按间隔凝聚，停在上限', () => {
    const { garden, state, advance } = setup();
    garden.refresh();
    advance(20 * MINUTE);
    garden.refresh();
    expect(state.dew).toBe(1);
    advance(10 * 60 * MINUTE);
    garden.refresh();
    expect(state.dew).toBe(garden.dewMax);
    expect(garden.nextDewIn).toBe(0);
  });

  it('绿液只能催熟长过一半的灵药，只作用于这一块地', () => {
    const { garden, state, advance } = setup();
    state.dew = 3;
    garden.plant(0, 'herb-huichun');
    garden.plant(1, 'herb-huichun');
    advance(10 * MINUTE);
    expect(garden.accelerate(0)).toBe(false);
    expect(state.dew).toBe(3);
    advance(5 * MINUTE);
    expect(garden.accelerate(0)).toBe(true);
    expect(state.dew).toBe(2);
    expect(garden.isReady(0)).toBe(true);
    expect(garden.isReady(1)).toBe(false);
  });

  it('扩建要等级和灵石，扩满为止', () => {
    const { world, garden, state } = setup(13);
    expect(garden.expand()).toBe(false);
    world.player.level = 40;
    world.player.gold = 200_000;
    while (garden.expand());
    expect(state.plots).toHaveLength(config.garden.plots.initial + config.garden.plots.expansions.length);
    const spent = config.garden.plots.expansions.reduce((sum, step) => sum + step.gold, 0);
    expect(world.player.gold).toBe(200_000 - spent);
  });

  it('一键补种按上次种的灵药重播', () => {
    const { garden, state, advance } = setup();
    garden.plant(0, 'herb-huichun');
    garden.plant(1, 'herb-ningqi');
    advance(30 * MINUTE);
    expect(garden.harvestAll()).toBe(2);
    expect(garden.replantAll()).toBe(2);
    expect(state.plots.map((plot) => plot.herb)).toEqual(['herb-huichun', 'herb-ningqi']);
  });

  it('存档往返后地块和绿液不变，系统时间往回调时成熟时间被夹紧', () => {
    const { world, garden, advance, clock } = setup();
    garden.plant(0, 'herb-huichun');
    world.player.garden.dew = 2;
    const save = world.toSave(0);
    const loaded = World.fromSave(config, save, 2, clock);
    expect(loaded.player.garden).toEqual(world.player.garden);

    save.player.garden!.plots[0]!.readyAt += 1000 * 60 * MINUTE;
    const tampered = World.fromSave(config, save, 2, clock);
    expect(tampered.garden.remaining(0)).toBeLessThanOrEqual(30 * MINUTE);
    advance(30 * MINUTE);
    expect(tampered.garden.isReady(0)).toBe(true);
  });

  it('没有药园字段的存档读进来也能用', () => {
    const { world, clock } = setup();
    const save = world.toSave(0);
    delete save.player.garden;
    const loaded = World.fromSave(config, save, 2, clock);
    expect(loaded.player.garden.plots).toHaveLength(config.garden.plots.initial);
    expect(loaded.garden.plant(0, 'herb-huichun')).toBe(true);
  });

  it('闭关结算带上药园成熟株数和绿液', () => {
    const { world, garden, advance } = setup();
    world.player.lastFieldMap = 'starter-field';
    garden.plant(0, 'herb-huichun');
    advance(2 * 60 * MINUTE);
    const report = world.settleOffline(0, 2 * 60 * MINUTE);
    expect(report?.garden).toEqual({ ready: 1, dew: 6 });
  });
});

describe('炼丹', () => {
  it('材料够就必成：扣材料和灵石出丹，不够就拒绝', () => {
    const { world, garden } = setup(30);
    const { player } = world;
    player.bag['herb-jinyuan'] = 2;
    player.bag['herb-yangyuan'] = 1;
    const gold = player.gold;
    expect(garden.brew('brew-big-potion')).toBe(1);
    expect(player.bag['big-potion']).toBe(1);
    expect(player.bag['herb-jinyuan']).toBe(1);
    expect(player.bag['herb-yangyuan'] ?? 0).toBe(0);
    expect(player.gold).toBe(gold - 30);
    expect(garden.brew('brew-big-potion')).toBe(0);
    expect(player.bag['herb-jinyuan']).toBe(1);
  });

  it('一次炼多炉按材料和灵石能炼的最多炉数算', () => {
    const { world, garden } = setup(1);
    world.player.bag['herb-huichun'] = 5;
    expect(garden.maxBrews(garden.recipe('brew-small-potion')!)).toBe(5);
    expect(garden.brew('brew-small-potion', 99)).toBe(5);
    expect(world.player.bag['small-potion']).toBe(5);
    world.player.bag['jade-marrow'] = 3;
    world.player.bag['purple-monkey'] = 3;
    world.player.bag['sky-fruit'] = 3;
    world.player.level = 11;
    world.player.gold = 150;
    expect(garden.brew('brew-foundation-pill', 3)).toBe(1);
  });

  it('等级不够的丹方炼不了', () => {
    const { world, garden } = setup(20);
    world.player.bag['herb-jinsui'] = 1;
    world.player.bag['herb-jinyuan'] = 1;
    expect(garden.brew('brew-core-pill')).toBe(0);
    expect(world.player.bag['core-pill'] ?? 0).toBe(0);
  });

  it('突破丹的丹方和主药不晚于要用它的突破等级', () => {
    for (const realm of config.realms) {
      for (const { item } of realm.breakthrough?.requires ?? []) {
        const recipe = config.garden.recipes.find((candidate) => candidate.output === item);
        if (!recipe) continue;
        expect(recipe.level, recipe.id).toBeLessThanOrEqual(realm.maxLevel);
        for (const material of recipe.materials) {
          const herb = config.garden.herbs.find((candidate) => candidate.item === material.item);
          if (herb) expect(herb.level, herb.item).toBeLessThanOrEqual(realm.maxLevel);
        }
      }
    }
  });

  it('突破主药的种子买不到，只能打怪掉', () => {
    const { world, garden } = setup(40);
    expect(garden.plant(0, 'herb-jinsui')).toBe(false);
    expect(garden.plant(0, 'herb-longwen')).toBe(false);
    expect(world.player.gold).toBe(100_000);
    world.player.bag['seed-longwen'] = 1;
    expect(garden.plant(0, 'herb-longwen')).toBe(true);
  });

  it('结丹失败一次后，用掉落的金髓草种子种出主药，炼成降尘丹再突破', () => {
    const { world, garden, advance } = setup(26);
    const { player } = world;
    player.exp = world.expToNext!;
    player.bag['core-pill'] = 1;
    // 第一次突破失败：把成功率压成 0
    const realm = config.realms.find((candidate) => candidate.id === 'foundation')!;
    const chance = realm.breakthrough!.chance;
    realm.breakthrough!.chance = -1;
    world.attemptBreakthrough();
    realm.breakthrough!.chance = chance;
    expect(player.bag['core-pill'] ?? 0).toBe(0);
    expect(player.realmPassed).not.toContain('foundation');

    // 外星海的常规怪会掉金髓草种子
    const dropper = config.maps['outer-sea']!.spawns
      .map((spawn) => config.monsters[spawn.monster]!)
      .find((monster) => monster.extraDrops?.some((entry) => entry.item === 'seed-jinsui'));
    expect(dropper).toBeDefined();
    player.bag['seed-jinsui'] = 1;
    player.bag['seed-jinyuan'] = 1;
    garden.plant(0, 'herb-jinsui');
    garden.plant(1, 'herb-jinyuan');
    advance(5 * 60 * MINUTE);
    garden.harvestAll();
    expect(garden.brew('brew-core-pill')).toBe(1);
    expect(player.bag['core-pill']).toBe(1);

    player.weakUntil = 0;
    for (let attempt = 0; attempt < 20 && !player.realmPassed.includes('foundation'); attempt++) {
      player.bag['core-pill'] = Math.max(player.bag['core-pill'] ?? 0, 1);
      world.attemptBreakthrough();
      player.weakUntil = 0;
    }
    expect(player.realmPassed).toContain('foundation');
  });
});

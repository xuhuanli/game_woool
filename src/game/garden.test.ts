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

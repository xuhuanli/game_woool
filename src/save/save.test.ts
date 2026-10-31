import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CONFIG_FILES, type GameConfig } from '../game/config';
import { World, type GameEvent } from '../game/world';
import { AutoSaver } from './autoSaver';
import { migrateSave, parseSave, SAVE_VERSION, SaveError, type SaveData } from './saveData';
import type { SaveStore } from './saveStore';

const config = Object.fromEntries(
  CONFIG_FILES.map((name) => [
    name,
    JSON.parse(readFileSync(`public/data/${name}.json`, 'utf8')) as unknown,
  ]),
) as unknown as GameConfig;

const newWorld = () => new World(config, 'starter-field', 'spirit', 1, '南宫婉');

function equippedWorld(): World {
  const world = newWorld();
  const { player } = world;
  player.level = 5;
  player.exp = 33;
  player.gold = 321;
  player.bag['small-potion'] = 4;
  player.equipBag.push({
    uid: 900,
    itemId: 'rusty-sword',
    grade: 'top',
    affixes: [{ stat: 'maxHp', value: 15 }],
    luck: 3,
  });
  world.inventory.equip(900);
  return world;
}

function memoryStore(): SaveStore & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    load: async () => saved.at(-1),
    save: async (data) => void saved.push(data),
    clear: async () => void (saved.length = 0),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('存档恢复', () => {
  it('恢复玩家全部状态', () => {
    const world = equippedWorld();
    world.player.hp = 12;
    const loaded = World.fromSave(config, world.toSave(1000), 2);
    const { player } = loaded;

    expect(player.name).toBe('南宫婉');
    expect(player.def.id).toBe('spirit');
    expect(player.level).toBe(5);
    expect(player.exp).toBe(33);
    expect(player.gold).toBe(321);
    expect(player.hp).toBe(12);
    expect(player.bag).toEqual({ 'small-potion': 4 });
    expect(player.equipment.weapon).toEqual(world.player.equipment.weapon);
    expect(player.stats).toEqual(world.player.stats);
    expect(player.skills).toEqual(expect.arrayContaining(world.player.skills));
    expect(player.hotbar[0]).toEqual(world.player.hotbar[0]);
  });

  it('读档时补上当前等级该会的新技能', () => {
    const save = equippedWorld().toSave(1000);
    save.player.skills = ['spirit-poison'];
    const { player } = World.fromSave(config, save, 2);
    expect(player.skills).toContain('spirit-ward');
  });

  it('存档能经过 JSON 导出再导入', () => {
    const world = equippedWorld();
    const text = JSON.stringify(world.toSave(1000));
    const loaded = World.fromSave(config, parseSave(text), 2);
    expect(loaded.player.equipment.weapon?.luck).toBe(3);
  });

  it('存档是快照，之后的改动不影响它', () => {
    const world = equippedWorld();
    const save = world.toSave(1000);
    world.player.gold = 0;
    world.player.bag['small-potion'] = 1;
    expect(save.player.gold).toBe(321);
    expect(save.player.bag['small-potion']).toBe(4);
  });

  it('读档后新掉落的编号不和已有法器冲突', () => {
    const world = equippedWorld();
    const loaded = World.fromSave(config, world.toSave(1000), 2);
    const save = loaded.toSave(1000);
    expect(save.nextId).toBeGreaterThanOrEqual(world.toSave(1000).nextId);
  });

  it('死亡时保存，读档后在出生点满血复活', () => {
    const world = equippedWorld();
    world.player.hp = 0;
    const loaded = World.fromSave(config, world.toSave(1000), 2);
    expect(loaded.player.hp).toBe(loaded.player.stats.maxHp);
    expect(loaded.mapId).toBe('huangfeng-valley');
    expect(loaded.player.cell).toEqual({ x: 12, y: 14 });
  });

  it('玩家格子被怪物占住时，换到附近空位', () => {
    const world = equippedWorld();
    const spawn = config.maps['starter-field']!.spawns[0]!;
    const save = world.toSave(1000);
    save.player.cell = { x: spawn.x, y: spawn.y };
    const loaded = World.fromSave(config, save, 2);
    expect(loaded.player.cell).not.toEqual({ x: spawn.x, y: spawn.y });
    expect(loaded.grid.isWalkable(loaded.player.cell)).toBe(true);
  });

  it('配置表删掉的物品和技能在读档时被清除', () => {
    const save = equippedWorld().toSave(1000);
    save.player.bag.removed = 2;
    save.player.equipBag.push({ uid: 1, itemId: 'removed', grade: 'low', affixes: [], luck: 0 });
    save.player.skills.push('removed-skill');
    save.player.hotbar[3] = { kind: 'skill', id: 'removed-skill' };
    const { player } = World.fromSave(config, save, 2);
    expect(player.bag.removed).toBeUndefined();
    expect(player.equipBag).toEqual([]);
    expect(player.skills).not.toContain('removed-skill');
    expect(player.hotbar[3]).not.toEqual({ kind: 'skill', id: 'removed-skill' });
  });
});

describe('版本迁移', () => {
  const current = () => newWorld().toSave(1000);

  it('当前版本不需要迁移', () => {
    expect(migrateSave(current()).version).toBe(SAVE_VERSION);
  });

  it('第 1 版存档升级后带上任务和 Boss 状态', () => {
    const { bossReadyAt: _boss, deathDrops: _drops, ...save } = current();
    const {
      quests: _quests,
      realmPassed: _realm,
      auto: _auto,
      lastFieldMap: _field,
      ...player
    } = save.player;
    const migrated = migrateSave({ ...save, version: 1, player });
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.bossReadyAt).toEqual({});
    expect(migrated.player.quests).toEqual({ active: [], completed: [] });
    expect(migrated.deathDrops).toEqual([]);
    expect(migrated.player.realmPassed).toEqual([]);
    expect(migrated.player.auto.enabled).toBe(false);
    expect(() => World.fromSave(config, migrated, 1)).not.toThrow();
  });

  it('逐版升级旧存档', () => {
    const old = { ...current(), version: 1, legacy: 1 } as SaveData & { legacy?: number };
    const migrated = migrateSave(
      old,
      {
        1: (save) => ({ ...save, legacy: 2 }),
        2: (save) => ({ ...save, legacy: (save.legacy as number) + 10 }),
      },
      3,
    ) as SaveData & { legacy?: number };
    expect(migrated.version).toBe(3);
    expect(migrated.legacy).toBe(12);
  });

  it('缺少迁移函数时报错', () => {
    expect(() => migrateSave(current(), {}, SAVE_VERSION + 1)).toThrow(SaveError);
  });

  it('拒绝更新版本的存档', () => {
    expect(() => migrateSave({ ...current(), version: SAVE_VERSION + 1 })).toThrow('更新版本');
  });

  it('拒绝无效内容', () => {
    expect(() => parseSave('这不是 JSON')).toThrow(SaveError);
    expect(() => parseSave('{"version":1}')).toThrow(SaveError);
    expect(() => parseSave('null')).toThrow(SaveError);
  });
});

describe('自动保存', () => {
  const levelUp: GameEvent = { type: 'levelUp', level: 2 };

  it('定时保存', async () => {
    const store = memoryStore();
    const saver = new AutoSaver(newWorld(), store, () => {});
    saver.update(29);
    expect(store.saved).toHaveLength(0);
    saver.update(2);
    await flush();
    expect(store.saved).toHaveLength(1);
  });

  it('重要事件后尽快保存，但有最小间隔', async () => {
    const store = memoryStore();
    const saver = new AutoSaver(newWorld(), store, () => {});
    saver.notify(levelUp);
    saver.update(0.5);
    expect(store.saved).toHaveLength(0);
    saver.update(0.6);
    await flush();
    expect(store.saved).toHaveLength(1);
  });

  it('普通事件不触发保存', () => {
    const store = memoryStore();
    const saver = new AutoSaver(newWorld(), store, () => {});
    saver.notify({ type: 'expGained', amount: 1 });
    saver.update(2);
    expect(store.saved).toHaveLength(0);
  });

  it('停止后不再写入', async () => {
    const store = memoryStore();
    const saver = new AutoSaver(newWorld(), store, () => {});
    saver.stop();
    await saver.saveNow();
    expect(store.saved).toHaveLength(0);
  });

  it('写入失败时交给错误回调', async () => {
    const onError = vi.fn();
    const store = { ...memoryStore(), save: () => Promise.reject(new Error('满了')) };
    await new AutoSaver(newWorld(), store, onError).saveNow();
    expect(onError).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it } from 'vitest';
import { rollAttack } from './combat';
import {
  validateConfig,
  type AffixConfig,
  type CombatStats,
  type GameConfig,
  type MapDef,
} from './config';
import { equipmentName, rollEquipment, type Equipment } from './equipment';
import { Grid } from './grid';
import { loadConfigFromDisk } from './testConfig';
import { findPath } from './pathfinding';
import { realmName } from './realm';
import { Rng } from './rng';
import { TICK_SECONDS, World, type GameEvent, type Monster } from './world';

const realConfig = await loadConfigFromDisk();

/** 只有下品的品阶表，让法器属性固定。 */
const plainGrades: AffixConfig = {
  ...realConfig.affixes,
  grades: [{ id: 'low', name: '下品', color: '#fff', weight: 1, affixes: 0, sellMultiplier: 1 }],
};

const realmConfig = () => realConfig.realms;
const realmClasses = () => realConfig.classes;

function emptyMap(obstacles: MapDef['obstacles'] = []): MapDef {
  return {
    id: 'test',
    name: '测试',
    width: 12,
    height: 12,
    playerStart: { x: 2, y: 2 },
    obstacles,
    spawns: [],
  };
}

function fixture(
  spawnAt: { x: number; y: number } | null,
  obstacles: MapDef['obstacles'] = [],
  dropChance = 1,
): GameConfig {
  const map = emptyMap(obstacles);
  if (spawnAt) map.spawns.push({ monster: 'ash-rat', ...spawnAt });
  return {
    ...realConfig,
    maps: { test: map },
    affixes: plainGrades,
    drops: { 'ash-rat': [{ item: 'rusty-sword', chance: dropChance }] },
  };
}

function run(world: World, seconds: number, until?: () => boolean): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += TICK_SECONDS) {
    world.tick();
    if (until?.()) return;
  }
}

const stats = (patch: Partial<CombatStats>): CombatStats => ({
  maxHp: 10,
  maxMp: 0,
  attack: { min: 5, max: 5 },
  magic: { min: 0, max: 0 },
  dao: { min: 0, max: 0 },
  defense: { min: 0, max: 0 },
  magicDefense: { min: 0, max: 0 },
  accuracy: 1e9,
  evasion: 0,
  luck: 0,
  ...patch,
});

describe('配置表', () => {
  it('没有悬空引用', () => {
    expect(validateConfig(realConfig)).toEqual([]);
  });

  it('刷怪点和出生点都可行走', () => {
    for (const map of Object.values(realConfig.maps)) {
      const grid = new Grid(map);
      expect(grid.isWalkable(map.playerStart)).toBe(true);
      for (const spawn of map.spawns) expect(grid.isWalkable(spawn), `${spawn.x},${spawn.y}`).toBe(true);
    }
  });

  it('每个刷怪点都能从出生点走到', () => {
    for (const map of Object.values(realConfig.maps)) {
      const grid = new Grid(map);
      for (const spawn of map.spawns) {
        expect(findPath(grid, map.playerStart, spawn, () => true)).not.toBeNull();
      }
    }
  });
});

describe('战斗公式', () => {
  it('伤害至少为 1', () => {
    const result = rollAttack(
      stats({ attack: { min: 1, max: 1 } }),
      stats({ defense: { min: 9, max: 9 } }),
      new Rng(1),
    );
    expect(result).toMatchObject({ hit: true, damage: 1 });
  });

  it('法术用魔防计算', () => {
    const result = rollAttack(
      stats({ magic: { min: 10, max: 10 } }),
      stats({ defense: { min: 9, max: 9 }, magicDefense: { min: 2, max: 2 } }),
      new Rng(1),
      { stat: 'magic', multiplier: 1.5 },
    );
    expect(result.damage).toBe(13);
  });

  it('满幸运必定掷出上限', () => {
    const attacker = stats({ attack: { min: 1, max: 100 }, luck: 10 });
    const rng = new Rng(2);
    for (let i = 0; i < 50; i++) {
      expect(rollAttack(attacker, stats({}), rng).damage).toBe(100);
    }
  });
});

describe('寻路', () => {
  it('绕过墙', () => {
    const grid = new Grid(emptyMap([{ x: 5, y: 0, w: 1, h: 10 }]));
    const path = findPath(grid, { x: 2, y: 2 }, { x: 8, y: 2 }, () => true);
    expect(path?.at(-1)).toEqual({ x: 8, y: 2 });
    expect(path?.every((cell) => grid.isWalkable(cell))).toBe(true);
  });

  it('不穿过障碍拐角', () => {
    const grid = new Grid(
      emptyMap([
        { x: 3, y: 2, w: 1, h: 1 },
        { x: 2, y: 3, w: 1, h: 1 },
      ]),
    );
    const path = findPath(grid, { x: 2, y: 2 }, { x: 3, y: 3 }, () => true);
    expect(path === null || path.length > 1).toBe(true);
  });

  it('走不到时返回 null', () => {
    const grid = new Grid(emptyMap([{ x: 6, y: 0, w: 1, h: 12 }]));
    expect(findPath(grid, { x: 2, y: 2 }, { x: 8, y: 2 }, () => true)).toBeNull();
  });
});

describe('世界', () => {
  it('点击后走到目标格', () => {
    const world = new World(fixture(null), 'test', 'body', 1);
    world.moveTo({ x: 9, y: 7 });
    run(world, 10, () => world.player.order === null);
    expect(world.player.pos).toEqual({ x: 9, y: 7 });
  });

  it('点到障碍时走到最近的可行走格', () => {
    const world = new World(fixture(null, [{ x: 8, y: 8, w: 1, h: 1 }]), 'test', 'body', 1);
    world.moveTo({ x: 8, y: 8 });
    run(world, 10, () => world.player.order === null);
    expect(world.grid.isWalkable(world.player.cell)).toBe(true);
    expect(world.player.order).toBeNull();
  });

  it('击杀怪物后获得经验和掉落，拾取后装备变强', () => {
    const world = new World(fixture({ x: 6, y: 2 }), 'test', 'body', 3);
    const monster = world.monsters[0]!;
    const baseMax = world.player.stats.attack.max;
    world.attack(monster);
    run(world, 30, () => monster.hp === 0);

    expect(monster.hp).toBe(0);
    expect(world.player.exp).toBe(monster.def.exp);
    expect(world.items).toHaveLength(1);

    world.pickup(world.items[0]!);
    run(world, 10, () => world.items.length === 0);
    expect(world.player.equipment.weapon?.itemId).toBe('rusty-sword');
    expect(world.player.stats.attack.max).toBe(baseMax + 2);
  });

  it('怪物定时重生', () => {
    const world = new World(fixture({ x: 6, y: 2 }, [], 0), 'test', 'body', 3);
    const monster = world.monsters[0]!;
    world.attack(monster);
    run(world, 30, () => monster.hp === 0);
    run(world, monster.def.respawnSeconds + 1);
    expect(monster.hp).toBeGreaterThan(0);
  });

  it('经验够了会升级并回满血', () => {
    const world = new World(fixture({ x: 6, y: 2 }, [], 0), 'test', 'body', 3);
    const player = world.player;
    player.exp = world.expToNext! - 1;
    player.hp = 1;
    world.monsters[0]!.stats = stats({ maxHp: 1, attack: { min: 0, max: 0 } });
    world.monsters[0]!.hp = 1;
    world.attack(world.monsters[0]!);
    run(world, 20, () => player.level === 2);
    expect(player.level).toBe(2);
    expect(player.hp).toBe(player.stats.maxHp);
  });

  it('怪物追击靠近的玩家，超出范围后返回并回血', () => {
    const world = new World(fixture({ x: 6, y: 2 }), 'test', 'body', 5);
    const monster = world.monsters[0]!;
    monster.def = { ...monster.def, leashRange: 2 };
    run(world, 10, () => monster.mode === 'chase');
    expect(monster.mode).toBe('chase');

    monster.hp = 5;
    run(world, 10, () => monster.mode === 'return');
    expect(monster.mode).toBe('return');
    run(world, 10, () => monster.mode !== 'return');
    expect(monster.cell).toEqual(monster.home);
    expect(monster.hp).toBe(monster.stats.maxHp);
  });

  it('玩家死亡后复活，怪物放弃追击', () => {
    const world = new World(fixture({ x: 3, y: 2 }), 'test', 'body', 7);
    const player = world.player;
    const monster = world.monsters[0]!;
    player.hp = 1;
    run(world, 30, () => player.hp === 0);
    expect(player.hp).toBe(0);
    run(world, 1);
    expect(monster.mode).not.toBe('chase');
    run(world, 3, () => player.hp > 0);
    expect(player.hp).toBe(player.stats.maxHp);
  });

  it('使用药水回血并消耗', () => {
    const world = new World(fixture(null), 'test', 'body', 1);
    world.player.bag['small-potion'] = 1;
    world.player.hp = 5;
    world.inventory.useItem('small-potion');
    expect(world.player.hp).toBe(35);
    expect(world.player.bag).toEqual({});
  });

  it('同样的种子得到同样的结果', () => {
    const simulate = () => {
      const world = new World(realConfig, 'starter-field', 'body', 42);
      run(world, 60);
      return world.monsters.map((monster) => ({ ...monster.cell }));
    };
    expect(simulate()).toEqual(simulate());
  });
});

describe('境界', () => {
  it('按等级显示境界', () => {
    expect(realmName(realmConfig(), 3)).toBe('练气三层');
    expect(realmName(realmConfig(), 13)).toBe('练气十三层');
    expect(realmName(realmConfig(), 14)).toBe('筑基初期');
    expect(realmName(realmConfig(), 26)).toBe('筑基后期');
    expect(realmName(realmConfig(), 40)).toBe('元婴后期');
  });
});

describe('技能', () => {
  const spawned = (world: World, cell: { x: number; y: number }) => {
    const monster = world.monsters[0]!;
    monster.cell = { ...cell };
    monster.pos = { ...cell };
    monster.home = { ...cell };
    return monster;
  };

  it('每个职业开局会 1 级技能，并放进快捷栏', () => {
    for (const classId of Object.keys(realmClasses())) {
      const world = new World(fixture(null), 'test', classId, 1);
      expect(world.player.skills).toHaveLength(1);
      expect(world.player.hotbar[0]).toEqual({ kind: 'skill', id: world.player.skills[0] });
    }
  });

  it('升级后学会新技能', () => {
    const world = new World(fixture({ x: 3, y: 2 }, [], 0), 'test', 'spirit', 1);
    const monster = world.monsters[0]!;
    world.player.exp = (110 + 70 + 40) * 15;
    monster.stats = stats({ maxHp: 1, attack: { min: 0, max: 0 } });
    monster.hp = 1;
    world.attack(monster);
    run(world, 10, () => monster.hp === 0);
    expect(world.player.skills).toContain('spirit-heal');
    expect(world.player.hotbar).toContainEqual({ kind: 'skill', id: 'spirit-heal' });
  });

  it('远程技能走进射程后释放，消耗灵力并进入冷却', () => {
    const world = new World(fixture({ x: 10, y: 2 }, [], 0), 'test', 'spell', 1);
    const monster = world.monsters[0]!;
    monster.def = { ...monster.def, aggroRange: 0 };
    const mana = world.player.mp;
    world.castSkill('spell-fire', monster);
    run(world, 5, () => monster.hp < monster.stats.maxHp);
    expect(monster.hp).toBeLessThan(monster.stats.maxHp);
    expect(world.player.mp).toBeLessThan(mana);
    expect(world.player.skillCooldowns['spell-fire']).toBeGreaterThan(0);
  });

  it('灵力不足时不能释放', () => {
    const world = new World(fixture({ x: 3, y: 2 }, [], 0), 'test', 'spell', 1);
    world.player.mp = 0;
    world.drainEvents();
    world.castSkill('spell-fire', world.monsters[0]!);
    expect(world.player.order).toBeNull();
    expect(world.drainEvents()).toContainEqual({ type: 'message', text: '灵力不足' });
  });

  it('范围技能命中范围内所有怪物', () => {
    const config = fixture({ x: 5, y: 5 }, [], 0);
    config.maps.test!.spawns.push({ monster: 'ash-rat', x: 6, y: 5 }, { monster: 'ash-rat', x: 10, y: 10 });
    const world = new World(config, 'test', 'spell', 1);
    const [near, beside, far] = world.monsters as [Monster, Monster, Monster];
    world.player.level = 3;
    world.player.skills.push('spell-thunder');
    for (const monster of [near, beside, far]) monster.stats = { ...monster.stats, evasion: 0 };
    world.castSkill('spell-thunder', near);
    run(world, 3, () => near.hp < near.stats.maxHp);
    expect(beside.hp).toBeLessThan(beside.stats.maxHp);
    expect(far.hp).toBe(far.stats.maxHp);
  });

  it('毒持续掉血并让怪物追击施法者', () => {
    const near = new World(fixture({ x: 7, y: 2 }, [], 0), 'test', 'spirit', 1);
    const monster = spawned(near, { x: 7, y: 2 });
    monster.def = { ...monster.def, aggroRange: 0 };
    near.castSkill('spirit-poison', monster);
    run(near, 0.6);
    expect(monster.effects).toHaveLength(1);
    expect(monster.mode).toBe('chase');
    const before = monster.hp;
    run(near, 2.2);
    expect(monster.hp).toBeLessThan(before);
  });

  it('护盾减少受到的伤害', () => {
    const world = new World(fixture({ x: 3, y: 2 }), 'test', 'spell', 1);
    const player = world.player;
    player.skills.push('spell-shield');
    const monster = world.monsters[0]!;
    monster.stats = { ...monster.stats, attack: { min: 21, max: 21 }, accuracy: 1e9 };
    player.stats = { ...player.stats, defense: { min: 0, max: 0 } };
    world.castSkill('spell-shield');
    run(world, 0.3);
    expect(player.effects.map((effect) => effect.kind)).toEqual(['shield']);
    const events: GameEvent[] = [];
    run(world, 3, () => {
      events.push(...world.drainEvents());
      return events.some((event) => event.type === 'damage');
    });
    expect(events.find((event) => event.type === 'damage')).toMatchObject({ amount: 11 });
  });

  it('普攻出招途中按下的自身技能不会丢失', () => {
    const world = new World(fixture({ x: 3, y: 2 }, [], 0), 'test', 'spell', 1);
    const player = world.player;
    player.skills.push('spell-shield');
    world.monsters[0]!.def = { ...world.monsters[0]!.def, aggroRange: 0 };
    world.attack(world.monsters[0]!);
    run(world, 2, () => player.windupLeft > 0);
    expect(player.windupLeft).toBeGreaterThan(0);
    world.castSkill('spell-shield');
    run(world, 1);
    expect(player.effects.map((effect) => effect.kind)).toContain('shield');
  });

  it('治疗回复生命', () => {
    const world = new World(fixture(null), 'test', 'spirit', 1);
    world.player.skills.push('spirit-heal');
    world.player.hp = 10;
    world.castSkill('spirit-heal');
    run(world, 0.5);
    expect(world.player.hp).toBeGreaterThan(10 + 8);
  });

  it('灵虫替玩家打怪，到时消失，重复召唤只保留一只', () => {
    const world = new World(fixture({ x: 6, y: 2 }, [], 0), 'test', 'spirit', 1);
    const monster = world.monsters[0]!;
    monster.def = { ...monster.def, aggroRange: 0 };
    world.player.skills.push('spirit-summon');
    world.castSkill('spirit-summon');
    run(world, 0.6);
    expect(world.summons).toHaveLength(1);
    run(world, 20, () => monster.hp === 0);
    expect(monster.hp).toBe(0);
    expect(world.player.exp).toBe(monster.def.exp);

    world.player.skillCooldowns['spirit-summon'] = 0;
    world.player.mp = world.player.stats.maxMp;
    world.castSkill('spirit-summon');
    run(world, 0.6);
    expect(world.summons).toHaveLength(1);
    run(world, 61);
    expect(world.summons).toHaveLength(0);
  });
});

describe('法器', () => {
  const item = (id: string) => realConfig.items[id]!;
  const give = (world: World, itemId: string, uid: number, patch: Partial<Equipment> = {}) => {
    const equipment = { ...rollEquipment(item(itemId), plainGrades, new Rng(1), uid), ...patch };
    world.player.equipBag.push(equipment);
    return equipment;
  };
  const newWorld = (classId = 'body') => new World(fixture(null), 'test', classId, 1);

  it('品阶决定附加属性条数，且不重复', () => {
    const top = { ...realConfig.affixes, grades: [realConfig.affixes.grades[3]!] };
    const rng = new Rng(9);
    for (let i = 0; i < 50; i++) {
      const rolled = rollEquipment(item('rusty-sword'), top, rng, i);
      expect(rolled.affixes).toHaveLength(3);
      expect(new Set(rolled.affixes.map((affix) => affix.stat)).size).toBe(3);
    }
  });

  it('品阶按权重出现', () => {
    const rng = new Rng(3);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) {
      const { grade } = rollEquipment(item('rusty-sword'), realConfig.affixes, rng, i);
      counts[grade] = (counts[grade] ?? 0) + 1;
    }
    expect(counts.low!).toBeGreaterThan(counts.mid!);
    expect(counts.mid!).toBeGreaterThan(counts.high!);
    expect(counts.high!).toBeGreaterThan(counts.top!);
    expect(counts.top!).toBeGreaterThan(0);
  });

  it('穿上加属性，脱下恢复', () => {
    const world = newWorld();
    const player = world.player;
    const hp = player.stats.maxHp;
    give(world, 'cloth-robe', 100, { affixes: [{ stat: 'maxHp', value: 7 }] });
    world.inventory.equip(100);
    expect(player.stats.maxHp).toBe(hp + 17);
    expect(player.equipBag).toEqual([]);
    player.hp = player.stats.maxHp;
    world.inventory.unequip('armor');
    expect(player.stats.maxHp).toBe(hp);
    expect(player.hp).toBe(hp);
    expect(player.equipBag).toHaveLength(1);
  });

  it('主属性按职业生效', () => {
    const world = newWorld('spell');
    const max = world.player.stats.magic.max;
    give(world, 'rusty-sword', 100);
    world.inventory.equip(100);
    expect(world.player.stats.magic.max).toBe(max + 2);
  });

  it('等级不够不能穿', () => {
    const world = newWorld();
    give(world, 'steel-sword', 100);
    world.inventory.equip(100);
    expect(world.player.equipment.weapon).toBeUndefined();
    expect(world.player.equipBag).toHaveLength(1);
  });

  it('戒指优先穿空位，都满时替换第一个', () => {
    const world = newWorld();
    world.player.level = 3;
    for (const uid of [100, 101, 102]) {
      give(world, 'jade-ring', uid);
      world.inventory.equip(uid);
    }
    expect(world.player.equipment.ringLeft?.uid).toBe(102);
    expect(world.player.equipment.ringRight?.uid).toBe(101);
    expect(world.player.equipBag.map((equipment) => equipment.uid)).toEqual([100]);
  });

  it('捡到法器时有空位自动穿上，没有空位放进背包', () => {
    const world = new World(fixture({ x: 3, y: 2 }), 'test', 'body', 1);
    const monster = world.monsters[0]!;
    world.player.equipment.weapon = give(world, 'rusty-sword', 100);
    world.player.equipBag.length = 0;
    monster.stats = stats({ maxHp: 1, attack: { min: 0, max: 0 } });
    monster.hp = 1;
    world.attack(monster);
    run(world, 10, () => monster.hp === 0);
    world.pickup(world.items[0]!);
    run(world, 5, () => world.items.length === 0);
    expect(world.player.equipment.weapon?.uid).toBe(100);
    expect(world.player.equipBag).toHaveLength(1);
  });

  it('背包满时法器留在地上', () => {
    const world = new World(fixture({ x: 3, y: 2 }), 'test', 'body', 1);
    const monster = world.monsters[0]!;
    monster.stats = stats({ maxHp: 1, attack: { min: 0, max: 0 } });
    monster.hp = 1;
    for (let uid = 0; uid < realConfig.affixes.bagCapacity; uid++) give(world, 'cloth-robe', 1000 + uid);
    world.attack(monster);
    run(world, 10, () => monster.hp === 0);
    world.pickup(world.items[0]!);
    run(world, 3);
    expect(world.items).toHaveLength(1);
    expect(world.player.equipment.weapon).toBeUndefined();
  });

  it('丢弃的法器保留品阶，可以捡回', () => {
    const world = newWorld();
    world.player.equipment.armor = give(world, 'cloth-robe', 99);
    world.player.equipBag.length = 0;
    const equipment = give(world, 'cloth-robe', 100, { grade: 'top', affixes: [{ stat: 'luck', value: 1 }] });
    world.discard(100);
    expect(world.player.equipBag).toEqual([]);
    expect(world.items[0]?.equipment).toEqual(equipment);
    world.pickup(world.items[0]!);
    run(world, 5, () => world.items.length === 0);
    expect(world.player.equipBag).toEqual([equipment]);
  });

  describe('祭炼', () => {
    const refineWorld = (seed: number) => {
      const world = new World(fixture(null), 'test', 'body', seed);
      const sword = give(world, 'rusty-sword', 100);
      world.inventory.equip(100);
      world.player.gold = 1000;
      world.player.bag['refine-stone'] = 10;
      return { world, sword };
    };

    it('成功加幸运，消耗材料和灵石', () => {
      const { world, sword } = refineWorld(1);
      world.inventory.refine(sword.uid);
      expect(sword.luck).toBe(1);
      expect(world.player.stats.luck).toBe(1);
      expect(world.player.gold).toBe(950);
      expect(world.player.bag['refine-stone']).toBe(9);
    });

    it('失败掉幸运，且不低于 0', () => {
      const { world, sword } = refineWorld(1);
      sword.luck = 6;
      const events: GameEvent[] = [];
      for (let i = 0; i < 40 && world.player.bag['refine-stone']; i++) {
        world.inventory.refine(sword.uid);
        events.push(...world.drainEvents());
      }
      expect(events.some((event) => event.type === 'refined' && !event.success)).toBe(true);
      expect(sword.luck).toBeGreaterThanOrEqual(0);
    });

    it('只有武器能祭炼，幸运有上限，缺材料时不消耗', () => {
      const { world, sword } = refineWorld(1);
      const robe = give(world, 'cloth-robe', 101);
      world.inventory.refine(robe.uid);
      expect(robe.luck).toBe(0);
      sword.luck = realConfig.affixes.refine.maxLuck;
      world.inventory.refine(sword.uid);
      expect(sword.luck).toBe(realConfig.affixes.refine.maxLuck);
      sword.luck = 0;
      delete world.player.bag['refine-stone'];
      world.inventory.refine(sword.uid);
      expect(world.player.gold).toBe(1000);
    });
  });

  it('法器名称包含品阶和幸运', () => {
    const equipment: Equipment = { uid: 1, itemId: 'rusty-sword', grade: 'top', affixes: [], luck: 2 };
    expect(equipmentName(equipment, realConfig)).toBe('极品·青铜剑 +2');
  });
});

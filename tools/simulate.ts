/**
 * 数值模拟：用真实游戏逻辑无界面地挂机，输出各职业的升级耗时和产出。
 * 用法：npm run sim
 */
import { estimateIncome, OFFLINE_EFFICIENCY } from '../src/game/offline';
import { loadConfigFromDisk } from '../src/game/testConfig';
import { TICK_SECONDS, World } from '../src/game/world';

const MAX_HOURS = 12;
const TARGET_LEVEL = 13;
const SEEDS = [1, 2, 3];
const FIELD_LEVEL = 6;
const POTIONS_PER_TRIP = 10;
const POTION_ID = 'small-potion';

const config = await loadConfigFromDisk();

interface Result {
  classId: string;
  levelTimes: Map<number, number>;
  hours: number;
  level: number;
  deaths: number;
  recalls: number;
  gold: number;
  equipment: number;
  expPerHour: number;
  goldPerHour: number;
  estimatedExpPerHour: number;
  estimatedGoldPerHour: number;
}

function bestField(world: World): string {
  return world.player.level >= FIELD_LEVEL ? 'taina-mountain' : 'starter-field';
}

function primaryBonus(world: World, itemId: string): number {
  return world.config.items[itemId]?.bonus?.primary ?? 0;
}

/** 回城补给：买药，把背包里更好的武器换上。 */
function resupply(world: World): void {
  const { player, inventory } = world;
  const price = config.items[POTION_ID]?.price ?? 0;
  while ((player.bag[POTION_ID] ?? 0) < POTIONS_PER_TRIP && player.gold >= price) {
    player.gold -= price;
    inventory.addToBag(POTION_ID, 1);
  }
  for (const equipment of [...player.equipBag]) {
    const worn = player.equipment.weapon;
    const isWeapon = config.items[equipment.itemId]?.slot === 'weapon';
    if (isWeapon && primaryBonus(world, equipment.itemId) > (worn ? primaryBonus(world, worn.itemId) : 0)) {
      inventory.equip(equipment.uid);
    }
  }
  while (player.equipBag.length > 0) {
    const equipment = player.equipBag.at(-1)!;
    player.equipBag.pop();
    player.gold += world.sellPrice(equipment);
  }
}

function simulate(classId: string, seed: number): Result {
  const world = new World(config, 'huangfeng-valley', classId, seed);
  const { player } = world;
  const move = (mapId: string) => {
    const target = config.maps[mapId]!;
    (world as unknown as { changeMap(id: string, cell: object): void }).changeMap(mapId, target.playerStart);
  };
  player.gold = 200;
  resupply(world);
  player.auto.enabled = true;
  move('starter-field');

  const levelTimes = new Map<number, number>([[1, 0]]);
  let deaths = 0;
  let recalls = 0;
  let equipment = 0;
  let windowExp = 0;
  let windowGold = 0;
  let windowSeconds = 0;

  const maxTicks = (MAX_HOURS * 3600) / TICK_SECONDS;
  for (let tick = 0; tick < maxTicks && player.level < TARGET_LEVEL; tick++) {
    world.tick();
    for (const event of world.drainEvents()) {
      if (event.type === 'levelUp') levelTimes.set(event.level, world.time);
      else if (event.type === 'death' && event.unit === player) deaths += 1;
      else if (event.type === 'pickedUp' && event.item.equipment) equipment += 1;
      else if (event.type === 'expGained') windowExp += event.amount;
      else if (event.type === 'pickedUp' && event.item.def.kind === 'gold') windowGold += event.item.amount;
    }
    windowSeconds += TICK_SECONDS;

    if (!player.hp) continue;
    if (world.map.safe) {
      recalls += player.auto.enabled ? 0 : 1;
      player.hp = player.stats.maxHp;
      resupply(world);
      player.auto.enabled = true;
      move(bestField(world));
    } else if (world.mapId !== bestField(world)) {
      resupply(world);
      move(bestField(world));
    }
  }

  const map = config.maps[bestField(world)]!;
  const estimate = estimateIncome(config, map, player.stats, player.def.primaryStat, player.attackInterval);
  const hours = world.time / 3600;
  return {
    classId,
    levelTimes,
    hours,
    level: player.level,
    deaths,
    recalls,
    gold: player.gold,
    equipment,
    expPerHour: windowExp / (windowSeconds / 3600),
    goldPerHour: windowGold / (windowSeconds / 3600),
    estimatedExpPerHour: estimate.expPerSecond * 3600,
    estimatedGoldPerHour: estimate.goldPerSecond * 3600,
  };
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const round = (value: number) => Math.round(value).toLocaleString('en-US');

console.log(`模拟：挂机到 ${TARGET_LEVEL} 级，最多 ${MAX_HOURS} 小时，每职业 ${SEEDS.length} 个种子。\n`);
console.log('| 职业 | 到 5 级（分） | 到 10 级（分） | 到 13 级（分） | 总时长（时） | 死亡 | 回城 | 法器 | 经验/时 | 灵石/时 |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
const rows: Result[][] = [];
for (const classId of Object.keys(config.classes)) {
  const runs = SEEDS.map((seed) => simulate(classId, seed));
  rows.push(runs);
  const at = (level: number) => {
    const times = runs.map((run) => run.levelTimes.get(level)).filter((time) => time !== undefined);
    return times.length === runs.length ? round(mean(times) / 60) : '未到';
  };
  console.log(
    `| ${config.classes[classId]!.name} | ${at(5)} | ${at(10)} | ${at(13)} | ${mean(runs.map((run) => run.hours)).toFixed(1)} | ` +
      `${round(mean(runs.map((run) => run.deaths)))} | ${round(mean(runs.map((run) => run.recalls)))} | ` +
      `${round(mean(runs.map((run) => run.equipment)))} | ${round(mean(runs.map((run) => run.expPerHour)))} | ` +
      `${round(mean(runs.map((run) => run.goldPerHour)))} |`,
  );
}

console.log('\n闭关估算对比：闭关收益应接近挂机实测的 50%。\n');
console.log('| 职业 | 挂机经验/时 | 闭关经验/时 | 比例 | 挂机灵石/时 | 闭关灵石/时 | 比例 |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const runs of rows) {
  const name = config.classes[runs[0]!.classId]!.name;
  const exp = mean(runs.map((run) => run.expPerHour));
  const gold = mean(runs.map((run) => run.goldPerHour));
  const offlineExp = mean(runs.map((run) => run.estimatedExpPerHour)) * OFFLINE_EFFICIENCY;
  const offlineGold = mean(runs.map((run) => run.estimatedGoldPerHour)) * OFFLINE_EFFICIENCY;
  console.log(
    `| ${name} | ${round(exp)} | ${round(offlineExp)} | ${Math.round((offlineExp / exp) * 100)}% | ` +
      `${round(gold)} | ${round(offlineGold)} | ${Math.round((offlineGold / gold) * 100)}% |`,
  );
}

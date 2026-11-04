/**
 * 数值模拟：用真实游戏逻辑无界面地挂机，输出各职业的升级耗时和产出。
 * 用法：npm run sim
 */
import { estimateIncome, OFFLINE_EFFICIENCY } from '../src/game/offline';
import { pendingBreakthrough } from '../src/game/realm';
import { loadConfigFromDisk } from '../src/game/testConfig';
import { TICK_SECONDS, World } from '../src/game/world';

const MAX_HOURS = 60;
const TARGET_LEVEL = 40;
const SEEDS = [1, 2, 3];
/** 按等级选挂机地图，和各章节的等级段一致 */
const FIELDS: [number, string][] = [
  [39, 'blood-gate'],
  [37, 'zhuomo-inner'],
  [35, 'zhuomo-outer'],
  [33, 'xutian-core'],
  [31, 'xutian-hall'],
  [29, 'xutian-mist'],
  [27, 'outer-sea'],
  [22, 'jingu-plain'],
  [18, 'spirit-mine'],
  [14, 'yanling-fort'],
  [11, 'blood-forbidden'],
  [6, 'taina-mountain'],
  [1, 'starter-field'],
];
const POTIONS_PER_TRIP = 10;
/** 14 级起改买养元丹，27 级起改买大还丹，低一档的丹药到下一章就不够用了。 */
const potionFor = (level: number) => (level >= 27 ? 'big-potion' : level >= 14 ? 'mid-potion' : 'small-potion');

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
  return FIELDS.find(([level]) => world.player.level >= level)![1];
}

function primaryBonus(world: World, itemId: string): number {
  return world.config.items[itemId]?.bonus?.primary ?? 0;
}

/** 回城补给：买够等级的功法书，买药，把背包里更好的武器换上。 */
function resupply(world: World): void {
  const { player, inventory } = world;
  for (const item of Object.values(config.items)) {
    const skill = config.skills[item.skill ?? ''];
    if (item.kind !== 'book' || !skill || skill.classId !== player.def.id || skill.level > player.level) continue;
    if (player.skills.includes(skill.id) || player.gold < (item.price ?? 0)) continue;
    player.gold -= item.price ?? 0;
    inventory.addToBag(item.id, 1);
    inventory.useItem(item.id);
  }
  const potionId = potionFor(player.level);
  const price = config.items[potionId]?.price ?? 0;
  while ((player.bag[potionId] ?? 0) < POTIONS_PER_TRIP && player.gold >= price) {
    player.gold -= price;
    inventory.addToBag(potionId, 1);
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

/** 修为圆满时补齐突破材料并冲关，主线里这些材料都能拿到。 */
function breakThrough(world: World): void {
  const { player } = world;
  const realm = pendingBreakthrough(config.realms, player.level, player.realmPassed);
  if (!realm?.breakthrough || world.expToNext === null || player.exp < world.expToNext) return;
  for (const { item, count } of realm.breakthrough.requires) {
    player.bag[item] = Math.max(player.bag[item] ?? 0, count);
  }
  world.attemptBreakthrough();
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
    breakThrough(world);
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
  const estimate = estimateIncome(config, map, world.offlineFighter());
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
console.log('| 职业 | 到 13 级 | 到 26 级 | 到 30 级 | 到 34 级 | 到 37 级 | 到 40 级 | 死亡 | 回城 | 法器 | 经验/时 | 灵石/时 |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
const rows: Result[][] = [];
for (const classId of Object.keys(config.classes)) {
  const runs = SEEDS.map((seed) => simulate(classId, seed));
  rows.push(runs);
  const at = (level: number) => {
    const times = runs.map((run) => run.levelTimes.get(level)).filter((time) => time !== undefined);
    return times.length === runs.length ? `${(mean(times) / 3600).toFixed(1)} 时` : '未到';
  };
  console.log(
    `| ${config.classes[classId]!.name} | ${at(13)} | ${at(26)} | ${at(30)} | ${at(34)} | ${at(37)} | ${at(40)} | ` +
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

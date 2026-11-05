/**
 * 数值模拟：用真实游戏逻辑无界面地挂机，输出各职业的升级耗时和产出。
 * 用法：npm run sim，或 npm run sim -- 55 挂到 55 级（小时上限跟着放宽），
 * 加 --seeds=16 换种子数。每个职业和种子单独开一个进程并行跑。
 */
import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { estimateIncome, OFFLINE_EFFICIENCY } from '../src/game/offline';
import { pendingBreakthrough } from '../src/game/realm';
import { loadConfigFromDisk } from '../src/game/testConfig';
import { TICK_SECONDS, World } from '../src/game/world';

const args = process.argv.slice(2);
const TARGET_LEVEL = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 40);
const MAX_HOURS = TARGET_LEVEL > 55 ? 160 : TARGET_LEVEL > 40 ? 100 : 60;
/** 种子少了结果会随掉落表的改动整体漂移，缺省 8 个，同时报出最快和最慢 */
const SEED_COUNT = Number(args.find((arg) => arg.startsWith('--seeds='))?.slice(8) ?? 8);
/** 闭关估算每隔这么多秒按当前属性重算一次 */
const ESTIMATE_SECONDS = 60;
/** 在一张图上挂够这么久才拿来比较闭关收益 */
const FIELD_MIN_HOURS = 0.5;
/** 按等级选挂机地图，和各章节的等级段一致 */
const FIELDS: [number, string][] = [
  [58, 'ice-sea'],
  [55, 'xuelian-mountain'],
  [54, 'zhenmo-tower-2'],
  [53, 'zhenmo-tower'],
  [52, 'kunwu-mountain'],
  [50, 'yinyang-cave'],
  [48, 'fengjia-cave'],
  [45, 'fangjian-mountain'],
  [43, 'tuwu-camp'],
  [40, 'tianlan-grass'],
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
/** 14 级起改买养元丹，27 级起大还丹，41 级起回天丹，56 级起玉清丹，低一档的丹药到下一章就不够用了。 */
const potionFor = (level: number) =>
  level >= 56 ? 'jade-potion' : level >= 41 ? 'huge-potion' : level >= 27 ? 'big-potion' : level >= 14 ? 'mid-potion' : 'small-potion';

const config = await loadConfigFromDisk();

/** 在一张挂机图上的实测收益和同一段时间的闭关估算 */
interface FieldIncome {
  seconds: number;
  exp: number;
  gold: number;
  estimatedExp: number;
  estimatedGold: number;
}

interface Result {
  classId: string;
  seed: number;
  /** 等级 → 升到这一级的秒数 */
  levelTimes: Record<number, number>;
  hours: number;
  level: number;
  deaths: number;
  recalls: number;
  gold: number;
  equipment: number;
  fields: Record<string, FieldIncome>;
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
    if (inventory.knowsSkill(skill.id) || player.gold < (item.price ?? 0)) continue;
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
    player.gold += world.shop.sellPrice(equipment);
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
  // 药园按真实时间长，模拟里不用，给固定时钟保证结果可复现
  const world = new World(config, 'huangfeng-valley', classId, seed, undefined, () => 0);
  const { player } = world;
  const move = (mapId: string) => {
    const target = config.maps[mapId]!;
    (world as unknown as { changeMap(id: string, cell: object): void }).changeMap(mapId, target.playerStart);
  };
  player.gold = 200;
  resupply(world);
  player.auto.enabled = true;
  move('starter-field');

  const levelTimes: Record<number, number> = { 1: 0 };
  let deaths = 0;
  let recalls = 0;
  let equipment = 0;
  const fields: Record<string, FieldIncome> = {};
  let estimate = { expPerSecond: 0, goldPerSecond: 0 };
  let estimateLeft = 0;

  const maxTicks = (MAX_HOURS * 3600) / TICK_SECONDS;
  for (let tick = 0; tick < maxTicks && player.level < TARGET_LEVEL; tick++) {
    world.tick();
    // 回城补给是瞬间完成的，所以挂机图上的时间就是全部时间，死亡等待和回城都算在里面
    const field = (fields[bestField(world)] ??= { seconds: 0, exp: 0, gold: 0, estimatedExp: 0, estimatedGold: 0 });
    estimateLeft -= TICK_SECONDS;
    if (estimateLeft <= 0) {
      estimateLeft = ESTIMATE_SECONDS;
      estimate = estimateIncome(config, config.maps[bestField(world)]!, world.offlineFighter());
    }
    field.seconds += TICK_SECONDS;
    field.estimatedExp += estimate.expPerSecond * TICK_SECONDS * OFFLINE_EFFICIENCY;
    field.estimatedGold += estimate.goldPerSecond * TICK_SECONDS * OFFLINE_EFFICIENCY;
    for (const event of world.drainEvents()) {
      if (event.type === 'levelUp') levelTimes[event.level] = world.time;
      else if (event.type === 'death' && event.unit === player) deaths += 1;
      else if (event.type === 'pickedUp' && event.item.equipment) equipment += 1;
      else if (event.type === 'expGained') field.exp += event.amount;
      else if (event.type === 'pickedUp' && event.item.def.kind === 'gold') field.gold += event.item.amount;
    }

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

  return {
    classId,
    seed,
    levelTimes,
    hours: world.time / 3600,
    level: player.level,
    deaths,
    recalls,
    gold: player.gold,
    equipment,
    fields,
  };
}

/** 子进程：跑一个职业的一个种子，结果用 JSON 写回父进程 */
const job = process.env.SIM_JOB;
if (job) {
  const [classId, seed] = job.split(':');
  process.stdout.write(JSON.stringify(simulate(classId!, Number(seed))));
  process.exit(0);
}

function runJob(classId: string, seed: number): Promise<Result> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url), ...args],
      { env: { ...process.env, SIM_JOB: `${classId}:${seed}` }, maxBuffer: 1 << 24 },
      (error, stdout) => (error ? reject(error) : resolve(JSON.parse(stdout) as Result)),
    );
  });
}

async function runAll(jobs: [string, number][]): Promise<Result[]> {
  const results: Result[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [classId, seed] = jobs[next++]!;
      results.push(await runJob(classId, seed));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, availableParallelism() - 1) }, worker));
  return results;
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const round = (value: number) => Math.round(value).toLocaleString('en-US');
const hours = (seconds: number) => (seconds / 3600).toFixed(1);

const seeds = Array.from({ length: SEED_COUNT }, (_, index) => index + 1);
const classIds = Object.keys(config.classes);
const started = Date.now();
const results = await runAll(classIds.flatMap((classId) => seeds.map((seed): [string, number] => [classId, seed])));

console.log(
  `模拟：挂机到 ${TARGET_LEVEL} 级，最多 ${MAX_HOURS} 小时，每职业 ${SEED_COUNT} 个种子，` +
    `用时 ${Math.round((Date.now() - started) / 1000)} 秒。括号里是最快和最慢。\n`,
);
/** 表里列出的等级：各章节的分界，挂到 40 级以上时补上新章节的 */
const MARKS = [13, 26, 30, 34, 37, 40, 43, 45, 48, 50, 53, 55, 58, 60, 63, 65, 68, 70].filter((level) => level <= TARGET_LEVEL);
console.log(`| 职业 | ${MARKS.map((level) => `到 ${level} 级`).join(' | ')} | 死亡 | 回城 | 法器 |`);
console.log(`|${' --- |'.repeat(MARKS.length + 4)}`);
const byClass = classIds.map((classId) => results.filter((result) => result.classId === classId));
for (const runs of byClass) {
  const at = (level: number) => {
    const times = runs.map((run) => run.levelTimes[level]).filter((time) => time !== undefined);
    if (times.length < runs.length) return '未到';
    return `${hours(mean(times))}（${hours(Math.min(...times))}-${hours(Math.max(...times))}）`;
  };
  console.log(
    `| ${config.classes[runs[0]!.classId]!.name} | ${MARKS.map(at).join(' | ')} | ` +
      `${round(mean(runs.map((run) => run.deaths)))} | ${round(mean(runs.map((run) => run.recalls)))} | ` +
      `${round(mean(runs.map((run) => run.equipment)))} |`,
  );
}

console.log('\n闭关估算对比：按挂机图分开算，闭关收益应接近同一张图挂机实测的 50%。\n');
const fieldOrder = [...FIELDS].reverse().map(([, mapId]) => mapId);
console.log(`| 挂机图 | ${byClass.map((runs) => `${config.classes[runs[0]!.classId]!.name} 经验 | 灵石`).join(' | ')} |`);
console.log(`|${' --- |'.repeat(1 + byClass.length * 2)}`);
for (const mapId of fieldOrder) {
  const cells = byClass.map((runs) => {
    const sum = (key: keyof FieldIncome) => runs.reduce((total, run) => total + (run.fields[mapId]?.[key] ?? 0), 0);
    if (sum('seconds') / runs.length < FIELD_MIN_HOURS * 3600) return '- | -';
    const ratio = (offline: number, online: number) => (online > 0 ? `${Math.round((offline / online) * 100)}%` : '-');
    return `${ratio(sum('estimatedExp'), sum('exp'))} | ${ratio(sum('estimatedGold'), sum('gold'))}`;
  });
  if (cells.every((cell) => cell === '- | -')) continue;
  console.log(`| ${config.maps[mapId]!.name} | ${cells.join(' | ')} |`);
}

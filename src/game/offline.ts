import { hitChance } from './combat';
import { monsterDrops, type CombatStats, type GameConfig, type MapDef, type MonsterDef, type SkillDef } from './config';

export const OFFLINE_MAX_SECONDS = 8 * 3600;
export const OFFLINE_EFFICIENCY = 0.5;
export const OFFLINE_MIN_SECONDS = 60;
export const OFFLINE_MAX_EQUIPMENT = 10;
/** 每杀一只怪在路上和拾取花的时间，大地图上怪物稀疏，路要走得久一些 */
const TRAVEL_SECONDS = 4;
/** 和 world.ts 的灵力回复一致 */
const MANA_REGEN_PER_SECOND = 0.03;
/** 挂机时功法不会每次都在冷却结束就放，召唤物也会死，按模拟实测打折 */
const SKILL_UPTIME = 0.7;
const SUMMON_UPTIME = 0.2;

/** 估算收益要用到的角色数据。 */
export interface Fighter {
  stats: CombatStats;
  primary: 'attack' | 'magic' | 'dao';
  attackInterval: number;
  /** 已学会的功法和它的威力倍数 */
  skills: { skill: SkillDef; power: number }[];
}

export interface IncomeRates {
  expPerSecond: number;
  goldPerSecond: number;
  killsPerSecond: number;
  /** 每杀一只怪平均掉落的法器件数，按物品分开 */
  equipmentPerKill: Record<string, number>;
}

/** 地面功法的持续时间里，怪站在上面的比例 */
const FIELD_UPTIME = 0.4;

function average(range: { min: number; max: number }): number {
  return (range.min + range.max) / 2;
}

/**
 * 估算对一只怪的每秒伤害：普攻加上功法。
 * 功法按每点灵力的伤害从高到低排，灵力回复跟不上时少放；放功法的时间不再普攻。
 */
function damagePerSecond(config: GameConfig, fighter: Fighter, monster: MonsterDef): number {
  const { stats, primary, attackInterval } = fighter;
  const defenseOf = (stat: 'attack' | 'magic' | 'dao') =>
    average(stat === 'attack' ? monster.stats.defense : monster.stats.magicDefense);
  const hit = hitChance(stats, monster.stats);
  const basic = (Math.max(1, average(stats[primary]) - defenseOf(primary)) * hit) / attackInterval;

  let summon = 0;
  const casts: { damage: number; rate: number; mana: number }[] = [];
  let poison: (typeof casts)[number] | null = null;
  for (const { skill, power } of fighter.skills) {
    const { effect } = skill;
    if (effect.type === 'damage' || effect.type === 'charge') {
      const damage = Math.max(1, average(stats[effect.stat]) * effect.multiplier * power - defenseOf(effect.stat)) * hit;
      casts.push({ damage, rate: 1 / Math.max(skill.cooldown, attackInterval), mana: skill.mpCost });
    } else if (effect.type === 'dot') {
      // 同一施法者的毒会互相顶替，只算最强的一门；毒跳完之前怪往往已经死了，按半管血封顶
      const total = stats[effect.stat].max * effect.multiplier * power * (effect.duration / effect.interval);
      const damage = Math.min(total, monster.stats.maxHp / 2);
      if (!poison || damage > poison.damage) {
        poison = { damage, rate: 1 / Math.max(skill.cooldown, effect.duration), mana: skill.mpCost };
      }
    } else if (effect.type === 'field') {
      const perTick = Math.max(1, average(stats[effect.stat]) * effect.multiplier * power - defenseOf(effect.stat)) * hit;
      // 怪会追着人走出地面，按四成时间站在上面估算
      const damage = Math.min(perTick * (effect.duration / effect.interval) * FIELD_UPTIME, monster.stats.maxHp);
      casts.push({ damage, rate: 1 / Math.max(skill.cooldown, attackInterval), mana: skill.mpCost });
    } else if (effect.type === 'summon') {
      const pet = config.monsters[effect.monster];
      if (!pet) continue;
      const perHit = Math.max(1, average(stats.dao) - average(monster.stats.defense));
      summon = Math.max(summon, (perHit * hitChance(stats, monster.stats)) / pet.attackInterval);
    }
  }

  if (poison) casts.push(poison);
  let mana = stats.maxMp * MANA_REGEN_PER_SECOND;
  let busy = 0;
  let skillDamage = 0;
  casts.sort((a, b) => b.damage / Math.max(1, b.mana) - a.damage / Math.max(1, a.mana));
  for (const cast of casts) {
    const rate = cast.mana > 0 ? Math.min(cast.rate, mana / cast.mana) : cast.rate;
    mana -= rate * cast.mana;
    busy += rate * attackInterval;
    skillDamage += rate * cast.damage;
  }
  return basic * Math.max(0, 1 - busy) + skillDamage * SKILL_UPTIME + summon * SUMMON_UPTIME;
}

/** 估算在这张地图挂机的每秒收益，不算 Boss。 */
export function estimateIncome(config: GameConfig, map: MapDef, fighter: Fighter): IncomeRates {
  let seconds = 0;
  let exp = 0;
  let gold = 0;
  let kills = 0;
  const equipment: Record<string, number> = {};
  for (const spawn of map.spawns) {
    const monster = config.monsters[spawn.monster];
    if (!monster || monster.boss) continue;
    seconds += monster.stats.maxHp / damagePerSecond(config, fighter, monster) + TRAVEL_SECONDS;
    exp += monster.exp;
    kills += 1;
    for (const entry of monsterDrops(config, monster)) {
      if (entry.item === 'gold') {
        gold += entry.chance * average({ min: entry.min ?? 1, max: entry.max ?? 1 });
      } else if (config.items[entry.item]?.kind === 'equip') {
        equipment[entry.item] = (equipment[entry.item] ?? 0) + entry.chance;
      }
    }
  }
  if (kills === 0) {
    return { expPerSecond: 0, goldPerSecond: 0, killsPerSecond: 0, equipmentPerKill: {} };
  }
  for (const item of Object.keys(equipment)) equipment[item]! /= kills;
  return {
    expPerSecond: exp / seconds,
    goldPerSecond: gold / seconds,
    killsPerSecond: kills / seconds,
    equipmentPerKill: equipment,
  };
}

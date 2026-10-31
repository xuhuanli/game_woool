import type { CombatStats, DamageStat } from './config';
import type { Rng } from './rng';

export interface AttackResult {
  hit: boolean;
  damage: number;
  /** 掷出了攻击上限 */
  maxRoll: boolean;
}

export interface AttackOptions {
  stat?: DamageStat;
  multiplier?: number;
}

const LUCK_PER_POINT = 0.1;

export function hitChance(attacker: CombatStats, target: CombatStats): number {
  return attacker.accuracy / (attacker.accuracy + target.evasion);
}

export function rollAttack(
  attacker: CombatStats,
  target: CombatStats,
  rng: Rng,
  { stat = 'attack', multiplier = 1 }: AttackOptions = {},
): AttackResult {
  if (!rng.chance(hitChance(attacker, target))) return { hit: false, damage: 0, maxRoll: false };

  const { min, max } = attacker[stat];
  const lucky = rng.chance(attacker.luck * LUCK_PER_POINT);
  const attackRoll = lucky ? max : rng.int(min, max);
  const defense = stat === 'attack' ? target.defense : target.magicDefense;
  const defenseRoll = rng.int(defense.min, defense.max);
  return {
    hit: true,
    damage: Math.max(1, Math.round(attackRoll * multiplier) - defenseRoll),
    maxRoll: attackRoll === max,
  };
}

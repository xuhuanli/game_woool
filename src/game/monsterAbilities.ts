import type { AttackOptions } from './combat';
import type { AbilityDef, Cell, GameConfig, MonsterDef } from './config';
import type { GroundFields } from './fields';
import { cellDistance, direction, sameCell, type Grid } from './grid';
import type { GameEvent, Monster, Player, Summon, Unit } from './types';

/** 怪物技能结算要用到的世界接口。 */
export interface AbilityHost {
  readonly config: GameConfig;
  readonly grid: Grid;
  readonly player: Player;
  readonly summons: Summon[];
  readonly monsters: Monster[];
  readonly fields: GroundFields;
  isFree(cell: Cell, unit: Unit): boolean;
  isStepping(unit: Unit): boolean;
  hit(attacker: Unit, target: Unit, options: AttackOptions): void;
  spawnMinion(def: MonsterDef, cell: Cell): void;
  emit(event: GameEvent): void;
}

/** 怪物和 Boss 的技能：前摇预警、结算、召唤、地面和阶段狂暴。 */
export class MonsterAbilities {
  constructor(private readonly host: AbilityHost) {}

  /** 有技能可用时开始前摇，并在地面预警。 */
  tryAbility(monster: Monster, target: Unit): boolean {
    const { host } = this;
    if (host.isStepping(monster)) return false;
    const distance = cellDistance(monster.cell, target.cell);
    const ability = monster.def.abilities?.find(
      (candidate) => distance <= candidate.range && (monster.abilityCooldowns[candidate.id] ?? 0) <= 0,
    );
    if (!ability) return false;
    const cells = abilityArea(ability, monster.cell, target.cell);
    monster.abilityCooldowns[ability.id] = ability.cooldown;
    monster.windupLeft = ability.windup;
    monster.pending = { target, skill: null, ability, cells };
    monster.facing = direction(monster.cell, target.cell);
    monster.path = [];
    host.emit({ type: 'attackStart', unit: monster, target: null, color: null });
    host.emit({ type: 'telegraph', name: ability.name, cells, seconds: ability.windup, color: ability.color });
    return true;
  }

  resolve(caster: Unit, ability: AbilityDef, cells: Cell[]): void {
    const { host } = this;
    if (ability.summon) {
      this.summonMinions(caster, ability.summon.monster, ability.summon.count);
      return;
    }
    if (ability.field) {
      // 地面留下来慢慢伤人，第一跳在落地时生效
      host.fields.add({
        caster,
        cells,
        duration: ability.field.duration,
        interval: ability.field.interval,
        stat: 'attack',
        multiplier: ability.multiplier,
        color: ability.color,
        hostile: true,
      });
      return;
    }
    if (ability.charge) {
      const target = cells[0];
      const landing = target && host.grid.nearest(target, (c) => host.isFree(c, caster));
      if (landing) {
        caster.cell = { ...landing };
        caster.pos = { ...landing };
        caster.path = [];
      }
    }
    for (const unit of [host.player, ...host.summons]) {
      if (unit.hp <= 0 || !cells.some((cell) => sameCell(cell, unit.cell))) continue;
      host.hit(caster, unit, { stat: 'attack', multiplier: ability.multiplier });
      if (ability.poison && unit.hp > 0) {
        unit.effects = unit.effects.filter((e) => e.kind !== 'dot' || e.source !== caster);
        unit.effects.push({
          kind: 'dot',
          left: ability.poison.duration,
          amount: ability.poison.damage,
          interval: 1,
          nextTick: 1,
          source: caster,
        });
      }
    }
  }

  private summonMinions(caster: Unit, monsterId: string, count: number): void {
    const { host } = this;
    const def = host.config.monsters[monsterId];
    if (!def) return;
    const alive = host.monsters.filter((monster) => monster.temporary && monster.hp > 0).length;
    for (let i = alive; i < count; i++) {
      const cell = host.grid.nearest(caster.cell, (c) => host.isFree(c, caster));
      if (!cell) return;
      host.spawnMinion(def, cell);
    }
  }

  /** 生命降到阈值时进入下一阶段，攻击力提高。 */
  checkPhase(monster: Monster): void {
    const next = monster.def.phases?.[monster.phase];
    if (!next || monster.hp / monster.stats.maxHp >= next.hpBelow) return;
    monster.phase += 1;
    const { attack } = monster.stats;
    monster.stats = {
      ...monster.stats,
      attack: {
        min: Math.round(attack.min * next.attackMultiplier),
        max: Math.round(attack.max * next.attackMultiplier),
      },
    };
    this.host.emit({ type: 'message', text: next.message });
  }
}

function abilityArea(ability: AbilityDef, origin: Cell, target: Cell): Cell[] {
  const { shape, size } = ability;
  if (shape === 'line') {
    const dir = direction(origin, target);
    return Array.from({ length: size }, (_, i) => ({
      x: origin.x + dir.x * (i + 1),
      y: origin.y + dir.y * (i + 1),
    }));
  }
  const center = shape === 'around' ? origin : target;
  const cells: Cell[] = [];
  for (let y = center.y - size; y <= center.y + size; y++) {
    for (let x = center.x - size; x <= center.x + size; x++) cells.push({ x, y });
  }
  return cells;
}

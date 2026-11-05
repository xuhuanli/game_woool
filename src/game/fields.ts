import type { AttackOptions } from './combat';
import type { Cell, DamageStat } from './config';
import { sameCell } from './grid';
import type { Field, Unit } from './types';

/** 地面伤害结算要用到的世界接口。 */
export interface FieldHost {
  /** 站在地面上可能被伤到的单位，hostile 表示怪物放的地面 */
  targets(hostile: boolean): Unit[];
  hit(attacker: Unit, target: Unit, options: AttackOptions): void;
}

export interface FieldSpec {
  caster: Unit;
  cells: Cell[];
  duration: number;
  interval: number;
  stat: DamageStat;
  multiplier: number;
  color: string;
  hostile: boolean;
}

/** 留在地上持续伤害的区域：玩家的火墙、瘴毒，Boss 的血海。 */
export class GroundFields {
  list: Field[] = [];
  private nextId = 1;

  add(spec: FieldSpec): void {
    if (spec.cells.length === 0) return;
    const { duration, ...rest } = spec;
    this.list.push({ ...rest, id: this.nextId++, left: duration, nextTick: 0 });
  }

  clear(): void {
    this.list = [];
  }

  /** 每跳伤害站在上面的单位，第一跳在放下时立即生效。 */
  tick(dt: number, host: FieldHost): void {
    if (this.list.length === 0) return;
    for (const field of this.list) {
      field.left -= dt;
      field.nextTick -= dt;
      if (field.nextTick > 0) continue;
      field.nextTick += field.interval;
      for (const unit of host.targets(field.hostile)) {
        if (unit.hp > 0 && field.cells.some((cell) => sameCell(cell, unit.cell))) {
          host.hit(field.caster, unit, { stat: field.stat, multiplier: field.multiplier });
        }
      }
    }
    this.list = this.list.filter((field) => field.left > 0);
  }
}

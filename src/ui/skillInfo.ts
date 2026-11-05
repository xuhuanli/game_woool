import type { DamageStat, SkillDef } from '../game/config';
import type { World } from '../game/world';
import { line } from './tooltip';

const STAT_NAMES: Record<DamageStat, string> = { attack: '攻击', magic: '魔法', dao: '道术' };

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** 按当前属性和领悟层数算出的技能数值，伤害未扣目标防御。 */
export function skillDetail(world: World, skill: SkillDef): HTMLElement[] {
  const { player, config, inventory } = world;
  const learned = player.skills.includes(skill.id);
  const level = player.skillLevels[skill.id] ?? 1;
  const power = inventory.skillPower(skill.id);
  const { maxLevel, powerPerLevel } = config.game.skillUpgrade;
  const range = (stat: DamageStat, multiplier: number) => {
    const { min, max } = player.stats[stat];
    return `${Math.round(min * multiplier)}-${Math.round(max * multiplier)}`;
  };
  const hit = (stat: DamageStat, multiplier: number) =>
    `${range(stat, multiplier * power)} 点伤害（${STAT_NAMES[stat]}的 ${percent(multiplier * power)}）`;

  const lines: HTMLElement[] = [line(skill.name, 'tooltip-name')];
  lines.push(
    line(learned ? `第 ${level} 层${power > 1 ? `，威力 +${percent(power - 1)}` : ''}` : `${skill.level} 级可研读`, 'tooltip-hint'),
  );
  const effect = skill.effect;
  switch (effect.type) {
    case 'damage': {
      const size = effect.size ?? 1;
      const area = {
        single: '攻击单个目标',
        line: `攻击面前一条直线 ${size} 格`,
        around: `攻击身边 ${size} 格内所有敌人`,
        circle: `攻击目标周围 ${size} 格内所有敌人`,
      }[effect.shape];
      lines.push(line(area), line(`造成 ${hit(effect.stat, effect.multiplier)}`));
      if (effect.knockback) lines.push(line(`把敌人击退 ${effect.knockback} 格`));
      break;
    }
    case 'dot': {
      const tick = Math.max(1, Math.round(player.stats[effect.stat].max * effect.multiplier * power));
      const ticks = Math.floor(effect.duration / effect.interval);
      lines.push(
        line(`每 ${effect.interval} 秒造成 ${tick} 点伤害，无视防御`),
        line(`持续 ${effect.duration} 秒，共约 ${tick * ticks} 点`),
      );
      break;
    }
    case 'heal': {
      const { min, max } = player.stats[effect.stat];
      const low = Math.round(min * effect.multiplier) + effect.flat;
      const high = Math.round(max * effect.multiplier) + effect.flat;
      lines.push(line(`回复 ${low}-${high} 点生命（${STAT_NAMES[effect.stat]}的 ${percent(effect.multiplier)} + ${effect.flat}）`));
      break;
    }
    case 'shield':
      lines.push(line(`受到的伤害减少 ${percent(effect.reduction)}，持续 ${effect.duration} 秒`));
      break;
    case 'defense':
      lines.push(line(`防御 +${effect.amount}，持续 ${effect.duration} 秒`));
      break;
    case 'empower':
      lines.push(line(`造成的伤害 +${percent(effect.multiplier)}，持续 ${effect.duration} 秒`));
      break;
    case 'summon': {
      const monster = config.monsters[effect.monster];
      const hp = (monster?.stats.maxHp ?? 0) + effect.hpPerLevel * player.level;
      const { min, max } = player.stats.dao;
      lines.push(
        line(`召唤${monster?.name ?? ''}协助作战，持续 ${effect.duration} 秒`),
        line(`生命 ${hp}，攻击 ${min}-${max}（随道术）`),
      );
      break;
    }
    case 'charge':
      lines.push(
        line(`冲到 ${skill.range} 格内的敌人身前，震击目标和身边一圈`),
        line(`造成 ${hit(effect.stat, effect.multiplier)}`),
        line(`定身 ${effect.stun} 秒`),
      );
      break;
    case 'field': {
      const ticks = Math.floor(effect.duration / effect.interval);
      lines.push(
        line(`在目标周围 ${effect.size} 格留下一片地面，持续 ${effect.duration} 秒`),
        line(`每 ${effect.interval} 秒造成 ${hit(effect.stat, effect.multiplier)}，共 ${ticks} 次`),
      );
      break;
    }
  }
  const reach = skill.range > 1 && effect.type !== 'charge' ? `射程 ${skill.range} 格 · ` : '';
  lines.push(line(`${reach}灵力 ${skill.mpCost} · 冷却 ${skill.cooldown} 秒 · 施法 ${skill.windup} 秒`, 'tooltip-hint'));
  const replaced = skill.replaces && config.skills[skill.replaces];
  if (replaced) lines.push(line(`进阶自${replaced.name}，学会后替换它`, 'tooltip-hint'));
  if (learned && level < maxLevel) {
    lines.push(line(`修炼到第 ${level + 1} 层：威力再 +${percent(powerPerLevel)}`, 'tooltip-hint'));
  }
  return lines;
}

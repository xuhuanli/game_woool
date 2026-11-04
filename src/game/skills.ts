import type { Cell, SkillDef } from './config';

/** 需要先选中敌人才能释放的技能。 */
export function needsTarget(skill: SkillDef): boolean {
  const { effect } = skill;
  if (effect.type === 'dot' || effect.type === 'field' || effect.type === 'charge') return true;
  return effect.type === 'damage' && effect.shape !== 'around';
}

/** 计算伤害技能覆盖的格子。 */
export function skillArea(skill: SkillDef, origin: Cell, target: Cell | null): Cell[] {
  const { effect } = skill;
  if (effect.type !== 'damage' && effect.type !== 'dot' && effect.type !== 'field' && effect.type !== 'charge') return [];
  if (effect.type === 'dot' || effect.type === 'charge' || (effect.type === 'damage' && effect.shape === 'single')) {
    return target ? [target] : [];
  }

  const size = effect.size ?? 1;
  if (effect.type === 'damage' && effect.shape === 'line') {
    if (!target) return [];
    const dx = Math.sign(target.x - origin.x);
    const dy = Math.sign(target.y - origin.y);
    return Array.from({ length: size }, (_, i) => ({
      x: origin.x + dx * (i + 1),
      y: origin.y + dy * (i + 1),
    }));
  }

  const around = effect.type === 'damage' && effect.shape === 'around';
  const center = around ? origin : target;
  if (!center) return [];
  const cells: Cell[] = [];
  for (let y = center.y - size; y <= center.y + size; y++) {
    for (let x = center.x - size; x <= center.x + size; x++) {
      if (!around || x !== center.x || y !== center.y) cells.push({ x, y });
    }
  }
  return cells;
}

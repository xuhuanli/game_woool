import type { SkillDef, SkillEffect } from '../game/config';
import type { World } from '../game/world';

function describeEffect(effect: SkillEffect, range: number): string {
  const reach = range > 1 ? `，射程 ${range}` : '';
  switch (effect.type) {
    case 'damage': {
      const size = effect.size ?? 1;
      const shape = {
        single: '单体伤害',
        line: `直线 ${size} 格伤害`,
        around: `身边 ${size} 格伤害`,
        circle: `目标周围 ${size} 格伤害`,
      }[effect.shape];
      const push = effect.knockback ? `，击退 ${effect.knockback} 格` : '';
      return `${shape}，${Math.round(effect.multiplier * 100)}%${push}${reach}`;
    }
    case 'dot':
      return `持续 ${effect.duration} 秒毒伤${reach}`;
    case 'heal':
      return '回复生命';
    case 'shield':
      return `减伤 ${Math.round(effect.reduction * 100)}%，持续 ${effect.duration} 秒`;
    case 'defense':
      return `防御 +${effect.amount}，持续 ${effect.duration} 秒`;
    case 'empower':
      return `伤害 +${Math.round(effect.multiplier * 100)}%，持续 ${effect.duration} 秒`;
    case 'summon':
      return `召唤协助作战，持续 ${effect.duration} 秒`;
    case 'field':
      return `目标周围 ${effect.size} 格留下地面，每 ${effect.interval} 秒 ${Math.round(effect.multiplier * 100)}%，持续 ${effect.duration} 秒${reach}`;
  }
}

/** 功法面板：列出本职业全部功法和领悟等级。K 键开关。 */
export class SkillPanel {
  private readonly panel = document.createElement('section');

  constructor(private readonly world: World) {
    this.panel.className = 'panel panel-skills';
    this.panel.hidden = true;
    document.getElementById('hud')!.append(this.panel);
    document.getElementById('hud-open-skills')!.addEventListener('click', () => this.toggle());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'k' || event.key === 'K') this.toggle();
      else if (event.key === 'Escape') this.panel.hidden = true;
    });
  }

  private toggle(): void {
    this.panel.hidden = !this.panel.hidden;
    if (!this.panel.hidden) this.render();
  }

  private render(): void {
    const { player, config } = this.world;
    const title = document.createElement('header');
    title.className = 'panel-title';
    title.textContent = `功法 · ${player.def.name}`;
    const skills = Object.values(config.skills)
      .filter((skill) => skill.classId === player.def.id)
      .sort((a, b) => a.level - b.level);
    this.panel.replaceChildren(title, ...skills.map((skill) => this.row(skill)));
  }

  private row(skill: SkillDef): HTMLElement {
    const learned = this.world.player.skills.includes(skill.id);
    const row = document.createElement('div');
    row.className = learned ? 'skill-row' : 'skill-row locked';
    const name = document.createElement('b');
    name.textContent = skill.name;
    const state = document.createElement('span');
    const level = this.world.player.skillLevels[skill.id] ?? 1;
    const power = Math.round((this.world.inventory.skillPower(skill.id) - 1) * 100);
    const bonus = power > 0 ? `，威力 +${power}%` : '';
    state.textContent = learned ? `${level} 层 · 灵力 ${skill.mpCost}${bonus}` : `${skill.level} 级可研读《${skill.name}》`;
    const detail = document.createElement('small');
    detail.textContent = `${describeEffect(skill.effect, skill.range)}，冷却 ${skill.cooldown} 秒`;
    row.append(name, state, detail);
    const { maxLevel, goldCost, material } = this.world.config.game.skillUpgrade;
    if (learned && level < maxLevel) {
      const upgrade = document.createElement('button');
      upgrade.className = 'detail-action';
      upgrade.textContent = `修炼（${this.world.config.items[material]?.name} 1，灵石 ${goldCost}）`;
      upgrade.addEventListener('click', () => {
        this.world.inventory.upgradeSkill(skill.id);
        this.render();
      });
      row.append(upgrade);
    }
    return row;
  }
}

import type { SkillDef } from './config';
import { cellDistance, sameCell } from './grid';
import type { AutoSettings, GroundItem, Monster } from './types';
import type { World } from './world';

const THINK_SECONDS = 0.25;
const MANUAL_PAUSE_SECONDS = 3;
const PICKUP_RADIUS = 10;
const MANA_POTION_BELOW = 0.25;
const HEAL_SKILL_BELOW = 0.7;

export function defaultAutoSettings(): AutoSettings {
  return { enabled: false, minGrade: 'low', potionBelow: 0.5, recallBelow: 0.2 };
}

/** 自动挂机：吃药、放技能、拾取、打怪。不打 Boss，低血时回城并关闭挂机。 */
export class AutoPlay {
  private thinkLeft = 0;
  private pauseLeft = 0;
  private readonly unreachable = new Set<number>();

  constructor(private readonly world: World) {}

  get active(): boolean {
    return this.world.player.auto.enabled;
  }

  /** 玩家手动移动后暂停一会儿，避免挂机马上抢回操作。 */
  pauseForManualInput(): void {
    this.pauseLeft = MANUAL_PAUSE_SECONDS;
  }

  tick(dt: number): void {
    const { world } = this;
    const { player } = world;
    if (!player.auto.enabled || !player.hp || world.map.safe) return;
    this.pauseLeft = Math.max(0, this.pauseLeft - dt);
    this.thinkLeft -= dt;
    if (this.thinkLeft > 0) return;
    this.thinkLeft = THINK_SECONDS;

    const health = player.hp / player.stats.maxHp;
    const healed = this.usePotions(health);
    if (!healed && player.auto.recallBelow > 0 && health < player.auto.recallBelow) {
      player.auto.enabled = false;
      world.recall();
      return;
    }
    if (this.pauseLeft > 0 || player.windupLeft > 0) return;

    const target = this.currentTarget();
    if (target) this.useSkills(target, health);
    if (player.order) return;

    const item = this.nearestWantedItem();
    if (item) {
      world.pickup(item);
      if (player.path.length === 0 && !sameCell(player.cell, item.cell)) {
        this.unreachable.add(item.id);
      }
      return;
    }
    const monster = this.nearestMonster();
    if (monster) world.attack(monster);
  }

  private currentTarget(): Monster | null {
    const { order } = this.world.player;
    return order?.type === 'attack' || order?.type === 'cast' ? order.target : null;
  }

  /** 需要时吃药，吃了回血丹药时返回 true。 */
  private usePotions(health: number): boolean {
    const { player, config, inventory } = this.world;
    const mana = player.stats.maxMp > 0 ? player.mp / player.stats.maxMp : 1;
    for (const itemId of Object.keys(player.bag)) {
      const item = config.items[itemId];
      const wanted =
        (item?.heal && health < player.auto.potionBelow) ||
        (item?.mana && mana < MANA_POTION_BELOW);
      if (wanted) {
        inventory.useItem(itemId);
        return !!item?.heal;
      }
    }
    return false;
  }

  private useSkills(target: Monster, health: number): void {
    const { world } = this;
    const { player, config } = world;
    for (const entry of player.hotbar) {
      if (entry?.kind !== 'skill') continue;
      const skill = config.skills[entry.id];
      if (!skill || (player.skillCooldowns[skill.id] ?? 0) > 0 || player.mp < skill.mpCost) continue;
      if (this.shouldCast(skill, target, health)) {
        world.castSkill(skill.id, target);
        return;
      }
    }
  }

  private shouldCast(skill: SkillDef, target: Monster, health: number): boolean {
    const { player, summons } = this.world;
    const distance = cellDistance(player.cell, target.cell);
    const { effect } = skill;
    switch (effect.type) {
      case 'damage':
        return distance <= (effect.shape === 'around' ? (effect.size ?? 1) : skill.range);
      case 'dot':
        return !target.effects.some((active) => active.kind === 'dot' && active.source === player);
      case 'heal':
        return health < HEAL_SKILL_BELOW;
      case 'shield':
      case 'defense':
      case 'empower':
        return !player.effects.some((active) => active.kind === effect.type);
      case 'summon':
        return summons.length === 0;
    }
  }

  private nearestWantedItem(): GroundItem | null {
    const { world } = this;
    const { player, config } = world;
    const { grades } = config.affixes;
    const lowest = grades.findIndex((grade) => grade.id === player.auto.minGrade);
    const bagFull = player.equipBag.length >= config.affixes.bagCapacity;
    let best: GroundItem | null = null;
    let bestDistance = PICKUP_RADIUS + 1;
    for (const item of world.items) {
      if (this.unreachable.has(item.id)) continue;
      if (item.equipment) {
        const rank = grades.findIndex((grade) => grade.id === item.equipment?.grade);
        if (bagFull || rank < lowest) continue;
      }
      const distance = cellDistance(player.cell, item.cell);
      if (distance < bestDistance) {
        best = item;
        bestDistance = distance;
      }
    }
    return best;
  }

  private nearestMonster(): Monster | null {
    const { world } = this;
    let best: Monster | null = null;
    let bestDistance = Infinity;
    for (const monster of world.monsters) {
      if (!monster.hp || monster.def.boss) continue;
      const distance = cellDistance(world.player.cell, monster.cell);
      if (distance < bestDistance) {
        best = monster;
        bestDistance = distance;
      }
    }
    return best;
  }
}

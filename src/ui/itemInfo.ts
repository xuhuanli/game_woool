import { isBound, type BonusStat, type SetDef, type SpecialDef } from '../game/config';
import {
  EQUIP_SLOTS,
  equipmentBonuses,
  equipmentColor,
  equipmentName,
  slotsFor,
  type EquipSlot,
  type Equipment,
} from '../game/equipment';
import { itemSources } from '../game/sources';
import type { World } from '../game/world';
import { line } from './tooltip';

const STAT_NAMES: Record<Exclude<BonusStat, 'primary'>, string> = {
  maxHp: '生命',
  maxMp: '灵力',
  attack: '攻击',
  magic: '魔法',
  dao: '道术',
  defense: '防御',
  magicDefense: '魔防',
  accuracy: '命中',
  evasion: '闪避',
  luck: '幸运',
};

const SCROLL_TEXT = {
  recall: '回到主城',
  random: '在当前地图随机传送',
  fly: '点任务栏右侧的靴子图标，直接飞到任务目的地，到了自动挂机',
};

export type ItemRef = { kind: 'equipment'; uid: number } | { kind: 'stack'; id: string };

/** 背包或身上找到这件法器，身上的同时给出栏位。 */
export function findEquipment(world: World, uid: number): { equipment: Equipment; slot: EquipSlot | null } | null {
  const { player } = world;
  const slot = EQUIP_SLOTS.find((candidate) => player.equipment[candidate]?.uid === uid);
  if (slot) return { equipment: player.equipment[slot]!, slot };
  const equipment = player.equipBag.find((candidate) => candidate.uid === uid);
  return equipment ? { equipment, slot: null } : null;
}

export function bonusName(world: World, stat: BonusStat): string {
  return STAT_NAMES[stat === 'primary' ? world.player.def.primaryStat : stat];
}

/** 物品的完整说明：属性、特效、套装、来源，背包里的法器再和身上的对比。 */
export function itemDetail(world: World, ref: ItemRef): HTMLElement[] {
  return ref.kind === 'stack' ? stackDetail(world, ref.id) : equipmentDetail(world, ref.uid);
}

function stackDetail(world: World, itemId: string): HTMLElement[] {
  const { config, player } = world;
  const item = config.items[itemId];
  if (!item) return [];
  const lines = [line(item.name, 'tooltip-name'), line(`数量 ${player.bag[itemId] ?? 0}`, 'tooltip-hint')];
  if (item.heal) lines.push(line(`回复 ${item.heal} 点生命`));
  if (item.mana) lines.push(line(`回复 ${item.mana} 点灵力`));
  if (item.id === config.affixes.refine.material) lines.push(line('用于祭炼武器'));
  else if (item.id === config.game.skillUpgrade.material) lines.push(line('用于修炼功法'));
  else {
    const quests = questsCollecting(world, item.id);
    if (quests.length) lines.push(line(`任务材料：${quests.join('、')}`));
  }
  const brews = config.garden.recipes.filter((recipe) => recipe.materials.some((material) => material.item === item.id));
  if (brews.length) lines.push(line(`炼丹材料：${brews.map((recipe) => config.items[recipe.output]?.name).join('、')}（药园面板 G）`));
  if (item.seed) lines.push(line(`种下长出${config.items[item.seed]?.name ?? ''}，${item.level ?? 1} 级可种`));
  if (item.scroll) lines.push(line(SCROLL_TEXT[item.scroll]));
  const skill = config.skills[item.skill ?? ''];
  if (item.kind === 'book' && skill) {
    const owner = config.classes[skill.classId]?.name ?? '';
    lines.push(line(`${owner}功法，${skill.level} 级可研读`));
  }
  if (isBound(item)) lines.push(line('绑定，不能丢弃', 'tooltip-hint'));
  lines.push(sourceInfo(world, item.id));
  return lines;
}

function equipmentDetail(world: World, uid: number): HTMLElement[] {
  const { config } = world;
  const found = findEquipment(world, uid);
  const item = found && config.items[found.equipment.itemId];
  if (!found || !item) return [];
  const { equipment, slot } = found;
  const name = line(equipmentName(equipment, config), 'tooltip-name');
  name.style.color = equipmentColor(equipment, config);
  const lines = [name, line(`需要等级 ${item.level ?? 1}${slot ? ' · 已穿戴' : ''}`, 'tooltip-hint')];
  for (const bonus of equipmentBonuses(equipment, item)) {
    lines.push(line(`${bonusName(world, bonus.stat)} +${bonus.value}`));
  }
  if (item.special) lines.push(line(specialText(item.special), 'detail-special'));
  const boss = item.boss && config.monsters[item.boss];
  if (boss) lines.push(line(`${boss.name}专属，首次击败必掉，绑定`, 'detail-special'));
  const set = Object.values(config.sets).find((candidate) => candidate.pieces.includes(item.id));
  if (set) lines.push(setInfo(world, set));
  if (!slot) lines.push(comparison(world, equipment));
  lines.push(sourceInfo(world, item.id));
  return lines;
}

function questsCollecting(world: World, itemId: string): string[] {
  return Object.values(world.config.quests)
    .filter((quest) => quest.objectives.some((objective) => objective.type === 'collect' && objective.target === itemId))
    .map((quest) => quest.name);
}

function sourceInfo(world: World, itemId: string): HTMLElement {
  const sources = itemSources(world.config, world.player, itemId);
  const box = line('', 'detail-source');
  box.append(line(sources.length ? '来源：' : '来源：暂无'));
  for (const source of sources) box.append(line(`· ${source}`));
  return box;
}

function specialText(special: SpecialDef): string {
  switch (special.kind) {
    case 'stun':
      return `攻击时 ${Math.round(special.chance * 100)}% 概率定身 ${special.seconds} 秒`;
    case 'revive':
      return `致命伤时原地复活，冷却 ${special.seconds} 秒`;
    case 'manaShield':
      return `${Math.round(special.ratio * 100)}% 伤害由灵力承担`;
    case 'teleport':
      return `按 T 随机传送，冷却 ${special.seconds} 秒`;
  }
}

function setInfo(world: World, set: SetDef): HTMLElement {
  const wornItems = Object.values(world.player.equipment).map((worn) => worn.itemId);
  const count = set.pieces.filter((piece) => wornItems.includes(piece)).length;
  const box = line('', 'detail-set');
  box.append(line(`${set.name}（已穿 ${count}/${set.pieces.length}）`));
  for (const tier of set.bonuses) {
    const bonus = Object.entries(tier.bonus)
      .map(([stat, value]) => `${bonusName(world, stat as BonusStat)} +${value}`)
      .join('，');
    box.append(line(`${tier.count} 件：${bonus}`, count >= tier.count ? '' : 'tooltip-hint'));
  }
  return box;
}

/** 和同栏位已穿的法器对比，戒指和手镯取第一个栏位。 */
function comparison(world: World, equipment: Equipment): HTMLElement {
  const { items } = world.config;
  const item = items[equipment.itemId]!;
  const worn = slotsFor(item)
    .map((slot) => world.player.equipment[slot])
    .find(Boolean);
  const box = line('', 'detail-compare');
  if (!worn) {
    box.textContent = '该栏位未穿戴';
    return box;
  }
  const total = (target: Equipment) => {
    const sum = new Map<BonusStat, number>();
    for (const { stat, value } of equipmentBonuses(target, items[target.itemId]!)) {
      sum.set(stat, (sum.get(stat) ?? 0) + value);
    }
    return sum;
  };
  const next = total(equipment);
  const current = total(worn);
  box.append(line(`对比 ${equipmentName(worn, world.config)}`, 'tooltip-hint'));
  for (const stat of new Set([...next.keys(), ...current.keys()])) {
    const change = (next.get(stat) ?? 0) - (current.get(stat) ?? 0);
    if (change === 0) continue;
    const text = `${bonusName(world, stat)} ${change > 0 ? '+' : ''}${change}`;
    box.append(line(text, change > 0 ? 'detail-better' : 'detail-missing'));
  }
  return box;
}

import type { BonusStat, DamageStat, GameConfig, SetDef, SpecialDef } from '../game/config';
import {
  EQUIP_SLOTS,
  equipmentBonuses,
  equipmentColor,
  equipmentName,
  SLOT_NAMES,
  slotsFor,
  type EquipSlot,
  type Equipment,
} from '../game/equipment';
import { breakthroughChance, pendingBreakthrough, realmName } from '../game/realm';
import type { World } from '../game/world';

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

type Selection = { kind: 'equipment'; uid: number } | { kind: 'stack'; id: string } | null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

/** 角色与背包面板。只在内容变化时重建 DOM。 */
export class Panels {
  private readonly character = el('section', 'panel panel-character');
  private readonly bag = el('section', 'panel panel-bag');
  private selection: Selection = null;
  private signature = '';

  constructor(
    private readonly world: World,
    private readonly config: GameConfig,
  ) {
    const hud = document.getElementById('hud')!;
    this.character.hidden = true;
    this.bag.hidden = true;
    hud.append(this.character, this.bag);

    document.getElementById('hud-open-character')!.addEventListener('click', () => {
      this.toggle(this.character);
    });
    document.getElementById('hud-open-bag')!.addEventListener('click', () => this.toggle(this.bag));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'c' || event.key === 'C') this.toggle(this.character);
      else if (event.key === 'b' || event.key === 'B') this.toggle(this.bag);
      else if (event.key === 'Escape') this.closeAll();
    });
  }

  update(): void {
    if (this.character.hidden && this.bag.hidden) return;
    const { player } = this.world;
    const signature = JSON.stringify([
      player.equipment,
      player.equipBag,
      player.bag,
      player.stats,
      player.level,
      player.exp,
      player.realmPassed,
      player.breakthroughFails,
      player.gold,
      this.selection,
      this.character.hidden,
      this.bag.hidden,
    ]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.renderCharacter();
    this.renderBag();
  }

  private toggle(panel: HTMLElement): void {
    panel.hidden = !panel.hidden;
    if (panel.hidden && this.character.hidden && this.bag.hidden) this.selection = null;
  }

  private closeAll(): void {
    this.character.hidden = true;
    this.bag.hidden = true;
    this.selection = null;
  }

  private select(selection: Selection): void {
    this.selection = selection;
  }

  // ---- 角色面板 ----

  private renderCharacter(): void {
    const { player } = this.world;
    const stats = player.stats;
    const range = (key: DamageStat | 'defense' | 'magicDefense') =>
      `${stats[key].min}-${stats[key].max}`;

    const slots = el('div', 'slots');
    for (const slot of EQUIP_SLOTS) slots.append(this.slotRow(slot));

    const sheet = el('dl', 'sheet');
    const rows: [string, string][] = [
      ['境界', realmName(this.config.realms, player.level)],
      ['生命', String(stats.maxHp)],
      ['灵力', String(stats.maxMp)],
      ['攻击', range('attack')],
      ['魔法', range('magic')],
      ['道术', range('dao')],
      ['防御', range('defense')],
      ['魔防', range('magicDefense')],
      ['命中', String(stats.accuracy)],
      ['闪避', String(stats.evasion)],
      ['幸运', String(stats.luck)],
    ];
    for (const [name, value] of rows) sheet.append(el('dt', '', name), el('dd', '', value));

    const body = el('div', 'panel-body');
    body.append(slots, sheet);
    this.character.replaceChildren(
      this.titleBar(`${player.name} · ${player.def.name}`, this.character),
      body,
      this.breakthrough(),
    );
  }

  /** 到达境界上限时显示突破条件和按钮。 */
  private breakthrough(): HTMLElement {
    const box = el('div', 'detail');
    const { player, expToNext } = this.world;
    const { realms, items } = this.config;
    const realm = pendingBreakthrough(realms, player.level, player.realmPassed);
    if (!realm?.breakthrough) {
      box.hidden = true;
      return box;
    }
    const next = realms[realms.indexOf(realm) + 1];
    box.append(el('div', 'detail-name', `突破至${next?.name ?? ''}`));
    for (const { item, count } of realm.breakthrough.requires) {
      const have = player.bag[item] ?? 0;
      box.append(el('div', have >= count ? '' : 'detail-missing', `${items[item]?.name} ${have}/${count}`));
    }
    const full = expToNext !== null && player.exp >= expToNext;
    box.append(
      el('div', full ? '' : 'detail-missing', full ? '修为已圆满' : '修为尚未圆满'),
      el(
        'div',
        'detail-hint',
        `成功率 ${Math.round(breakthroughChance(realm, player.breakthroughFails[realm.id] ?? 0) * 100)}%，失败消耗材料并虚弱 10 分钟`,
      ),
      this.action('突破', () => this.world.attemptBreakthrough()),
    );
    return box;
  }

  private slotRow(slot: EquipSlot): HTMLElement {
    const equipment = this.world.player.equipment[slot];
    const row = el('button', 'slot-row');
    row.append(el('span', 'slot-name', SLOT_NAMES[slot]));
    const name = el('span', '', equipment ? equipmentName(equipment, this.config) : '空');
    if (equipment) name.style.color = equipmentColor(equipment, this.config);
    row.append(name);
    if (equipment) {
      row.classList.toggle('selected', this.isSelected(equipment));
      row.addEventListener('click', () => {
        this.bag.hidden = false;
        this.select({ kind: 'equipment', uid: equipment.uid });
      });
    }
    return row;
  }

  // ---- 背包面板 ----

  private renderBag(): void {
    const { player } = this.world;
    const grid = el('div', 'bag-grid');
    for (const equipment of player.equipBag) {
      const cell = el('button', 'bag-cell', equipmentName(equipment, this.config));
      cell.style.color = equipmentColor(equipment, this.config);
      cell.classList.toggle('selected', this.isSelected(equipment));
      cell.addEventListener('click', () => this.select({ kind: 'equipment', uid: equipment.uid }));
      grid.append(cell);
    }
    for (const [id, count] of Object.entries(player.bag)) {
      const label = `${this.config.items[id]?.name ?? id}×${count}`;
      const cell = el('button', 'bag-cell', label);
      const selected = this.selection?.kind === 'stack' && this.selection.id === id;
      cell.classList.toggle('selected', selected);
      cell.addEventListener('click', () => this.select({ kind: 'stack', id }));
      grid.append(cell);
    }

    const footer = el(
      'div',
      'bag-footer',
      `法器 ${player.equipBag.length} / ${this.config.affixes.bagCapacity} · 灵石 ${player.gold}`,
    );
    this.bag.replaceChildren(this.titleBar('背包', this.bag), grid, footer, this.detail());
  }

  private titleBar(title: string, panel: HTMLElement): HTMLElement {
    const bar = el('header', 'panel-title');
    const close = el('button', 'panel-close', '×');
    close.addEventListener('click', () => this.toggle(panel));
    bar.append(el('span', '', title), close);
    return bar;
  }

  private isSelected(equipment: Equipment): boolean {
    return this.selection?.kind === 'equipment' && this.selection.uid === equipment.uid;
  }

  // ---- 物品详情 ----

  private detail(): HTMLElement {
    const box = el('div', 'detail');
    const { player } = this.world;
    const selection = this.selection;

    if (selection?.kind === 'stack') {
      const item = this.config.items[selection.id];
      if (!item || !player.bag[selection.id]) return box;
      box.append(el('div', 'detail-name', item.name));
      if (item.heal) box.append(el('div', '', `回复 ${item.heal} 点生命`));
      if (item.mana) box.append(el('div', '', `回复 ${item.mana} 点灵力`));
      if (item.kind === 'material') box.append(el('div', '', '用于祭炼武器'));
      if (item.scroll) box.append(el('div', '', item.scroll === 'recall' ? '回到主城' : '在当前地图随机传送'));
      if (item.kind === 'potion' || item.kind === 'scroll') {
        box.append(this.action('使用', () => this.world.inventory.useItem(selection.id)));
      }
      return box;
    }
    if (selection?.kind !== 'equipment') {
      box.append(el('div', 'detail-hint', '点法器或物品查看详情'));
      return box;
    }

    const wornSlot = EQUIP_SLOTS.find((slot) => player.equipment[slot]?.uid === selection.uid);
    const equipment = wornSlot
      ? player.equipment[wornSlot]
      : player.equipBag.find((candidate) => candidate.uid === selection.uid);
    const item = equipment && this.config.items[equipment.itemId];
    if (!equipment || !item) return box;

    const name = el('div', 'detail-name', equipmentName(equipment, this.config));
    name.style.color = equipmentColor(equipment, this.config);
    box.append(name, el('div', '', `需要等级 ${item.level ?? 1}`));
    for (const bonus of equipmentBonuses(equipment, item)) {
      box.append(el('div', '', `${this.bonusName(bonus.stat)} +${bonus.value}`));
    }
    if (item.special) box.append(el('div', 'detail-special', this.specialText(item.special)));
    const set = Object.values(this.config.sets).find((candidate) => candidate.pieces.includes(item.id));
    if (set) box.append(this.setInfo(set));
    if (!wornSlot) box.append(this.comparison(equipment));

    const actions = el('div', 'detail-actions');
    if (wornSlot) {
      actions.append(this.action('卸下', () => this.world.inventory.unequip(wornSlot)));
    } else {
      actions.append(this.action('装备', () => this.world.inventory.equip(equipment.uid)));
      actions.append(this.action('丢弃', () => this.world.discard(equipment.uid)));
    }
    if (item.slot === 'weapon') {
      const { goldCost, material } = this.config.affixes.refine;
      const stones = player.bag[material] ?? 0;
      actions.append(this.action('祭炼', () => this.world.inventory.refine(equipment.uid)));
      box.append(el('div', 'detail-hint', `祭炼消耗祭炼石 1（有 ${stones}）、灵石 ${goldCost}`));
    }
    box.append(actions);
    return box;
  }

  private specialText(special: SpecialDef): string {
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

  private setInfo(set: SetDef): HTMLElement {
    const wornItems = Object.values(this.world.player.equipment).map((worn) => worn.itemId);
    const count = set.pieces.filter((piece) => wornItems.includes(piece)).length;
    const box = el('div', 'detail-set');
    box.append(el('div', '', `${set.name}（已穿 ${count}/${set.pieces.length}）`));
    for (const tier of set.bonuses) {
      const bonus = Object.entries(tier.bonus)
        .map(([stat, value]) => `${this.bonusName(stat as BonusStat)} +${value}`)
        .join('，');
      box.append(el('div', count >= tier.count ? '' : 'detail-hint', `${tier.count} 件：${bonus}`));
    }
    return box;
  }

  /** 和同栏位已穿的法器对比，戒指和手镯取第一个栏位。 */
  private comparison(equipment: Equipment): HTMLElement {
    const { items } = this.config;
    const item = items[equipment.itemId]!;
    const slots = slotsFor(item);
    const worn = slots.map((slot) => this.world.player.equipment[slot]).find(Boolean);
    const box = el('div', 'detail-compare');
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
    box.append(el('div', 'detail-hint', `对比 ${equipmentName(worn, this.config)}`));
    for (const stat of new Set([...next.keys(), ...current.keys()])) {
      const change = (next.get(stat) ?? 0) - (current.get(stat) ?? 0);
      if (change === 0) continue;
      const text = `${this.bonusName(stat)} ${change > 0 ? '+' : ''}${change}`;
      box.append(el('div', change > 0 ? 'detail-better' : 'detail-missing', text));
    }
    return box;
  }

  private bonusName(stat: BonusStat): string {
    return STAT_NAMES[stat === 'primary' ? this.world.player.def.primaryStat : stat];
  }

  private action(label: string, run: () => void): HTMLElement {
    const button = el('button', 'detail-action', label);
    button.addEventListener('click', run);
    return button;
  }
}

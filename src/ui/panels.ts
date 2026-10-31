import type { BonusStat, DamageStat, GameConfig } from '../game/config';
import {
  EQUIP_SLOTS,
  equipmentBonuses,
  equipmentColor,
  equipmentName,
  SLOT_NAMES,
  type EquipSlot,
  type Equipment,
} from '../game/equipment';
import { realmName } from '../game/realm';
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
    );
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
      if (item.kind === 'potion') {
        box.append(this.action('使用', () => this.world.useItem(selection.id)));
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

    const actions = el('div', 'detail-actions');
    if (wornSlot) {
      actions.append(this.action('卸下', () => this.world.unequip(wornSlot)));
    } else {
      actions.append(this.action('装备', () => this.world.equip(equipment.uid)));
      actions.append(this.action('丢弃', () => this.world.discard(equipment.uid)));
    }
    if (item.slot === 'weapon') {
      const { goldCost, material } = this.config.affixes.refine;
      const stones = player.bag[material] ?? 0;
      actions.append(this.action('祭炼', () => this.world.refine(equipment.uid)));
      box.append(el('div', 'detail-hint', `祭炼消耗祭炼石 1（有 ${stones}）、灵石 ${goldCost}`));
    }
    box.append(actions);
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

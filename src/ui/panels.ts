import { isBound, type DamageStat, type GameConfig } from '../game/config';
import { EQUIP_SLOTS, equipmentColor, equipmentName, SLOT_NAMES, type EquipSlot } from '../game/equipment';
import { breakthroughChance, pendingBreakthrough, realmName } from '../game/realm';
import type { World } from '../game/world';
import { iconImage } from './icons';
import { findEquipment, itemDetail, type ItemRef } from './itemInfo';
import { attachTooltip, hideOrphanTooltip, hideTooltip } from './tooltip';

const BAG_COLUMNS = 8;
const BAG_MIN_CELLS = 40;
/** 按下后移动超过这么多像素才算拖动，免得点击被当成拖动 */
const DRAG_START_PIXELS = 5;
/** 选中会重建格子，双击自己按两次单击的间隔判断 */
const DOUBLE_CLICK_MS = 400;

interface Drag {
  ref: ItemRef;
  startX: number;
  startY: number;
  ghost: HTMLImageElement | null;
}

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

const sameRef = (a: ItemRef | null, b: ItemRef) =>
  !!a && (a.kind === 'equipment' ? b.kind === 'equipment' && a.uid === b.uid : b.kind === 'stack' && a.id === b.id);

/**
 * 角色与背包面板。背包是图标网格：悬停看详情，单击选中，双击或右键使用，
 * 拖到背包外丢弃。只在内容变化时重建 DOM。
 */
export class Panels {
  private readonly character = el('section', 'panel panel-character');
  private readonly bag = el('section', 'panel panel-bag');
  private selection: ItemRef | null = null;
  private drag: Drag | null = null;
  private lastClick: { ref: ItemRef; at: number } | null = null;
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
    window.addEventListener('pointermove', (event) => this.moveDrag(event));
    window.addEventListener('pointerup', (event) => this.endDrag(event));
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
    hideOrphanTooltip();
  }

  private toggle(panel: HTMLElement): void {
    panel.hidden = !panel.hidden;
    if (panel.hidden && this.character.hidden && this.bag.hidden) this.selection = null;
    hideTooltip();
  }

  private closeAll(): void {
    this.character.hidden = true;
    this.bag.hidden = true;
    this.selection = null;
    hideTooltip();
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
    if (equipment) {
      name.prepend(iconImage(equipment.itemId));
      name.style.color = equipmentColor(equipment, this.config);
    }
    row.append(name);
    if (equipment) {
      const ref: ItemRef = { kind: 'equipment', uid: equipment.uid };
      row.classList.toggle('selected', sameRef(this.selection, ref));
      row.addEventListener('click', () => {
        this.bag.hidden = false;
        if (this.isDoubleClick(ref)) this.world.inventory.unequip(slot);
        else this.selection = ref;
      });
      attachTooltip(row, () => itemDetail(this.world, ref));
    }
    return row;
  }

  // ---- 背包面板 ----

  private renderBag(): void {
    const { player } = this.world;
    const refs: ItemRef[] = [
      ...player.equipBag.map((equipment): ItemRef => ({ kind: 'equipment', uid: equipment.uid })),
      ...Object.keys(player.bag)
        .filter((id) => (player.bag[id] ?? 0) > 0)
        .map((id): ItemRef => ({ kind: 'stack', id })),
    ];
    const grid = el('div', 'bag-grid');
    for (const ref of refs) grid.append(this.bagCell(ref));
    const total = Math.max(BAG_MIN_CELLS, Math.ceil(refs.length / BAG_COLUMNS) * BAG_COLUMNS);
    for (let i = refs.length; i < total; i++) grid.append(el('div', 'bag-cell empty'));

    const footer = el(
      'div',
      'bag-footer',
      `法器 ${player.equipBag.length} / ${this.config.affixes.bagCapacity} · 灵石 ${player.gold}`,
    );
    this.bag.replaceChildren(this.titleBar('背包', this.bag), grid, footer, this.actionBar());
  }

  private bagCell(ref: ItemRef): HTMLElement {
    const { player } = this.world;
    const cell = el('button', 'bag-cell');
    if (ref.kind === 'equipment') {
      const equipment = player.equipBag.find((candidate) => candidate.uid === ref.uid)!;
      cell.append(iconImage(equipment.itemId));
      cell.style.borderColor = equipmentColor(equipment, this.config);
      const item = this.config.items[equipment.itemId];
      if (item && (item.level ?? 1) > player.level) cell.classList.add('too-high');
    } else {
      cell.append(iconImage(ref.id));
      const count = player.bag[ref.id] ?? 0;
      if (count > 1) cell.append(el('span', 'bag-count', String(count)));
    }
    cell.classList.toggle('selected', sameRef(this.selection, ref));
    cell.addEventListener('click', () => {
      if (this.isDoubleClick(ref)) this.useRef(ref);
      else this.selection = ref;
    });
    cell.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.useRef(ref);
    });
    cell.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.drag = { ref, startX: event.clientX, startY: event.clientY, ghost: null };
    });
    attachTooltip(cell, () => itemDetail(this.world, ref));
    return cell;
  }

  private isDoubleClick(ref: ItemRef): boolean {
    const now = performance.now();
    const double = !!this.lastClick && sameRef(this.lastClick.ref, ref) && now - this.lastClick.at < DOUBLE_CLICK_MS;
    this.lastClick = double ? null : { ref, at: now };
    return double;
  }

  /** 双击或右键：法器装备，丹药符箓使用，功法书研读。 */
  private useRef(ref: ItemRef): void {
    const { inventory } = this.world;
    if (ref.kind === 'equipment') {
      inventory.equip(ref.uid);
    } else {
      const item = this.config.items[ref.id];
      if (item && (item.kind === 'potion' || item.kind === 'scroll' || item.kind === 'book')) inventory.useItem(ref.id);
    }
    hideTooltip();
  }

  // ---- 拖动丢弃 ----

  private moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.ghost) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_START_PIXELS) return;
      drag.ghost = iconImage(this.refItemId(drag.ref) ?? '');
      drag.ghost.className = 'drag-ghost';
      document.body.append(drag.ghost);
      hideTooltip();
    }
    drag.ghost.style.left = `${event.clientX}px`;
    drag.ghost.style.top = `${event.clientY}px`;
  }

  private endDrag(event: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag?.ghost) return;
    drag.ghost.remove();
    const target = document.elementFromPoint(event.clientX, event.clientY);
    if (target && this.bag.contains(target)) return;
    if (target && this.character.contains(target)) {
      if (drag.ref.kind === 'equipment') this.world.inventory.equip(drag.ref.uid);
      return;
    }
    if (drag.ref.kind === 'equipment') this.world.discard(drag.ref.uid);
    else this.world.discardStack(drag.ref.id);
    if (sameRef(this.selection, drag.ref)) this.selection = null;
  }

  private refItemId(ref: ItemRef): string | null {
    if (ref.kind === 'stack') return ref.id;
    return findEquipment(this.world, ref.uid)?.equipment.itemId ?? null;
  }

  // ---- 选中物品的操作 ----

  /** 选中物品的名字和操作按钮，详细说明看悬停浮窗，面板不会被长说明撑高。 */
  private actionBar(): HTMLElement {
    const box = el('div', 'bag-actions');
    const selection = this.selection;
    const { player, inventory } = this.world;
    if (!selection) {
      box.append(el('div', 'detail-hint', '悬停看详情 · 双击或右键使用 · 拖到背包外丢弃'));
      return box;
    }
    const actions = el('div', 'detail-actions');
    if (selection.kind === 'stack') {
      const item = this.config.items[selection.id];
      if (!item || !player.bag[selection.id]) return box;
      box.append(el('div', 'detail-name', `${item.name} ×${player.bag[selection.id]}`));
      if (item.kind === 'potion' || (item.kind === 'scroll' && item.scroll !== 'fly')) {
        actions.append(this.action('使用', () => inventory.useItem(selection.id)));
      } else if (item.kind === 'book') {
        actions.append(this.action('研读', () => inventory.useItem(selection.id)));
      }
      if (!isBound(item)) actions.append(this.action('丢弃', () => this.world.discardStack(selection.id)));
      box.append(actions);
      return box;
    }

    const found = findEquipment(this.world, selection.uid);
    const item = found && this.config.items[found.equipment.itemId];
    if (!found || !item) return box;
    const { equipment, slot } = found;
    const name = el('div', 'detail-name', equipmentName(equipment, this.config));
    name.style.color = equipmentColor(equipment, this.config);
    box.append(name);
    if (slot) {
      actions.append(this.action('卸下', () => inventory.unequip(slot)));
    } else {
      actions.append(this.action('装备', () => inventory.equip(equipment.uid)));
      if (!isBound(item)) actions.append(this.action('丢弃', () => this.world.discard(equipment.uid)));
    }
    if (item.slot === 'weapon') {
      const { goldCost, material } = this.config.affixes.refine;
      const stones = player.bag[material] ?? 0;
      actions.append(this.action('祭炼', () => inventory.refine(equipment.uid)));
      box.append(actions, el('div', 'detail-hint', `祭炼消耗祭炼石 1（有 ${stones}）、灵石 ${goldCost}`));
      return box;
    }
    box.append(actions);
    return box;
  }

  // ---- 通用 ----

  /** 标题栏可以拖动整个面板。 */
  private titleBar(title: string, panel: HTMLElement): HTMLElement {
    const bar = el('header', 'panel-title draggable');
    const close = el('button', 'panel-close', '×');
    close.addEventListener('click', () => this.toggle(panel));
    bar.append(el('span', '', title), close);
    bar.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target === close) return;
      const rect = panel.getBoundingClientRect();
      const parent = panel.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      const move = (moveEvent: PointerEvent) => {
        const left = Math.min(Math.max(0, moveEvent.clientX - offsetX), innerWidth - 60);
        const top = Math.min(Math.max(0, moveEvent.clientY - offsetY), innerHeight - 40);
        panel.style.left = `${left - parent.left}px`;
        panel.style.top = `${top - parent.top}px`;
        panel.style.right = 'auto';
      };
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      event.preventDefault();
    });
    return bar;
  }

  private action(label: string, run: () => void): HTMLElement {
    const button = el('button', 'detail-action', label);
    button.addEventListener('click', run);
    return button;
  }
}

import type { RecipeDef } from '../game/config';
import type { World } from '../game/world';
import { iconImage } from './icons';
import { itemDetail } from './itemInfo';
import { attachTooltip, hideTooltip } from './tooltip';

const TIER_NAMES = ['一', '二', '三', '四'];
const REFRESH_MS = 250;

function el(tag: string, className: string, text = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

/** 剩余时间，比如 1:05:30、12:30。 */
function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

type Tab = 'garden' | 'alchemy';

/** 洞府药园面板：药园页播种、收获、绿液催熟、扩建；炼丹页按丹方炼丹。G 键开关。 */
export class GardenPanel {
  private readonly panel = document.createElement('section');
  private tab: Tab = 'garden';
  private signature = '';
  private timer = 0;
  /** 每块空地下拉框里选中的灵药 */
  private readonly choice: string[] = [];

  constructor(private readonly world: World) {
    this.panel.className = 'panel panel-garden';
    this.panel.hidden = true;
    document.getElementById('hud')!.append(this.panel);
    document.getElementById('hud-open-garden')!.addEventListener('click', () => this.toggle());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'g' || event.key === 'G') this.toggle();
      else if (event.key === 'Escape') this.close();
    });
  }

  private toggle(): void {
    if (this.panel.hidden) this.open();
    else this.close();
  }

  private open(): void {
    this.panel.hidden = false;
    this.signature = '';
    this.update();
    this.timer = window.setInterval(() => this.update(), REFRESH_MS);
  }

  private close(): void {
    this.panel.hidden = true;
    window.clearInterval(this.timer);
    hideTooltip();
  }

  /** 状态变了才重建，进度条和倒计时每次都刷新。 */
  private update(): void {
    const { garden, player } = this.world;
    garden.refresh();
    const plots = player.garden.plots.map((plot, index) => [plot.herb, garden.isReady(index), garden.growth(index) >= this.world.config.garden.dew.minGrowth]);
    const { herbs, recipes } = this.world.config.garden;
    const stock = [...herbs.map((herb) => herb.seed), ...recipes.flatMap((recipe) => [recipe.output, ...recipe.materials.map((m) => m.item)])].map(
      (id) => player.bag[id] ?? 0,
    );
    const signature = JSON.stringify([this.tab, garden.unlocked, plots, stock, player.garden.dew, player.gold, player.level]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.render();
    }
    this.tick();
  }

  private render(): void {
    const { garden, player, config } = this.world;
    const title = el('header', 'panel-title', '洞府·药园');
    if (!garden.unlocked) {
      const quest = config.quests[config.garden.unlockQuest];
      this.panel.replaceChildren(title, el('div', 'detail-hint', `完成「${quest?.name}」后得到掌天瓶，才能开辟药园`));
      return;
    }
    const tabs = el('div', 'garden-tabs');
    for (const [tab, label] of [['garden', `药园${garden.readyCount ? `（${garden.readyCount} 株成熟）` : ''}`], ['alchemy', '炼丹']] as const) {
      const button = el('button', this.tab === tab ? 'garden-tab active' : 'garden-tab', label);
      button.addEventListener('click', () => {
        this.tab = tab;
        this.update();
      });
      tabs.append(button);
    }
    if (this.tab === 'alchemy') {
      this.panel.replaceChildren(title, tabs, this.alchemy());
      return;
    }
    const realm = config.realms[garden.tier]?.name ?? '';
    const bottle = el('div', 'garden-bottle');
    bottle.append(
      el('span', '', `掌天瓶 · ${realm}·${TIER_NAMES[garden.tier] ?? ''}重禁制`),
      el('span', 'garden-dew', ''),
    );

    const actions = el('div', 'detail-actions');
    actions.append(
      this.button('一键收获', () => garden.harvestAll(), garden.readyCount === 0),
      this.button('一键补种', () => garden.replantAll(), !player.garden.plots.some((plot) => !plot.herb && plot.last)),
    );
    const next = garden.nextExpansion;
    if (next) {
      const label = `扩建药圃（${next.level} 级，灵石 ${next.gold}）`;
      actions.append(this.button(label, () => garden.expand(), player.level < next.level || player.gold < next.gold));
    }

    const grid = el('div', 'garden-plots');
    player.garden.plots.forEach((_, index) => grid.append(this.plotCard(index)));
    this.panel.replaceChildren(title, tabs, bottle, actions, grid);
  }

  /** 炼丹页：每张丹方一行，成品、材料有/需、灵石，等级够了才能炼。 */
  private alchemy(): HTMLElement {
    const { config, player } = this.world;
    const list = el('div', 'alchemy-list');
    const recipes = [...config.garden.recipes].sort((a, b) => a.level - b.level);
    for (const recipe of recipes) list.append(this.recipeRow(recipe));
    list.prepend(el('div', 'detail-hint', `炼丹必成。灵石 ${player.gold}`));
    return list;
  }

  private recipeRow(recipe: RecipeDef): HTMLElement {
    const { config, player, garden } = this.world;
    const locked = player.level < recipe.level;
    const row = el('div', locked ? 'alchemy-row locked' : 'alchemy-row');
    const output = el('b', 'alchemy-output');
    output.append(iconImage(recipe.output), `${config.items[recipe.output]?.name ?? recipe.output}${recipe.count > 1 ? ` ×${recipe.count}` : ''}`);
    attachTooltip(output, () => itemDetail(this.world, { kind: 'stack', id: recipe.output }));
    const have = el('small', 'alchemy-have', `有 ${player.bag[recipe.output] ?? 0}`);
    const materials = el('div', 'alchemy-materials');
    for (const { item, count } of recipe.materials) {
      const owned = player.bag[item] ?? 0;
      const chip = el('span', owned >= count ? 'alchemy-chip' : 'alchemy-chip short');
      chip.append(iconImage(item), `${config.items[item]?.name ?? item} ${owned}/${count}`);
      attachTooltip(chip, () => itemDetail(this.world, { kind: 'stack', id: item }));
      materials.append(chip);
    }
    if (recipe.gold > 0) materials.append(el('span', player.gold >= recipe.gold ? 'alchemy-chip' : 'alchemy-chip short', `灵石 ${recipe.gold}`));
    const max = garden.maxBrews(recipe);
    const actions = el('div', 'alchemy-actions');
    if (locked) {
      actions.append(el('small', 'detail-hint', `${recipe.level} 级可炼`));
    } else {
      actions.append(
        this.button('炼制', () => garden.brew(recipe.id), max < 1),
        this.button(max > 1 ? `全部 ×${max}` : '全部', () => garden.brew(recipe.id, max), max < 2),
      );
    }
    row.append(output, have, materials, actions);
    return row;
  }

  private plotCard(index: number): HTMLElement {
    const { garden, player, config } = this.world;
    const plot = player.garden.plots[index]!;
    const card = el('div', 'garden-plot');
    card.dataset.index = String(index);
    const herb = garden.herb(plot.herb);
    if (!herb) {
      const select = document.createElement('select');
      for (const option of config.garden.herbs) {
        if (player.level < option.level) continue;
        const seeds = player.bag[option.seed] ?? 0;
        const price = config.items[option.seed]?.price ?? 0;
        const name = config.items[option.item]?.name ?? option.item;
        const item = document.createElement('option');
        item.value = option.item;
        // 突破主药的种子买不到，没有种子时不能选
        item.textContent = `${name}（${seeds > 0 ? `种子 ${seeds}` : price ? `灵石 ${price}` : '缺种子，打怪掉落'}）`;
        item.disabled = seeds === 0 && !price;
        select.append(item);
      }
      const usable = [...select.options].filter((option) => !option.disabled).map((option) => option.value);
      const wanted = this.choice[index] ?? plot.last ?? '';
      select.value = usable.includes(wanted) ? wanted : (usable[0] ?? '');
      select.addEventListener('change', () => (this.choice[index] = select.value));
      card.append(el('b', '', '空地'), select, this.button('播种', () => garden.plant(index, select.value)));
      return card;
    }
    const name = el('b', '');
    name.append(iconImage(herb.item), config.items[herb.item]?.name ?? herb.item);
    const bar = el('div', 'garden-bar');
    bar.append(el('div', 'garden-fill'));
    card.append(name, bar, el('small', 'garden-time', ''));
    if (garden.isReady(index)) {
      card.append(this.button(`收获 ×${herb.yield}`, () => garden.harvest(index)));
    } else {
      const grownEnough = garden.growth(index) >= config.garden.dew.minGrowth;
      card.append(this.button('绿液催熟', () => garden.accelerate(index), !grownEnough || player.garden.dew < 1));
    }
    return card;
  }

  /** 每次刷新：绿液倒计时、进度条和剩余时间。 */
  private tick(): void {
    const { garden, player } = this.world;
    const dew = this.panel.querySelector('.garden-dew');
    if (dew) {
      const next = garden.nextDewIn;
      dew.textContent = `绿液 ${player.garden.dew}/${garden.dewMax}${next > 0 ? `（下一滴 ${clock(next)}）` : '（已满）'}`;
    }
    for (const card of this.panel.querySelectorAll<HTMLElement>('.garden-plot')) {
      const index = Number(card.dataset.index);
      const plot = player.garden.plots[index];
      const fill = card.querySelector<HTMLElement>('.garden-fill');
      const time = card.querySelector('.garden-time');
      if (!plot?.herb || !fill || !time) continue;
      fill.style.width = `${Math.round(garden.growth(index) * 100)}%`;
      time.textContent = garden.isReady(index) ? '已成熟' : `还要 ${clock(garden.remaining(index))}`;
    }
  }

  private button(label: string, action: () => unknown, disabled = false): HTMLButtonElement {
    const button = el('button', 'detail-action', label) as HTMLButtonElement;
    button.disabled = disabled;
    button.addEventListener('click', () => {
      action();
      this.update();
    });
    return button;
  }
}

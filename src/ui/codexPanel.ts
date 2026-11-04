import { achievementProgress } from '../game/achievements';
import { monsterDrops, type AchievementDef, type ItemDef, type MonsterDef } from '../game/config';
import type { World } from '../game/world';
import { itemSources } from '../game/sources';
import { iconImage } from './icons';

type Tab = 'monsters' | 'items' | 'achievements';

const TABS: [Tab, string][] = [
  ['monsters', '妖兽'],
  ['items', '法器'],
  ['achievements', '成就'],
];

const SLOT_LABELS: Record<NonNullable<ItemDef['slot']>, string> = {
  weapon: '武器',
  armor: '衣服',
  helmet: '头盔',
  necklace: '项链',
  bracelet: '手镯',
  ring: '戒指',
};

function el(tag: string, className: string, text = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

/** 图鉴和成就面板：见过的妖兽、收集过的法器和成就进度。J 键开关。 */
export class CodexPanel {
  private readonly panel = document.createElement('section');
  private tab: Tab = 'monsters';

  constructor(private readonly world: World) {
    this.panel.className = 'panel panel-codex';
    this.panel.hidden = true;
    document.getElementById('hud')!.append(this.panel);
    document.getElementById('hud-open-codex')!.addEventListener('click', () => this.toggle());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'j' || event.key === 'J') this.toggle();
      else if (event.key === 'Escape') this.panel.hidden = true;
    });
  }

  private toggle(): void {
    this.panel.hidden = !this.panel.hidden;
    if (!this.panel.hidden) this.render();
  }

  private render(): void {
    this.world.checkAchievements();
    const title = el('header', 'panel-title', '图鉴');
    const tabs = el('div', 'codex-tabs');
    for (const [id, name] of TABS) {
      const button = el('button', id === this.tab ? 'detail-action active' : 'detail-action', name);
      button.addEventListener('click', () => {
        this.tab = id;
        this.render();
      });
      tabs.append(button);
    }
    const body =
      this.tab === 'monsters' ? this.monsters() : this.tab === 'items' ? this.items() : this.achievements();
    this.panel.replaceChildren(title, tabs, ...body);
  }

  /** 地图上会刷出来的怪，按经验从低到高排。 */
  private monsters(): HTMLElement[] {
    const { config, player } = this.world;
    const spawned = new Set(Object.values(config.maps).flatMap((map) => map.spawns.map((spawn) => spawn.monster)));
    const list = Object.values(config.monsters)
      .filter((monster) => spawned.has(monster.id))
      .sort((a, b) => a.exp - b.exp);
    const seen = list.filter((monster) => player.kills[monster.id]).length;
    return [el('div', 'codex-summary', `已击败 ${seen} / ${list.length} 种`), ...list.map((monster) => this.monsterRow(monster))];
  }

  private monsterRow(monster: MonsterDef): HTMLElement {
    const { config, player } = this.world;
    const kills = player.kills[monster.id] ?? 0;
    const row = el('div', kills ? 'skill-row' : 'skill-row locked');
    const where = Object.values(config.maps)
      .filter((map) => map.spawns.some((spawn) => spawn.monster === monster.id))
      .map((map) => map.name)
      .join('、');
    if (!kills) {
      row.append(el('b', '', '？？？'), el('span', '', monster.boss ? 'Boss · 未遇见' : '未遇见'));
      row.append(el('small', '', `出没：${where}`));
      return row;
    }
    row.append(el('b', '', monster.boss ? `${monster.name}（Boss）` : monster.name), el('span', '', `击败 ${kills} 次`));
    // 普通法器只报种数，材料和专属法器列名字
    const entries = monsterDrops(config, monster).map((entry) => config.items[entry.item]).filter((item) => !!item);
    const named = entries.filter((item) => item.kind !== 'gold' && (item.kind !== 'equip' || item.boss)).map((item) => item.name);
    const equipment = entries.filter((item) => item.kind === 'equip' && !item.boss).length;
    const drops = [...named, ...(equipment ? [`法器 ${equipment} 种`] : [])];
    const detail = `${where} · 生命 ${monster.stats.maxHp} · 经验 ${monster.exp}${drops.length ? ` · 掉落 ${drops.join('、')}` : ''}`;
    row.append(el('small', '', detail));
    return row;
  }

  private items(): HTMLElement[] {
    const { config, player } = this.world;
    const list = Object.values(config.items)
      .filter((item) => item.kind === 'equip')
      .sort((a, b) => (a.level ?? 1) - (b.level ?? 1));
    const seen = list.filter((item) => player.codexItems[item.id] !== undefined).length;
    const grid = el('div', 'codex-items');
    for (const item of list) {
      const grade = player.codexItems[item.id];
      const cell = el('div', grade === undefined ? 'codex-item locked' : 'codex-item');
      const label = `${item.level ?? 1} 级${SLOT_LABELS[item.slot!]}`;
      const sources = itemSources(config, player, item.id).map((source) => `\n· ${source}`).join('');
      if (grade === undefined) {
        cell.append(el('span', 'codex-icon', '？'), el('small', '', label));
        cell.title = `${label}${sources}`;
      } else {
        const name = el('small', '', item.name);
        name.style.color = config.affixes.grades[grade]?.color ?? '';
        cell.append(iconImage(item.id), name);
        cell.title = `${item.name} · ${label} · 最高见过${config.affixes.grades[grade]?.name}${sources}`;
      }
      grid.append(cell);
    }
    return [el('div', 'codex-summary', `已收集 ${seen} / ${list.length} 种`), grid];
  }

  private achievements(): HTMLElement[] {
    const list = Object.values(this.world.config.achievements);
    const done = list.filter((def) => this.world.player.achievements.includes(def.id)).length;
    return [el('div', 'codex-summary', `已达成 ${done} / ${list.length}`), ...list.map((def) => this.achievementRow(def))];
  }

  private achievementRow(def: AchievementDef): HTMLElement {
    const { player, config } = this.world;
    const done = player.achievements.includes(def.id);
    const row = el('div', done ? 'skill-row' : 'skill-row locked');
    const { value, goal } = achievementProgress(def, player, config);
    row.append(el('b', '', done ? `✓ ${def.name}` : def.name), el('span', '', done ? '已达成' : `${Math.min(value, goal)} / ${goal}`));
    const rewards = [
      def.reward.gold ? `灵石 ${def.reward.gold}` : '',
      ...def.reward.items.map(({ item, count }) => `${config.items[item]?.name} ${count}`),
    ].filter(Boolean);
    row.append(el('small', '', `${def.description}${rewards.length ? `；奖励 ${rewards.join('、')}` : ''}`));
    return row;
  }
}

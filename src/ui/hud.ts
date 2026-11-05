import type { DamageStat, GameConfig, QuestDef } from '../game/config';
import { equipmentName } from '../game/equipment';
import { cellDistance } from '../game/grid';
import { nextStep, questDestination } from '../game/navigation';
import { objectiveCount, questStatus } from '../game/quests';
import { pendingBreakthrough, realmName } from '../game/realm';
import type { RouteTarget } from '../game/types';
import { FLYING_BOOTS, HOTBAR_SIZE, type World } from '../game/world';
import { iconUrl } from './icons';
import { itemDetail } from './itemInfo';
import { Minimap } from './minimap';
import { skillDetail } from './skillInfo';
import { attachTooltip } from './tooltip';

const LOG_LINES = 7;
const BOSS_BAR_DISTANCE = 12;
const STAT_NAMES: Record<DamageStat, string> = { attack: '攻击', magic: '魔法', dao: '道术' };

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少 HUD 元素：${id}`);
  return element;
}

interface SlotView {
  button: HTMLButtonElement;
  icon: HTMLImageElement;
  label: HTMLElement;
  cooldown: HTMLElement;
}

export class Hud {
  onSlot: (slot: number) => void = () => {};

  private readonly name = byId('hud-name');
  private readonly className = byId('hud-class');
  private readonly realm = byId('hud-realm');
  private readonly hpFill = byId('hud-hp-fill');
  private readonly hpText = byId('hud-hp-text');
  private readonly mpFill = byId('hud-mp-fill');
  private readonly mpText = byId('hud-mp-text');
  private readonly expFill = byId('hud-exp-fill');
  private readonly expText = byId('hud-exp-text');
  private readonly statName = byId('hud-stat-name');
  private readonly attack = byId('hud-attack');
  private readonly gold = byId('hud-gold');
  private readonly weapon = byId('hud-weapon');
  private readonly logBox = byId('hud-log');
  private readonly quests = byId('hud-quests');
  private readonly boss = byId('hud-boss');
  private readonly bossName = byId('hud-boss-name');
  private readonly bossFill = byId('hud-boss-fill');
  private readonly slots: SlotView[] = [];
  private readonly minimap: Minimap;
  private questSignature = '';

  constructor(
    private readonly config: GameConfig,
    world: World,
  ) {
    byId('hud').hidden = false;
    this.minimap = new Minimap(world);
    const hotbar = byId('hud-hotbar');
    for (let slot = 0; slot < HOTBAR_SIZE; slot++) {
      const button = document.createElement('button');
      const key = document.createElement('kbd');
      const icon = document.createElement('img');
      const label = document.createElement('span');
      const cooldown = document.createElement('i');
      key.textContent = `F${slot + 1}`;
      icon.alt = '';
      icon.draggable = false;
      icon.hidden = true;
      button.append(icon, key, label, cooldown);
      button.addEventListener('click', () => this.onSlot(slot));
      attachTooltip(button, () => {
        const entry = world.player.hotbar[slot];
        const skill = entry?.kind === 'skill' && world.config.skills[entry.id];
        if (skill) return skillDetail(world, skill);
        return entry?.kind === 'item' ? itemDetail(world, { kind: 'stack', id: entry.id }) : [];
      });
      hotbar.append(button);
      this.slots.push({ button, icon, label, cooldown });
    }
  }

  update(world: World): void {
    const player = world.player;
    const { maxHp, maxMp } = player.stats;
    const primary = player.def.primaryStat;
    const needed = world.expToNext;

    this.name.textContent = player.name;
    this.className.textContent = player.def.name;
    this.realm.textContent = realmName(this.config.realms, player.level);
    this.hpFill.style.width = `${(player.hp / maxHp) * 100}%`;
    this.hpText.textContent = `${Math.ceil(player.hp)} / ${maxHp}`;
    this.mpFill.style.width = `${(player.mp / maxMp) * 100}%`;
    this.mpText.textContent = `${Math.floor(player.mp)} / ${maxMp}`;
    this.expFill.style.width = needed ? `${(player.exp / needed) * 100}%` : '100%';
    const gated = pendingBreakthrough(this.config.realms, player.level, player.realmPassed);
    const capped = gated && needed !== null && player.exp >= needed;
    this.expText.textContent = capped ? '待突破' : needed ? `${player.exp} / ${needed}` : '满级';
    this.statName.textContent = STAT_NAMES[primary];
    this.attack.textContent = `${player.stats[primary].min}-${player.stats[primary].max}`;
    this.gold.textContent = String(player.gold);
    const weapon = player.equipment.weapon;
    this.weapon.textContent = weapon ? equipmentName(weapon, this.config) : '无';
    this.updateHotbar(world);
    this.updateQuests(world);
    this.updateBoss(world);
    this.minimap.update();
  }

  private updateQuests(world: World): void {
    const { player } = world;
    const timed = world.deathDrops.length > 0 || player.weakUntil > 0;
    const dropClock = timed ? Math.floor(world.time) : 0;
    const signature = JSON.stringify([player.quests, player.level, player.bag, dropClock]);
    if (signature === this.questSignature) return;
    this.questSignature = signature;

    const lines: { text: string; quest?: QuestDef }[] = player.quests.active.flatMap((progress) => {
      const quest = this.config.quests[progress.id];
      if (!quest) return [];
      const ready = questStatus(quest, player.quests, player.level, player.bag) === 'ready';
      const giver = this.config.npcs[quest.giver]?.name ?? '';
      const counts = quest.objectives
        .map((objective, index) => `${objectiveCount(quest, index, progress, player.bag)}/${objective.count}`)
        .join(' ');
      const text = `${quest.name}：${ready ? `回去找${giver}` : `${quest.summary} ${counts}`}`;
      return [{ text, quest }];
    });
    if (lines.length === 0) {
      // 先推荐主线，再推荐走得到、等级最接近的，免得后期一直挂着第一章的支线
      const reachable = (quest: QuestDef) => {
        const map = this.config.npcs[quest.giver]?.map;
        return !!map && (map === world.mapId || nextStep(world, map) !== null);
      };
      const next = Object.values(this.config.quests)
        .filter((quest) => questStatus(quest, player.quests, player.level, player.bag) === 'available')
        .filter(reachable)
        .sort((a, b) => Number(!!b.main) - Number(!!a.main) || b.level - a.level)[0];
      if (next) lines.push({ text: `可接：${next.name}（${this.config.npcs[next.giver]?.name}）`, quest: next });
    }
    const clockUntil = (time: number) => {
      const left = Math.max(0, Math.ceil(time - world.time));
      return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    };
    if (player.weakUntil > 0) lines.push({ text: `虚弱：属性降低，剩 ${clockUntil(player.weakUntil)}` });
    for (const { mapId, item } of world.deathDrops) {
      const clock = clockUntil(item.expiresAt);
      const name = item.equipment ? equipmentName(item.equipment, this.config) : item.def.name;
      lines.push({ text: `遗落 ${name}：${this.config.maps[mapId]?.name} 剩 ${clock}` });
    }
    this.quests.replaceChildren(
      ...lines.map(({ text, quest }) => {
        const row = document.createElement('div');
        if (!quest) {
          row.textContent = text;
          return row;
        }
        row.className = 'quest-row';
        const link = document.createElement('span');
        link.className = 'quest-link';
        link.textContent = text;
        link.title = '点击自动寻路';
        // 战斗中任务行经常重建，按下就触发，免得点击落空
        link.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          const target = this.questTarget(world, quest);
          if (target) world.navigate(target);
        });
        const boots = document.createElement('button');
        const count = player.bag[FLYING_BOOTS] ?? 0;
        boots.className = 'quest-fly';
        boots.classList.toggle('unusable', count === 0);
        boots.title = `飞行靴（剩 ${count}）：直接飞到任务目的地`;
        const icon = document.createElement('img');
        icon.src = iconUrl(FLYING_BOOTS);
        icon.alt = '飞行靴';
        icon.draggable = false;
        const label = document.createElement('span');
        label.textContent = String(count);
        boots.append(icon, label);
        boots.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          const target = this.questTarget(world, quest);
          if (target) world.flyTo(target);
        });
        row.append(link, boots);
        return row;
      }),
    );
  }

  /** 没接的任务去找发任务的人，接了的去任务目的地，完成了回交任务的人。 */
  private questTarget(world: World, quest: QuestDef): RouteTarget | null {
    const available = !world.player.quests.active.some((progress) => progress.id === quest.id);
    const giver = this.config.npcs[quest.giver];
    return available && giver
      ? { mapId: giver.map, cell: { x: giver.x, y: giver.y }, npc: giver }
      : questDestination(world, quest, world.player);
  }

  private updateBoss(world: World): void {
    const { cell } = world.player;
    const boss = world.monsters.find(
      (monster) =>
        monster.def.boss && monster.hp > 0 && cellDistance(monster.cell, cell) <= BOSS_BAR_DISTANCE,
    );
    this.boss.hidden = !boss;
    if (!boss) return;
    this.bossName.textContent = boss.name;
    this.bossFill.style.width = `${(boss.hp / boss.stats.maxHp) * 100}%`;
  }

  private updateHotbar(world: World): void {
    const player = world.player;
    this.slots.forEach((view, slot) => {
      const entry = player.hotbar[slot];
      let label = '';
      let usable = false;
      let cooldown = 0;
      if (entry?.kind === 'skill') {
        const skill = this.config.skills[entry.id];
        const left = player.skillCooldowns[entry.id] ?? 0;
        cooldown = skill ? left / skill.cooldown : 0;
        usable = !!skill && left <= 0 && player.mp >= skill.mpCost;
      } else if (entry?.kind === 'item') {
        const count = player.bag[entry.id] ?? 0;
        label = `×${count}`;
        usable = count > 0;
      }
      const iconId = entry?.id ?? '';
      if (view.icon.dataset.id !== iconId) {
        view.icon.dataset.id = iconId;
        view.icon.hidden = !iconId;
        if (iconId) view.icon.src = iconUrl(iconId);
      }
      view.label.textContent = label;
      view.button.classList.toggle('unusable', !usable);
      view.cooldown.style.height = `${cooldown * 100}%`;
    });
  }

  log(text: string, tone: 'gain' | 'bad' | 'plain' = 'plain'): void {
    const line = document.createElement('div');
    line.textContent = text;
    line.className = tone;
    this.logBox.append(line);
    while (this.logBox.children.length > LOG_LINES) this.logBox.firstElementChild?.remove();
  }
}

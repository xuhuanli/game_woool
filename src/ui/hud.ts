import type { DamageStat, GameConfig } from '../game/config';
import { realmName } from '../game/realm';
import { HOTBAR_SIZE, type World } from '../game/world';

const LOG_LINES = 7;
const STAT_NAMES: Record<DamageStat, string> = { attack: '攻击', magic: '魔法', dao: '道术' };

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`缺少 HUD 元素：${id}`);
  return element;
}

interface SlotView {
  button: HTMLButtonElement;
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
  private readonly bag = byId('hud-bag');
  private readonly logBox = byId('hud-log');
  private readonly slots: SlotView[] = [];

  constructor(private readonly config: GameConfig) {
    byId('hud').hidden = false;
    const hotbar = byId('hud-hotbar');
    for (let slot = 0; slot < HOTBAR_SIZE; slot++) {
      const button = document.createElement('button');
      const key = document.createElement('kbd');
      const label = document.createElement('span');
      const cooldown = document.createElement('i');
      key.textContent = `F${slot + 1}`;
      button.append(key, label, cooldown);
      button.addEventListener('click', () => this.onSlot(slot));
      hotbar.append(button);
      this.slots.push({ button, label, cooldown });
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
    this.expText.textContent = needed ? `${player.exp} / ${needed}` : '满级';
    this.statName.textContent = STAT_NAMES[primary];
    this.attack.textContent = `${player.stats[primary].min}-${player.stats[primary].max}`;
    this.gold.textContent = String(player.gold);
    this.weapon.textContent = player.weapon?.name ?? '无';
    this.bag.textContent =
      Object.entries(player.bag)
        .map(([id, count]) => `${this.config.items[id]?.name ?? id}×${count}`)
        .join('、') || '空';
    this.updateHotbar(world);
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
        label = skill?.name ?? '';
        const left = player.skillCooldowns[entry.id] ?? 0;
        cooldown = skill ? left / skill.cooldown : 0;
        usable = !!skill && left <= 0 && player.mp >= skill.mpCost;
      } else if (entry?.kind === 'item') {
        const count = player.bag[entry.id] ?? 0;
        label = `${this.config.items[entry.id]?.name ?? ''}×${count}`;
        usable = count > 0;
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

import type { GameConfig, NpcDef, QuestDef } from '../game/config';
import { equipmentColor, equipmentName, type Equipment } from '../game/equipment';
import { cellDistance } from '../game/grid';
import { questsForNpc, questStatus } from '../game/quests';
import type { World } from '../game/world';

const CLOSE_DISTANCE = 6;

type View =
  | { kind: 'home' }
  | { kind: 'shop' }
  | { kind: 'storage' }
  | { kind: 'dialogue'; quest: QuestDef; lines: string[]; index: number; finish: boolean };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

/** NPC 面板：寒暄、任务对话、商店和传送。 */
export class NpcPanel {
  private readonly panel = el('section', 'panel panel-npc');
  private npc: NpcDef | null = null;
  private view: View = { kind: 'home' };
  private signature = '';

  constructor(
    private readonly world: World,
    private readonly config: GameConfig,
  ) {
    this.panel.hidden = true;
    document.getElementById('hud')!.append(this.panel);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
  }

  open(npc: NpcDef): void {
    this.npc = npc;
    this.view = { kind: 'home' };
    this.signature = '';
    this.panel.hidden = false;
  }

  close(): void {
    this.npc = null;
    this.panel.hidden = true;
  }

  update(): void {
    const { npc, world } = this;
    if (!npc) return;
    if (npc.map !== world.mapId || cellDistance(world.player.cell, npc) > CLOSE_DISTANCE) {
      this.close();
      return;
    }
    const { player } = world;
    const signature = JSON.stringify([
      this.view,
      player.gold,
      player.level,
      player.bag,
      player.equipBag.map((equipment) => equipment.uid),
      player.storage.map((equipment) => equipment.uid),
      player.quests,
    ]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.render(npc);
  }

  private render(npc: NpcDef): void {
    const header = el('header', 'panel-title');
    const close = el('button', 'panel-close', '×');
    close.addEventListener('click', () => this.close());
    header.append(el('span', '', npc.name), close);

    const body = el('div', 'npc-body');
    if (this.view.kind === 'home') this.renderHome(npc, body);
    else if (this.view.kind === 'shop') this.renderShop(npc, body);
    else if (this.view.kind === 'storage') this.renderStorage(npc, body);
    else this.renderDialogue(this.view, body);
    this.panel.replaceChildren(header, body);
  }

  private renderHome(npc: NpcDef, body: HTMLElement): void {
    const { player } = this.world;
    for (const line of this.config.dialogues[npc.greeting] ?? []) {
      body.append(el('p', 'npc-line', line));
    }
    for (const quest of questsForNpc(this.config, npc.id)) {
      const status = questStatus(quest, player.quests, player.level, player.bag);
      if (status === 'available') {
        body.append(this.option(`可接：${quest.name}`, () => this.startDialogue(quest, false)));
      } else if (status === 'ready') {
        body.append(this.option(`完成：${quest.name}`, () => this.startDialogue(quest, true)));
      } else if (status === 'active') {
        body.append(el('p', 'detail-hint', `进行中：${quest.name}。${quest.summary}`));
      }
    }
    if (npc.shop) {
      body.append(this.option('打开商店', () => (this.view = { kind: 'shop' })));
    }
    if (npc.storage) {
      body.append(this.option('打开仓库', () => (this.view = { kind: 'storage' })));
    }
    npc.travel?.forEach((option, index) => {
      const need = option.level ? `，需要等级 ${option.level}` : '';
      const label = `传送到${option.name}（${option.cost} 灵石${need}）`;
      body.append(this.option(label, () => this.world.travel(npc, index)));
    });
  }

  private startDialogue(quest: QuestDef, finish: boolean): void {
    const lines = this.config.dialogues[finish ? quest.finish : quest.offer] ?? [];
    this.view = { kind: 'dialogue', quest, lines, index: 0, finish };
  }

  private renderDialogue(view: Extract<View, { kind: 'dialogue' }>, body: HTMLElement): void {
    const { quest, lines, index, finish } = view;
    body.append(el('p', 'npc-quest', quest.name), el('p', 'npc-line', lines[index] ?? ''));

    if (index < lines.length - 1) {
      body.append(this.option('继续', () => (this.view = { ...view, index: index + 1 })));
      return;
    }
    if (!finish) body.append(el('p', 'detail-hint', quest.summary));
    body.append(el('p', 'detail-hint', this.rewardText(quest)));
    const label = finish ? '完成任务' : '接受任务';
    body.append(
      this.option(label, () => {
        if (finish) this.world.turnInQuest(quest.id);
        else this.world.acceptQuest(quest.id);
        this.view = { kind: 'home' };
      }),
      this.option('稍后再说', () => (this.view = { kind: 'home' })),
    );
  }

  private rewardText(quest: QuestDef): string {
    const { exp, gold, items } = quest.rewards;
    const names = items.map(({ item, count }) => `${this.config.items[item]?.name ?? item}×${count}`);
    return `奖励：经验 ${exp}、灵石 ${gold}${names.length ? `、${names.join('、')}` : ''}`;
  }

  private renderShop(npc: NpcDef, body: HTMLElement): void {
    const { world, config } = this;
    const { player } = world;
    body.append(el('p', 'detail-hint', `灵石 ${player.gold}`), el('p', 'npc-quest', '购买'));
    for (const itemId of npc.shop ?? []) {
      const item = config.items[itemId];
      if (!item) continue;
      // 功法书只卖本职业、还没学会的
      const skill = config.skills[item.skill ?? ''];
      if (skill && (skill.classId !== player.def.id || player.skills.includes(skill.id))) continue;
      body.append(this.option(`${item.name}（${item.price} 灵石）`, () => world.buy(npc, itemId)));
    }

    body.append(el('p', 'npc-quest', '出售'));
    const { grades } = config.affixes;
    for (const grade of grades.slice(0, 2)) {
      const label = `一键卖出 ${grade.name}及以下法器`;
      body.append(this.option(label, () => world.sellAllUpToGrade(npc, grade.id)));
    }
    for (const equipment of player.equipBag) {
      const label = `${equipmentName(equipment, config)}（${world.sellPrice(equipment)} 灵石）`;
      const button = this.option(label, () => world.sellEquipment(npc, equipment.uid));
      button.style.color = equipmentColor(equipment, config);
      body.append(button);
    }
    for (const [itemId, count] of Object.entries(player.bag)) {
      const item = config.items[itemId];
      if (!item?.price) continue;
      const price = Math.floor(item.price * config.affixes.sellRatio);
      const label = `${item.name}×${count}（${price} 灵石）`;
      body.append(this.option(label, () => world.sellItem(npc, itemId)));
    }
    body.append(this.option('返回', () => (this.view = { kind: 'home' })));
  }

  private renderStorage(npc: NpcDef, body: HTMLElement): void {
    const { world, config } = this;
    const { player } = world;
    const list = (title: string, items: Equipment[], run: (uid: number) => void) => {
      body.append(el('p', 'npc-quest', title));
      for (const equipment of items) {
        const button = this.option(equipmentName(equipment, config), () => run(equipment.uid));
        button.style.color = equipmentColor(equipment, config);
        body.append(button);
      }
    };
    const capacity = config.affixes.storageCapacity;
    list(`仓库 ${player.storage.length}/${capacity}（点击取出）`, player.storage, (uid) =>
      world.withdraw(npc, uid),
    );
    list('背包（点击存入）', player.equipBag, (uid) => world.deposit(npc, uid));
    body.append(this.option('返回', () => (this.view = { kind: 'home' })));
  }

  private option(label: string, run: () => void): HTMLButtonElement {
    const button = el('button', 'npc-option', label);
    button.addEventListener('click', run);
    return button;
  }
}

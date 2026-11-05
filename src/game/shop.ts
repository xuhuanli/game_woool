import type { Cell, GameConfig, NpcDef } from './config';
import { rollEquipment, type Equipment } from './equipment';
import type { Inventory } from './inventory';
import type { Rng } from './rng';
import type { GameEvent, Player } from './types';

/** NPC 服务要用到的世界接口。 */
export interface ShopHost {
  readonly config: GameConfig;
  readonly player: Player;
  readonly inventory: Inventory;
  readonly rng: Rng;
  isNear(npc: NpcDef): boolean;
  questDone(questId: string): boolean;
  nextUid(): number;
  changeMap(mapId: string, cell: Cell): void;
  emit(event: GameEvent): void;
}

/** NPC 提供的服务：仓库、买卖、传送。 */
export class NpcServices {
  constructor(private readonly host: ShopHost) {}

  deposit(npc: NpcDef, uid: number): void {
    const { player } = this.host;
    const equipment = player.equipBag.find((candidate) => candidate.uid === uid);
    if (!equipment || !npc.storage || !this.host.isNear(npc)) return;
    if (player.storage.length >= this.host.config.affixes.storageCapacity) {
      this.host.emit({ type: 'message', text: '仓库已满' });
      return;
    }
    player.equipBag.splice(player.equipBag.indexOf(equipment), 1);
    player.storage.push(equipment);
  }

  withdraw(npc: NpcDef, uid: number): void {
    const { player } = this.host;
    const equipment = player.storage.find((candidate) => candidate.uid === uid);
    if (!equipment || !npc.storage || !this.host.isNear(npc)) return;
    if (this.host.inventory.bagIsFull()) {
      this.host.emit({ type: 'message', text: '背包已满' });
      return;
    }
    player.storage.splice(player.storage.indexOf(equipment), 1);
    player.equipBag.push(equipment);
  }

  /** 批量卖出背包里不高于某个品阶的法器。 */
  sellAllUpToGrade(npc: NpcDef, gradeId: string): void {
    const { grades } = this.host.config.affixes;
    const limit = grades.findIndex((grade) => grade.id === gradeId);
    if (!npc.shop || !this.host.isNear(npc)) return;
    const selling = this.host.player.equipBag.filter(
      (equipment) => grades.findIndex((grade) => grade.id === equipment.grade) <= limit,
    );
    for (const equipment of selling) this.sellEquipment(npc, equipment.uid);
  }

  buy(npc: NpcDef, itemId: string): void {
    const { player } = this.host;
    const item = this.host.config.items[itemId];
    if (!item?.price || !npc.shop?.includes(itemId) || !this.host.isNear(npc)) return;
    if (player.gold < item.price) {
      this.host.emit({ type: 'message', text: '灵石不足' });
      return;
    }
    if (item.kind === 'equip') {
      const lowest = { ...this.host.config.affixes, grades: this.host.config.affixes.grades.slice(0, 1) };
      if (!this.host.inventory.takeEquipment(rollEquipment(item, lowest, this.host.rng, this.host.nextUid()))) return;
    } else {
      this.host.inventory.addToBag(itemId, 1);
    }
    player.gold -= item.price;
    this.host.emit({ type: 'goldChanged', amount: -item.price });
  }

  sellPrice(equipment: Equipment): number {
    const { affixes, items } = this.host.config;
    const grade = affixes.grades.find((candidate) => candidate.id === equipment.grade);
    const price = items[equipment.itemId]?.price ?? 0;
    return Math.floor(price * affixes.sellRatio * (grade?.sellMultiplier ?? 1));
  }

  sellEquipment(npc: NpcDef, uid: number): void {
    const { player } = this.host;
    const equipment = player.equipBag.find((candidate) => candidate.uid === uid);
    if (!equipment || !npc.shop || !this.host.isNear(npc)) return;
    player.equipBag.splice(player.equipBag.indexOf(equipment), 1);
    const price = this.sellPrice(equipment);
    player.gold += price;
    this.host.emit({ type: 'goldChanged', amount: price });
  }

  sellItem(npc: NpcDef, itemId: string): void {
    const { player } = this.host;
    const price = this.host.config.items[itemId]?.price;
    if (!price || !player.bag[itemId] || !npc.shop || !this.host.isNear(npc)) return;
    this.host.inventory.removeFromBag(itemId);
    const earned = Math.floor(price * this.host.config.affixes.sellRatio);
    player.gold += earned;
    this.host.emit({ type: 'goldChanged', amount: earned });
  }

  travel(npc: NpcDef, index: number): void {
    const option = npc.travel?.[index];
    const { player } = this.host;
    if (!option || !this.host.isNear(npc)) return;
    if (option.requires && !this.host.questDone(option.requires)) {
      this.host.emit({ type: 'message', text: '这条路还没有打通' });
      return;
    }
    if ((option.level ?? 1) > player.level) {
      this.host.emit({ type: 'message', text: `需要等级 ${option.level}` });
      return;
    }
    if (player.gold < option.cost) {
      this.host.emit({ type: 'message', text: '灵石不足' });
      return;
    }
    player.gold -= option.cost;
    this.host.changeMap(option.map, option);
  }
}

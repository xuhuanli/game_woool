import type { GameConfig, ItemDef, SpecialDef } from './config';
import { EQUIP_SLOTS, slotsFor, type EquipSlot, type Equipment } from './equipment';
import type { Rng } from './rng';
import { refreshStats } from './stats';
import type { GameEvent, Player } from './types';

const BAG_FULL_NOTICE_SECONDS = 3;

/** 玩家的背包和法器：使用、穿戴、祭炼。 */
export class Inventory {
  private bagFullNoticeAt = -Infinity;

  constructor(
    private readonly config: GameConfig,
    private readonly player: Player,
    private readonly rng: Rng,
    private readonly now: () => number,
    private readonly emit: (event: GameEvent) => void,
    private readonly useScroll: (item: ItemDef) => void,
  ) {}

  /** 查找身上带某种特效的法宝。 */
  special<K extends SpecialDef['kind']>(kind: K): Extract<SpecialDef, { kind: K }> | null {
    for (const equipment of Object.values(this.player.equipment)) {
      const special = this.config.items[equipment.itemId]?.special;
      if (special?.kind === kind) return special as Extract<SpecialDef, { kind: K }>;
    }
    return null;
  }

  /** 功法修炼：消耗残卷和灵石，提高功法威力。 */
  upgradeSkill(skillId: string): void {
    const { player, config } = this;
    const { material, goldCost, maxLevel } = config.game.skillUpgrade;
    const skill = config.skills[skillId];
    const level = player.skillLevels[skillId] ?? 1;
    if (!skill || !player.skills.includes(skillId)) return;
    if (level >= maxLevel) {
      this.emit({ type: 'message', text: '功法已修至圆满' });
      return;
    }
    if (!player.bag[material]) {
      this.emit({ type: 'message', text: `缺少${config.items[material]?.name}` });
      return;
    }
    if (player.gold < goldCost) {
      this.emit({ type: 'message', text: '灵石不足' });
      return;
    }
    player.gold -= goldCost;
    this.removeFromBag(material);
    player.skillLevels[skillId] = level + 1;
    this.emit({ type: 'skillUpgraded', name: skill.name, level: level + 1 });
  }

  skillPower(skillId: string): number {
    const { powerPerLevel } = this.config.game.skillUpgrade;
    return 1 + powerPerLevel * ((this.player.skillLevels[skillId] ?? 1) - 1);
  }

  useItem(itemId: string): void {
    const player = this.player;
    const item = this.config.items[itemId];
    if (!player.hp || !item) return;
    if (!player.bag[itemId]) {
      this.emit({ type: 'message', text: `没有${item.name}了` });
      return;
    }
    if (item.scroll === 'fly') {
      this.emit({ type: 'message', text: `点任务栏右侧的靴子图标使用${item.name}` });
      return;
    }
    if (item.kind === 'scroll') {
      this.removeFromBag(itemId);
      this.useScroll(item);
      return;
    }
    if (item.kind === 'book') {
      this.readBook(item);
      return;
    }
    const healed = Math.min(item.heal ?? 0, player.stats.maxHp - player.hp);
    const refilled = Math.min(item.mana ?? 0, player.stats.maxMp - player.mp);
    if (healed <= 0 && refilled <= 0) return;
    player.hp += healed;
    player.mp += refilled;
    this.removeFromBag(itemId);
    if (healed > 0) this.emit({ type: 'heal', amount: healed });
    if (refilled > 0) this.emit({ type: 'mana', amount: refilled });
  }

  /** 研读功法书：本职业、等级够、还没学会才能用，学会后书就没了。 */
  private readBook(item: ItemDef): void {
    const player = this.player;
    const skill = this.config.skills[item.skill ?? ''];
    if (!skill) return;
    let refusal = '';
    if (skill.classId !== player.def.id) refusal = `${item.name}不是本职业的功法`;
    else if (this.knowsSkill(skill.id)) refusal = `已经学会${skill.name}`;
    else if (skill.level > player.level) refusal = `${skill.level} 级才能研读${item.name}`;
    else if (skill.replaces && !player.skills.includes(skill.replaces)) {
      refusal = `先学会${this.config.skills[skill.replaces]?.name}才能研读${item.name}`;
    }
    if (refusal) {
      this.emit({ type: 'message', text: refusal });
      return;
    }
    this.removeFromBag(item.id);
    this.learnSkill(skill.id);
  }

  /** 学会了这门功法，或者已经把它进阶成了别的功法。 */
  knowsSkill(skillId: string): boolean {
    return this.player.skills.some((id) => {
      for (let skill = this.config.skills[id]; skill; skill = this.config.skills[skill.replaces ?? '']) {
        if (skill.id === skillId) return true;
      }
      return false;
    });
  }

  /** 学会功法，放进快捷栏第一个空格；进阶功法顶替旧功法的位置和层数。 */
  learnSkill(skillId: string): void {
    const player = this.player;
    const skill = this.config.skills[skillId];
    if (!skill || player.skills.includes(skillId)) return;
    const old = skill.replaces ? this.config.skills[skill.replaces] : undefined;
    if (old && player.skills.includes(old.id)) {
      player.skills[player.skills.indexOf(old.id)] = skillId;
      player.hotbar = player.hotbar.map((entry) =>
        entry?.kind === 'skill' && entry.id === old.id ? { kind: 'skill', id: skillId } : entry,
      );
      if (player.skillLevels[old.id]) player.skillLevels[skillId] = player.skillLevels[old.id]!;
      delete player.skillLevels[old.id];
      delete player.skillCooldowns[old.id];
      this.emit({ type: 'skillLearned', skill, replaced: old });
      return;
    }
    player.skills.push(skillId);
    const slot = player.hotbar.indexOf(null);
    if (slot >= 0) player.hotbar[slot] = { kind: 'skill', id: skillId };
    this.emit({ type: 'skillLearned', skill });
  }

  /** 把背包里的法器穿上，同栏位优先用空位，否则替换第一个。 */
  equip(uid: number): void {
    const player = this.player;
    const equipment = player.equipBag.find((candidate) => candidate.uid === uid);
    const item = equipment && this.config.items[equipment.itemId];
    if (!player.hp || !equipment || !item) return;
    if ((item.level ?? 1) > player.level) {
      this.emit({ type: 'message', text: `需要等级 ${item.level}` });
      return;
    }
    const slots = slotsFor(item);
    const slot = slots.find((candidate) => !player.equipment[candidate]) ?? slots[0];
    if (!slot) return;

    player.equipBag.splice(player.equipBag.indexOf(equipment), 1);
    const replaced = player.equipment[slot];
    if (replaced) player.equipBag.push(replaced);
    player.equipment[slot] = equipment;
    refreshStats(this.player, this.config, this.now());
    this.emit({ type: 'equipped', equipment });
  }

  unequip(slot: EquipSlot): void {
    const player = this.player;
    const equipment = player.equipment[slot];
    if (!player.hp || !equipment) return;
    if (this.bagIsFull()) {
      this.emit({ type: 'message', text: '背包已满' });
      return;
    }
    delete player.equipment[slot];
    player.equipBag.push(equipment);
    refreshStats(this.player, this.config, this.now());
  }

  /** 祭炼武器：消耗祭炼石和灵石，成功加幸运，失败掉幸运。 */
  refine(uid: number): void {
    const player = this.player;
    const { refine } = this.config.affixes;
    const equipment = this.findEquipment(uid);
    if (!player.hp || !equipment) return;
    if (this.config.items[equipment.itemId]?.slot !== 'weapon') {
      this.emit({ type: 'message', text: '只有武器可以祭炼' });
      return;
    }
    if (equipment.luck >= refine.maxLuck) {
      this.emit({ type: 'message', text: '幸运已达上限' });
      return;
    }
    if (!player.bag[refine.material]) {
      this.emit({ type: 'message', text: `缺少${this.config.items[refine.material]?.name}` });
      return;
    }
    if (player.gold < refine.goldCost) {
      this.emit({ type: 'message', text: '灵石不足' });
      return;
    }

    player.gold -= refine.goldCost;
    this.removeFromBag(refine.material);
    const success = this.rng.chance(refine.chances[equipment.luck] ?? 0);
    equipment.luck = success
      ? equipment.luck + 1
      : Math.max(0, equipment.luck - refine.failLoss);
    refreshStats(this.player, this.config, this.now());
    this.emit({ type: 'refined', equipment, success });
  }

  findEquipment(uid: number): Equipment | null {
    const worn = Object.values(this.player.equipment);
    return [...worn, ...this.player.equipBag].find((item) => item.uid === uid) ?? null;
  }

  /** 收下法器，有空栏位且等级够时直接穿上。背包满时返回 false。 */
  takeEquipment(equipment: Equipment): boolean {
    const player = this.player;
    if (this.bagIsFull()) {
      if (this.now() - this.bagFullNoticeAt >= BAG_FULL_NOTICE_SECONDS) {
        this.bagFullNoticeAt = this.now();
        this.emit({ type: 'message', text: '背包已满' });
      }
      return false;
    }
    const item = this.config.items[equipment.itemId];
    player.equipBag.push(equipment);
    if (item && (item.level ?? 1) <= player.level && slotsFor(item).some((s) => !player.equipment[s])) {
      this.equip(equipment.uid);
    }
    return true;
  }

  /** 整理背包：法器按栏位、等级、品阶排，丹药符箓在前、功法书和材料在后。 */
  sortBag(): void {
    const { player, config } = this;
    const grades = config.affixes.grades.map((grade) => grade.id);
    const slotOrder = (itemId: string) => EQUIP_SLOTS.indexOf(slotsFor(config.items[itemId]!)[0] ?? 'weapon');
    player.equipBag.sort(
      (a, b) =>
        slotOrder(a.itemId) - slotOrder(b.itemId) ||
        (config.items[b.itemId]?.level ?? 1) - (config.items[a.itemId]?.level ?? 1) ||
        grades.indexOf(b.grade) - grades.indexOf(a.grade) ||
        a.uid - b.uid,
    );
    const kinds = ['potion', 'scroll', 'book', 'material'];
    const rank = (itemId: string) => {
      const item = config.items[itemId];
      return item ? kinds.indexOf(item.kind) * 1000 + (item.heal ?? item.mana ?? 0) / 1000 : Infinity;
    };
    const ids = Object.keys(player.bag).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    player.bag = Object.fromEntries(ids.map((id) => [id, player.bag[id]!]));
  }

  bagIsFull(): boolean {
    return this.player.equipBag.length >= this.config.affixes.bagCapacity;
  }

  addToBag(itemId: string, amount: number): void {
    this.player.bag[itemId] = (this.player.bag[itemId] ?? 0) + amount;
  }

  removeFromBag(itemId: string): void {
    const remaining = (this.player.bag[itemId] ?? 0) - 1;
    if (remaining > 0) this.player.bag[itemId] = remaining;
    else delete this.player.bag[itemId];
  }
}

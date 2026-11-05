import type { GameConfig, GardenHerbDef, RecipeDef } from './config';
import type { Inventory } from './inventory';
import type { GameEvent, GardenPlot, GardenState, Player } from './types';

export function emptyPlot(): GardenPlot {
  return { herb: null, plantedAt: 0, readyAt: 0, last: null };
}

export function emptyGarden(config: GameConfig, now: number): GardenState {
  return {
    plots: Array.from({ length: config.garden.plots.initial }, emptyPlot),
    dew: 0,
    dewAt: now,
    harvested: {},
  };
}

/**
 * 掌天瓶药园。生长和绿液都按真实时间算，时钟由外面传入，
 * 这样关掉游戏也照长，测试也能给假时钟。
 */
export class Garden {
  private notifiedReady = 0;

  constructor(
    private readonly config: GameConfig,
    private readonly player: Player,
    private readonly inventory: Inventory,
    private readonly now: () => number,
    private readonly emit: (event: GameEvent) => void,
  ) {}

  private get state(): GardenState {
    return this.player.garden;
  }

  get unlocked(): boolean {
    return this.player.quests.completed.includes(this.config.garden.unlockQuest);
  }

  /** 瓶力跟境界走：练气一级到元婴四级。 */
  get tier(): number {
    const { realms } = this.config;
    const index = realms.findIndex((realm) => this.player.level >= realm.minLevel && this.player.level <= realm.maxLevel);
    return Math.max(0, index === -1 ? realms.length - 1 : index);
  }

  get dewMax(): number {
    const { max } = this.config.garden.dew;
    return max[Math.min(this.tier, max.length - 1)]!;
  }

  get dewSeconds(): number {
    const { perSeconds } = this.config.garden.dew;
    return perSeconds[Math.min(this.tier, perSeconds.length - 1)]!;
  }

  /** 下一滴绿液还要多少毫秒，满了返回 0。 */
  get nextDewIn(): number {
    if (this.state.dew >= this.dewMax) return 0;
    return Math.max(0, this.state.dewAt + this.dewSeconds * 1000 - this.now());
  }

  get readyCount(): number {
    return this.state.plots.filter((_, index) => this.isReady(index)).length;
  }

  /** 下一块地的扩建条件，已经扩满时返回 null。 */
  get nextExpansion(): { level: number; gold: number } | null {
    const { initial, expansions } = this.config.garden.plots;
    return expansions[this.state.plots.length - initial] ?? null;
  }

  herb(id: string | null): GardenHerbDef | undefined {
    return this.config.garden.herbs.find((herb) => herb.item === id);
  }

  isReady(index: number): boolean {
    const plot = this.state.plots[index];
    return !!plot?.herb && this.now() >= plot.readyAt;
  }

  /** 离成熟还有多少毫秒。 */
  remaining(index: number): number {
    const plot = this.state.plots[index];
    return plot?.herb ? Math.max(0, plot.readyAt - this.now()) : 0;
  }

  /** 生长进度 0～1。 */
  growth(index: number): number {
    const plot = this.state.plots[index];
    if (!plot?.herb) return 0;
    const span = plot.readyAt - plot.plantedAt;
    return span <= 0 ? 1 : Math.min(1, Math.max(0, (this.now() - plot.plantedAt) / span));
  }

  /** 凝聚绿液；新有灵药成熟时提示一次。 */
  refresh(): void {
    const state = this.state;
    const now = this.now();
    if (!this.unlocked) {
      state.dewAt = now;
      return;
    }
    const step = this.dewSeconds * 1000;
    if (state.dew >= this.dewMax) {
      state.dewAt = now;
    } else {
      const gained = Math.floor((now - state.dewAt) / step);
      if (gained > 0) {
        state.dew = Math.min(this.dewMax, state.dew + gained);
        state.dewAt = state.dew >= this.dewMax ? now : state.dewAt + gained * step;
        this.emit({ type: 'gardenChanged' });
      }
    }
    const ready = this.readyCount;
    if (this.unlocked && ready > this.notifiedReady) this.emit({ type: 'gardenReady', count: ready });
    this.notifiedReady = ready;
  }

  /** 读档时把成熟时间夹回合理范围，系统时间往回调也不会长成几万小时。 */
  clamp(): void {
    const now = this.now();
    for (const plot of this.state.plots) {
      const herb = this.herb(plot.herb);
      if (!herb) {
        Object.assign(plot, { herb: null, plantedAt: 0, readyAt: 0 });
        continue;
      }
      plot.readyAt = Math.min(plot.readyAt, now + herb.growSeconds * 1000);
      plot.plantedAt = Math.min(plot.plantedAt, plot.readyAt - herb.growSeconds * 1000);
    }
    this.state.dewAt = Math.min(this.state.dewAt, now);
    this.state.dew = Math.min(this.state.dew, this.dewMax);
    this.notifiedReady = this.readyCount;
  }

  /** 播种。背包里没有种子时就地按种子价买一颗。 */
  plant(index: number, herbId: string, quiet = false): boolean {
    const plot = this.state.plots[index];
    const herb = this.herb(herbId);
    const fail = (text: string) => {
      if (!quiet) this.emit({ type: 'message', text });
      return false;
    };
    if (!this.unlocked) return fail('还没有掌天瓶');
    if (!plot || plot.herb || !herb) return false;
    if (this.player.level < herb.level) return fail(`${herb.level} 级才能种`);
    if (!this.player.bag[herb.seed]) {
      const price = this.config.items[herb.seed]?.price ?? 0;
      if (!price) return fail(`${this.config.items[herb.seed]?.name ?? '种子'}买不到，只能打怪得到`);
      if (this.player.gold < price) return fail('种子不够，灵石也不够');
      this.player.gold -= price;
      this.emit({ type: 'goldChanged', amount: -price });
    } else {
      this.inventory.removeFromBag(herb.seed);
    }
    const now = this.now();
    Object.assign(plot, { herb: herb.item, plantedAt: now, readyAt: now + herb.growSeconds * 1000, last: herb.item });
    this.emit({ type: 'gardenChanged' });
    return true;
  }

  harvest(index: number): boolean {
    const plot = this.state.plots[index];
    const herb = this.herb(plot?.herb ?? null);
    if (!plot || !herb || !this.isReady(index)) return false;
    this.inventory.addToBag(herb.item, herb.yield);
    this.state.harvested[herb.item] = (this.state.harvested[herb.item] ?? 0) + herb.yield;
    Object.assign(plot, { herb: null, plantedAt: 0, readyAt: 0 });
    this.notifiedReady = this.readyCount;
    this.emit({ type: 'gardenChanged' });
    return true;
  }

  harvestAll(): number {
    let count = 0;
    this.state.plots.forEach((_, index) => {
      if (this.harvest(index)) count += 1;
    });
    return count;
  }

  /** 一滴绿液让长过一半的灵药立即成熟。 */
  accelerate(index: number): boolean {
    const plot = this.state.plots[index];
    if (!plot?.herb || this.isReady(index) || this.state.dew < 1) return false;
    if (this.growth(index) < this.config.garden.dew.minGrowth) {
      this.emit({ type: 'message', text: '灵药还没长过一半，绿液催不动' });
      return false;
    }
    plot.readyAt = this.now();
    this.state.dew -= 1;
    this.emit({ type: 'gardenChanged' });
    return true;
  }

  /** 按每块空地上次种的灵药重新播种，种子和灵石不够的地跳过。 */
  replantAll(): number {
    let count = 0;
    this.state.plots.forEach((plot, index) => {
      if (!plot.herb && plot.last && this.plant(index, plot.last, true)) count += 1;
    });
    return count;
  }

  recipe(id: string): RecipeDef | undefined {
    return this.config.garden.recipes.find((recipe) => recipe.id === id);
  }

  /** 现有材料和灵石最多能炼几炉，等级不够是 0。 */
  maxBrews(recipe: RecipeDef): number {
    const { player } = this;
    if (!this.unlocked || player.level < recipe.level) return 0;
    let times = recipe.gold > 0 ? Math.floor(player.gold / recipe.gold) : Infinity;
    for (const { item, count } of recipe.materials) times = Math.min(times, Math.floor((player.bag[item] ?? 0) / count));
    return Number.isFinite(times) ? times : 0;
  }

  /** 炼丹必成：扣材料和灵石，出丹。times 超过能炼的炉数时按能炼的算。 */
  brew(recipeId: string, times = 1): number {
    const recipe = this.recipe(recipeId);
    if (!recipe || !this.unlocked) return 0;
    if (this.player.level < recipe.level) {
      this.emit({ type: 'message', text: `${recipe.level} 级才能炼` });
      return 0;
    }
    const brews = Math.min(times, this.maxBrews(recipe));
    if (brews <= 0) {
      this.emit({ type: 'message', text: '材料或灵石不够' });
      return 0;
    }
    for (const { item, count } of recipe.materials) {
      for (let i = 0; i < count * brews; i++) this.inventory.removeFromBag(item);
    }
    if (recipe.gold > 0) {
      this.player.gold -= recipe.gold * brews;
      this.emit({ type: 'goldChanged', amount: -recipe.gold * brews });
    }
    const made = recipe.count * brews;
    this.inventory.addToBag(recipe.output, made);
    this.emit({ type: 'brewed', name: this.config.items[recipe.output]?.name ?? recipe.output, count: made });
    this.emit({ type: 'gardenChanged' });
    return made;
  }

  expand(): boolean {
    const next = this.nextExpansion;
    if (!this.unlocked || !next) return false;
    if (this.player.level < next.level) {
      this.emit({ type: 'message', text: `${next.level} 级才能再开一块药圃` });
      return false;
    }
    if (this.player.gold < next.gold) {
      this.emit({ type: 'message', text: '灵石不足' });
      return false;
    }
    this.player.gold -= next.gold;
    this.emit({ type: 'goldChanged', amount: -next.gold });
    this.state.plots.push(emptyPlot());
    this.emit({ type: 'gardenChanged' });
    return true;
  }
}

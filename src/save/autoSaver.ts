import type { GameEvent, World } from '../game/world';
import type { SaveStore } from './saveStore';

const INTERVAL_SECONDS = 30;
const MIN_GAP_SECONDS = 1;

/** 这些事件之后要尽快保存，避免丢失重要进度。 */
const IMPORTANT_EVENTS = new Set<GameEvent['type']>([
  'equipped',
  'refined',
  'levelUp',
  'skillLearned',
  'death',
  'mapChanged',
  'questAccepted',
  'questCompleted',
  'goldChanged',
  'breakthrough',
]);

export class AutoSaver {
  private sinceSave = 0;
  private dirty = false;
  private stopped = false;

  constructor(
    private readonly world: World,
    private readonly store: SaveStore,
    private readonly onError: (error: unknown) => void,
  ) {}

  notify(event: GameEvent): void {
    const pickedEquipment = event.type === 'pickedUp' && event.item.equipment;
    if (IMPORTANT_EVENTS.has(event.type) || pickedEquipment) this.dirty = true;
  }

  update(dt: number): void {
    this.sinceSave += dt;
    const due = this.sinceSave >= INTERVAL_SECONDS;
    if (due || (this.dirty && this.sinceSave >= MIN_GAP_SECONDS)) void this.saveNow();
  }

  async saveNow(): Promise<void> {
    if (this.stopped) return;
    this.sinceSave = 0;
    this.dirty = false;
    try {
      await this.store.save(this.world.toSave(Date.now()));
    } catch (error) {
      this.onError(error);
    }
  }

  /** 导入或删除存档后调用，防止旧进度写回去覆盖新存档。 */
  stop(): void {
    this.stopped = true;
  }
}

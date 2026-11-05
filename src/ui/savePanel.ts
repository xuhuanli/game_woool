import type { World } from '../game/world';
import type { AutoSaver } from '../save/autoSaver';
import { loadSlots, slotSummary, type LoadedSlot } from '../save/saveSlots';
import { clearRawSlot, SLOT_COUNT, writeRawSlot, type SaveStore } from '../save/saveStore';
import type { Hud } from './hud';
import { downloadSave, pickSaveFile } from './saveTransfer';

/**
 * 存档面板：当前槽位的保存、导出、导入、清空，以及和其他槽位互拷。
 * 槽位号在开局时定下，换槽等于换存档——想换用「返回开始界面」。
 */
export class SavePanel {
  private readonly panel = document.createElement('section');
  private readonly slotList = document.createElement('div');
  private readonly title = document.createElement('header');
  private readonly current = document.createElement('p');
  private refreshToken = 0;

  constructor(
    private readonly world: World,
    private readonly store: SaveStore,
    private readonly saver: AutoSaver,
    private readonly hud: Hud,
    readonly slot: number,
  ) {
    this.panel.className = 'panel panel-save';
    this.panel.hidden = true;

    this.title.className = 'panel-title';
    this.title.textContent = `存档 · ${slot} 号槽`;
    this.current.className = 'detail-hint';

    const actions = document.createElement('div');
    actions.className = 'save-actions';
    actions.append(
      this.button('立即保存', () => this.saveNow()),
      this.button('导出存档', () => downloadSave(this.world.toSave(Date.now()))),
      this.button('导入到本槽', () => this.importSave()),
      this.button('返回开始界面', () => this.backToTitle()),
      this.button('清空本槽', () => this.clearCurrent()),
    );

    const otherTitle = document.createElement('div');
    otherTitle.className = 'save-section-title';
    otherTitle.textContent = '其他槽位';

    this.slotList.className = 'save-slots';

    const hint = document.createElement('p');
    hint.className = 'detail-hint';
    hint.textContent = `「存入」会把当前进度覆盖到该槽位，可用来备份，或换个槽位开另一个职业；共 ${SLOT_COUNT} 个槽。`;

    this.panel.append(this.title, this.current, actions, otherTitle, this.slotList, hint);
    document.getElementById('hud')!.append(this.panel);
    document.getElementById('hud-open-save')!.addEventListener('click', () => {
      this.panel.hidden = !this.panel.hidden;
      if (!this.panel.hidden) void this.refresh();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.panel.hidden = true;
    });
  }

  private button(label: string, run: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'detail-action';
    button.textContent = label;
    button.addEventListener('click', run);
    return button;
  }

  /** 面板里那行「当前进度」和其他槽位列表，每次打开和操作后刷新。 */
  private async refresh(): Promise<void> {
    const token = ++this.refreshToken;
    const { player } = this.world;
    this.current.textContent = `当前进度：${player.name} · ${player.def.name} · ${player.level} 级，保存在 ${this.slot} 号槽。`;
    let slots: LoadedSlot[];
    try {
      slots = await loadSlots();
    } catch (error) {
      this.hud.log(error instanceof Error ? error.message : '读取存档失败', 'bad');
      return;
    }
    if (token !== this.refreshToken) return;
    this.slotList.replaceChildren();
    for (const entry of slots) {
      if (entry.slot === this.slot) continue;
      this.slotList.append(this.otherRow(entry));
    }
  }

  private otherRow(entry: LoadedSlot): HTMLElement {
    const row = document.createElement('div');
    row.className = 'save-slot';

    const label = document.createElement('span');
    label.className = 'save-slot-label';
    label.textContent = `${entry.slot} 号槽：${slotSummary(this.world.config, entry, Date.now())}`;

    const actions = document.createElement('span');
    actions.className = 'save-slot-actions';

    const copy = document.createElement('button');
    copy.className = 'detail-action';
    copy.textContent = '存入';
    copy.addEventListener('click', () => {
      const question = entry.save
        ? `用当前进度覆盖 ${entry.slot} 号槽「${entry.save.player.name}」？`
        : `把当前进度存到 ${entry.slot} 号槽？`;
      if (!window.confirm(question)) return;
      void writeRawSlot(entry.slot, this.world.toSave(Date.now()))
        .then(() => {
          this.hud.log(`已存入 ${entry.slot} 号槽`, 'gain');
          return this.refresh();
        })
        .catch((error: unknown) => this.hud.log(error instanceof Error ? error.message : '写入失败', 'bad'));
    });

    const remove = document.createElement('button');
    remove.className = 'detail-action';
    remove.textContent = '清空';
    remove.disabled = !entry.save && !entry.error;
    remove.addEventListener('click', () => {
      if (!window.confirm(`清空 ${entry.slot} 号槽？无法恢复。`)) return;
      void clearRawSlot(entry.slot)
        .then(() => this.refresh())
        .catch((error: unknown) => this.hud.log(error instanceof Error ? error.message : '清空失败', 'bad'));
    });

    actions.append(copy, remove);
    row.append(label, actions);
    return row;
  }

  private async saveNow(): Promise<void> {
    await this.saver.saveNow();
    this.hud.log(`已保存到 ${this.slot} 号槽`, 'gain');
    await this.refresh();
  }

  private importSave(): void {
    pickSaveFile((picked) => {
      picked
        .then(async (save) => {
          if (!window.confirm(`导入「${save.player.name}」会覆盖 ${this.slot} 号槽的当前进度，确定吗？`)) return;
          this.saver.stop();
          await writeRawSlot(this.slot, save);
          location.reload();
        })
        .catch((error: unknown) => {
          this.hud.log(error instanceof Error ? error.message : '导入失败', 'bad');
        });
    });
  }

  private async backToTitle(): Promise<void> {
    await this.saver.saveNow();
    location.reload();
  }

  private async clearCurrent(): Promise<void> {
    if (!window.confirm(`清空 ${this.slot} 号槽？清空后回到开始界面。`)) return;
    this.saver.stop();
    await this.store.clear();
    location.reload();
  }
}

import type { World } from '../game/world';
import type { AutoSaver } from '../save/autoSaver';
import type { SaveStore } from '../save/saveStore';
import type { Hud } from './hud';
import { downloadSave, pickSaveFile } from './saveTransfer';

/** 存档面板：手动保存、导出、导入、删除。 */
export class SavePanel {
  private readonly panel = document.createElement('section');

  constructor(
    private readonly world: World,
    private readonly store: SaveStore,
    private readonly saver: AutoSaver,
    private readonly hud: Hud,
  ) {
    this.panel.className = 'panel panel-save';
    this.panel.hidden = true;

    const title = document.createElement('header');
    title.className = 'panel-title';
    title.textContent = '存档';

    const actions = document.createElement('div');
    actions.className = 'save-actions';
    actions.append(
      this.button('立即保存', () => this.saveNow()),
      this.button('导出存档', () => downloadSave(this.world.toSave(Date.now()))),
      this.button('导入存档', () => this.importSave()),
      this.button('删除存档', () => this.deleteSave()),
    );

    const hint = document.createElement('p');
    hint.className = 'detail-hint';
    hint.textContent = '游戏会自动保存。存档在浏览器里，清除浏览器数据前请先导出。';

    this.panel.append(title, actions, hint);
    document.getElementById('hud')!.append(this.panel);
    document.getElementById('hud-open-save')!.addEventListener('click', () => {
      this.panel.hidden = !this.panel.hidden;
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

  private async saveNow(): Promise<void> {
    await this.saver.saveNow();
    this.hud.log('已保存', 'gain');
  }

  private importSave(): void {
    pickSaveFile((picked) => {
      picked
        .then(async (save) => {
          if (!window.confirm(`导入 ${save.player.name} 的存档会覆盖当前进度，确定吗？`)) return;
          this.saver.stop();
          await this.store.save(save);
          location.reload();
        })
        .catch((error: unknown) => {
          this.hud.log(error instanceof Error ? error.message : '导入失败', 'bad');
        });
    });
  }

  private async deleteSave(): Promise<void> {
    if (!window.confirm('删除后无法恢复，确定删除存档吗？')) return;
    this.saver.stop();
    await this.store.clear();
    location.reload();
  }
}

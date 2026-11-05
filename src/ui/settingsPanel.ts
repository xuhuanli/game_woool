import type { GameSettings, Quality, SettingsStore } from '../game/settings';

type VolumeKey = 'master' | 'music' | 'sfx';

const VOLUMES: { key: VolumeKey; label: string }[] = [
  { key: 'master', label: '主音量' },
  { key: 'music', label: '音乐' },
  { key: 'sfx', label: '音效' },
];

const QUALITY: { value: Quality; label: string }[] = [
  { value: 'high', label: '高' },
  { value: 'low', label: '低' },
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

/**
 * 设置面板：三条音量滑杆、画质、飘叶。O 键开关。
 * 存的是本机偏好（localStorage），不写进存档；静音仍走 M 键。
 */
export class SettingsPanel {
  private readonly panel = el('section', 'panel panel-settings');
  private readonly sliders: { key: VolumeKey; input: HTMLInputElement; value: HTMLElement }[] = [];
  private readonly quality = document.createElement('select');
  private readonly leaves = document.createElement('input');
  private syncing = false;

  constructor(private readonly settings: SettingsStore) {
    this.panel.hidden = true;

    const title = el('header', 'panel-title');
    title.append(el('span', '', '设置'), this.closeButton());

    const volumes = el('div', 'settings-group');
    volumes.append(el('div', 'settings-group-title', '音量'));
    for (const { key, label } of VOLUMES) volumes.append(this.volumeRow(key, label));

    const display = el('div', 'settings-group');
    display.append(el('div', 'settings-group-title', '画面'));
    display.append(this.qualityRow());
    display.append(this.leavesRow());
    display.append(el('p', 'detail-hint', '低画质关掉水面波光，飘叶间隔翻倍。'));

    const actions = el('div', 'settings-actions');
    const reset = el('button', 'detail-action', '恢复默认');
    reset.addEventListener('click', () => this.settings.reset());
    actions.append(reset);

    const hint = el('p', 'detail-hint', 'M 键随时静音。设置只存在这台电脑的浏览器里，不写进存档。');

    this.panel.append(title, volumes, display, actions, hint);
    document.getElementById('hud')!.append(this.panel);
    document.getElementById('hud-open-settings')!.addEventListener('click', () => this.toggle());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'o' || event.key === 'O') this.toggle();
      else if (event.key === 'Escape') this.panel.hidden = true;
    });

    this.settings.onChange((value) => this.sync(value));
    this.sync(this.settings.value);
  }

  private toggle(): void {
    this.panel.hidden = !this.panel.hidden;
    if (!this.panel.hidden) this.sync(this.settings.value);
  }

  private closeButton(): HTMLButtonElement {
    const button = el('button', 'panel-close', '×');
    button.title = '关闭 (Esc)';
    button.addEventListener('click', () => (this.panel.hidden = true));
    return button;
  }

  private volumeRow(key: VolumeKey, label: string): HTMLElement {
    const row = el('div', 'settings-field');
    const head = el('div', 'settings-label');
    const value = el('b', '', '');
    head.append(el('span', '', label), value);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '5';
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => {
      const patch: Partial<GameSettings> = {};
      patch[key] = Number(input.value) / 100;
      this.settings.update(patch);
    });

    row.append(head, input);
    this.sliders.push({ key, input, value });
    return row;
  }

  private qualityRow(): HTMLElement {
    const row = el('label', 'settings-row');
    row.append(el('span', '', '画质'));
    for (const option of QUALITY) {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      this.quality.append(node);
    }
    this.quality.addEventListener('change', () => {
      this.settings.update({ quality: this.quality.value as Quality });
    });
    row.append(this.quality);
    return row;
  }

  private leavesRow(): HTMLElement {
    const row = el('label', 'settings-row');
    row.append(el('span', '', '野外飘叶'));
    this.leaves.type = 'checkbox';
    this.leaves.addEventListener('change', () => {
      this.settings.update({ leaves: this.leaves.checked });
    });
    row.append(this.leaves);
    return row;
  }

  /** 外部改动（比如恢复默认）之后把控件同步回来，正在拖的滑杆不动。 */
  private sync(value: GameSettings): void {
    if (this.syncing) return;
    this.syncing = true;
    for (const slider of this.sliders) {
      const percent = String(Math.round(value[slider.key] * 100));
      if (slider.input.value !== percent) slider.input.value = percent;
      slider.value.textContent = `${percent}%`;
    }
    if (this.quality.value !== value.quality) this.quality.value = value.quality;
    this.leaves.checked = value.leaves;
    this.syncing = false;
  }
}

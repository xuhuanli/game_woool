import type { AutoSettings } from '../game/types';
import type { World } from '../game/world';

/** 挂机开关和设置。A 键切换开关。 */
export class AutoPanel {
  private readonly panel = document.createElement('section');
  private readonly status = document.getElementById('hud-auto')!;
  private readonly toggleButton = document.createElement('button');

  constructor(private readonly world: World) {
    this.panel.className = 'panel panel-auto';
    this.panel.hidden = true;

    const title = document.createElement('header');
    title.className = 'panel-title';
    title.textContent = '挂机';

    this.toggleButton.className = 'detail-action';
    this.toggleButton.addEventListener('click', () => this.toggle());

    const hint = document.createElement('p');
    hint.className = 'detail-hint';
    hint.textContent = '自动打怪和拾取，不打 Boss。低血回城后挂机会关闭。';

    this.panel.append(
      title,
      this.toggleButton,
      this.gradeField(),
      this.percentField('生命低于多少时吃药', 'potionBelow'),
      this.percentField('生命低于多少时回城（0 为不回城）', 'recallBelow'),
      hint,
    );
    document.getElementById('hud')!.append(this.panel);
    document.getElementById('hud-open-auto')!.addEventListener('click', () => {
      this.panel.hidden = !this.panel.hidden;
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'a' || event.key === 'A') this.toggle();
      else if (event.key === 'Escape') this.panel.hidden = true;
    });
  }

  update(): void {
    const { auto } = this.world.player;
    const safe = this.world.map.safe;
    this.status.hidden = !auto.enabled;
    this.status.textContent = safe ? '挂机待命（主城不打怪）' : '挂机中';
    this.toggleButton.textContent = auto.enabled ? '停止挂机' : '开始挂机';
  }

  private toggle(): void {
    const { auto } = this.world.player;
    auto.enabled = !auto.enabled;
  }

  private gradeField(): HTMLElement {
    const label = document.createElement('label');
    label.className = 'auto-field';
    label.textContent = '拾取法器的最低品阶';
    const select = document.createElement('select');
    for (const grade of this.world.config.affixes.grades) {
      select.add(new Option(grade.name, grade.id));
    }
    select.value = this.world.player.auto.minGrade;
    select.addEventListener('change', () => {
      this.world.player.auto.minGrade = select.value;
    });
    label.append(select);
    return label;
  }

  private percentField(text: string, key: 'potionBelow' | 'recallBelow'): HTMLElement {
    const settings: AutoSettings = this.world.player.auto;
    const label = document.createElement('label');
    label.className = 'auto-field';
    label.textContent = text;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.step = '5';
    input.value = String(Math.round(settings[key] * 100));
    input.addEventListener('change', () => {
      const percent = Math.min(100, Math.max(0, Number(input.value) || 0));
      input.value = String(percent);
      settings[key] = percent / 100;
    });
    label.append(input);
    return label;
  }
}

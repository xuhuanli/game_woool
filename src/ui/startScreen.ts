import type { GameConfig } from '../game/config';
import type { SaveData } from '../save/saveData';
import type { LoadedSlot } from '../save/saveSlots';
import { slotSummary } from '../save/saveSlots';
import { SLOT_COUNT } from '../save/saveStore';
import { pickSaveFile } from './saveTransfer';

export type StartChoice =
  | { kind: 'continue'; save: SaveData; slot: number }
  | { kind: 'new'; name: string; classId: string; slot: number };

export interface StartDeps {
  clearSlot: (slot: number) => Promise<void>;
  writeSlot: (slot: number, save: SaveData) => Promise<void>;
}

const NAME_MAX_LENGTH = 12;
const DEFAULT_NAME = '无名修士';

/** 默认选中上次玩的槽位；没玩过就选第一个空槽，全满就用 1 号。 */
function pickSlot(slots: LoadedSlot[], activeSlot: number): number {
  const active = slots.find((entry) => entry.slot === activeSlot);
  if (active) return active.slot;
  const empty = slots.find((entry) => !entry.save && !entry.error);
  return empty?.slot ?? 1;
}

/**
 * 开始界面：三个槽位，各显示角色、职业、境界和上次保存时间。
 * 选中槽位后点职业就是「在该槽开新档」，导入的存档也写进选中的槽。
 */
export function showStartScreen(
  config: GameConfig,
  slots: LoadedSlot[],
  activeSlot: number,
  deps: StartDeps,
): Promise<StartChoice> {
  return new Promise((resolve) => {
    let selected = pickSlot(slots, activeSlot);
    const screen = document.createElement('div');
    screen.className = 'create';

    const finish = (choice: StartChoice) => {
      screen.remove();
      resolve(choice);
    };

    const title = document.createElement('h1');
    title.textContent = '踏入仙途';
    screen.append(title);

    const status = document.createElement('p');
    status.className = 'create-status';
    screen.append(status);

    const slotList = document.createElement('div');
    slotList.className = 'create-slots';
    screen.append(slotList);

    const hint = document.createElement('p');
    hint.className = 'create-hint';
    hint.textContent = `选中槽位后点职业开新档；导入的存档也会写进选中的槽位（共 ${SLOT_COUNT} 个）。`;
    screen.append(hint);

    let importButton: HTMLButtonElement | null = null;

    const renderSlots = () => {
      slotList.replaceChildren();
      for (const entry of slots) {
        slotList.append(slotRow(entry));
      }
      if (importButton) importButton.textContent = `导入存档文件到 ${selected} 号槽`;
    };

    const slotRow = (entry: LoadedSlot): HTMLElement => {
      const row = document.createElement('div');
      row.className = entry.slot === selected ? 'create-slot selected' : 'create-slot';

      const pick = document.createElement('button');
      pick.className = 'create-slot-pick';
      const label = document.createElement('b');
      label.textContent = `${entry.slot} 号槽`;
      const summary = document.createElement('span');
      summary.textContent = slotSummary(config, entry, Date.now());
      pick.append(label, summary);
      pick.addEventListener('click', () => {
        selected = entry.slot;
        renderSlots();
      });
      row.append(pick);

      const actions = document.createElement('div');
      actions.className = 'create-slot-actions';
      if (entry.save) {
        const resume = document.createElement('button');
        resume.className = 'create-continue';
        resume.textContent = '继续';
        resume.addEventListener('click', () => finish({ kind: 'continue', save: entry.save!, slot: entry.slot }));
        actions.append(resume);
      }
      if (entry.save || entry.error) {
        const remove = document.createElement('button');
        remove.className = 'create-slot-delete';
        remove.textContent = '删除';
        remove.addEventListener('click', () => {
          const name = entry.save?.player.name ?? `${entry.slot} 号槽`;
          if (!window.confirm(`删除「${name}」的存档？无法恢复。`)) return;
          void deps
            .clearSlot(entry.slot)
            .then(() => {
              const index = slots.indexOf(entry);
              slots[index] = { slot: entry.slot, save: null, error: '' };
              renderSlots();
            })
            .catch((error: unknown) => {
              status.textContent = error instanceof Error ? error.message : '删除失败';
            });
        });
        actions.append(remove);
      }
      row.append(actions);
      return row;
    };

    renderSlots();

    const nameInput = document.createElement('input');
    nameInput.placeholder = '输入主角名字';
    nameInput.maxLength = NAME_MAX_LENGTH;
    screen.append(nameInput);

    const classes = document.createElement('div');
    classes.className = 'create-classes';
    for (const classDef of Object.values(config.classes)) {
      const card = document.createElement('button');
      const name = document.createElement('b');
      const description = document.createElement('span');
      name.textContent = classDef.name;
      description.textContent = classDef.description;
      card.append(name, description);
      card.addEventListener('click', () => {
        const target = slots.find((entry) => entry.slot === selected);
        if (target?.save && !window.confirm(`会覆盖 ${selected} 号槽「${target.save.player.name}」的存档，确定吗？`)) {
          return;
        }
        finish({
          kind: 'new',
          name: nameInput.value.trim() || DEFAULT_NAME,
          classId: classDef.id,
          slot: selected,
        });
      });
      classes.append(card);
    }
    screen.append(classes);

    const button = document.createElement('button');
    button.className = 'create-import';
    button.textContent = `导入存档文件到 ${selected} 号槽`;
    button.addEventListener('click', () => {
      pickSaveFile((picked) => {
        picked
          .then(async (imported) => {
            const target = slots.find((entry) => entry.slot === selected);
            if (target?.save && !window.confirm(`会覆盖 ${selected} 号槽「${target.save.player.name}」的存档，确定吗？`)) return;
            await deps.writeSlot(selected, imported);
            finish({ kind: 'continue', save: imported, slot: selected });
          })
          .catch((error: unknown) => {
            status.textContent = error instanceof Error ? error.message : '导入失败';
          });
      });
    });
    importButton = button;
    screen.append(button);

    document.body.append(screen);
    nameInput.focus();
  });
}

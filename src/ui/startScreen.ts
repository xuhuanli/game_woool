import type { GameConfig } from '../game/config';
import { realmName } from '../game/realm';
import { migrateSave, type SaveData } from '../save/saveData';
import type { SaveStore } from '../save/saveStore';
import { pickSaveFile } from './saveTransfer';

export type StartChoice =
  | { kind: 'continue'; save: SaveData }
  | { kind: 'new'; name: string; classId: string };

const NAME_MAX_LENGTH = 12;
const DEFAULT_NAME = '无名修士';

/** 显示开始界面：有存档时可以继续，也可以导入存档或新建角色。 */
export async function showStartScreen(config: GameConfig, store: SaveStore): Promise<StartChoice> {
  const { save, loadError } = await readSave(store);
  return new Promise((resolve) => {
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
    status.textContent = loadError;
    screen.append(status);

    if (save) {
      const resume = document.createElement('button');
      resume.className = 'create-continue';
      const className = config.classes[save.player.classId]?.name ?? '';
      const realm = realmName(config.realms, save.player.level);
      resume.textContent = `继续游戏：${save.player.name} · ${className} · ${realm}`;
      resume.addEventListener('click', () => finish({ kind: 'continue', save }));
      screen.append(resume);
    }

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
        if (save && !window.confirm('新建角色会覆盖现有存档，确定吗？')) return;
        finish({
          kind: 'new',
          name: nameInput.value.trim() || DEFAULT_NAME,
          classId: classDef.id,
        });
      });
      classes.append(card);
    }
    screen.append(classes);

    const importButton = document.createElement('button');
    importButton.className = 'create-import';
    importButton.textContent = '导入存档文件';
    importButton.addEventListener('click', () => {
      pickSaveFile((picked) => {
        picked
          .then((imported) => finish({ kind: 'continue', save: imported }))
          .catch((error: unknown) => {
            status.textContent = error instanceof Error ? error.message : '导入失败';
          });
      });
    });
    screen.append(importButton);

    document.body.append(screen);
    nameInput.focus();
  });
}

async function readSave(store: SaveStore): Promise<{ save: SaveData | null; loadError: string }> {
  try {
    const raw = await store.load();
    return { save: raw === undefined ? null : migrateSave(raw), loadError: '' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : '未知错误';
    return { save: null, loadError: `读取存档失败：${reason}` };
  }
}

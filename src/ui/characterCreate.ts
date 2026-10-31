import type { GameConfig } from '../game/config';

export interface NewCharacter {
  name: string;
  classId: string;
}

const NAME_MAX_LENGTH = 12;
const DEFAULT_NAME = '无名修士';

/** 显示角色创建界面，选好职业后返回主角名字和职业。 */
export function createCharacter(config: GameConfig): Promise<NewCharacter> {
  return new Promise((resolve) => {
    const screen = document.createElement('div');
    screen.className = 'create';

    const title = document.createElement('h1');
    title.textContent = '踏入仙途';

    const nameInput = document.createElement('input');
    nameInput.placeholder = '输入主角名字';
    nameInput.maxLength = NAME_MAX_LENGTH;

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
        screen.remove();
        resolve({ name: nameInput.value.trim() || DEFAULT_NAME, classId: classDef.id });
      });
      classes.append(card);
    }

    screen.append(title, nameInput, classes);
    document.body.append(screen);
    nameInput.focus();
  });
}

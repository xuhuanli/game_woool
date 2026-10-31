import { parseSave, type SaveData } from '../save/saveData';

export function downloadSave(save: SaveData): void {
  const blob = new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' });
  const date = new Date(save.savedAt).toLocaleDateString('sv-SE');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `xiuxian-save-${date}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** 让玩家选择存档文件。取消时不返回，解析失败时抛出 SaveError。 */
export function pickSaveFile(onPicked: (save: Promise<SaveData>) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) onPicked(file.text().then(parseSave));
  });
  input.click();
}

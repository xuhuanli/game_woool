import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const SPRITE_INDEX = 'index.json';

/** 把各精灵表的说明合成一个索引，游戏启动时一次读完；烘焙后自动重写。 */
export function writeSpriteIndex(dir: string): void {
  const index: Record<string, unknown> = {};
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json') || file === SPRITE_INDEX) continue;
    index[file.slice(0, -'.json'.length)] = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  }
  writeFileSync(path.join(dir, SPRITE_INDEX), JSON.stringify(index));
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  writeSpriteIndex('public/assets/sprites');
}

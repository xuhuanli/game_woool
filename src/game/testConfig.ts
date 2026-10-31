import { readFileSync } from 'node:fs';
import { assembleConfig } from './configLoader';

/** 在 Node 里读取配置表，测试和数值模拟共用。 */
export function loadConfigFromDisk() {
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
  return assembleConfig(
    async (name) => read(`public/data/${name}.json`),
    async (file) => read(`public/maps/${file}`),
  );
}

/**
 * 扫描已生成的图标目录，写成 src/ui/iconManifest.ts，供 iconUrl() 决定走哪套图。
 * - hd/   出过手绘位图的 id（优先）
 * - v2/   新矢量方案的 id
 * 每个技能和物品至少要有其中一套，测试会检查。
 * 补图之后重跑一次即可。用法：npm run icons:sync
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';

const OUTPUT = 'src/ui/iconManifest.ts';

const scan = (dir: string, ext: string): string[] => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(ext))
    .map((file) => file.slice(0, -ext.length))
    .sort();
};

const hd = scan('public/assets/icons/hd', '.jpg');
const v2 = scan('public/assets/icons/v2', '.svg');

const setOf = (name: string, ids: string[], note: string) =>
  `/** ${note} */\nexport const ${name} = new Set([\n${ids.map((id) => `  '${id}',`).join('\n')}\n]);\n`;

writeFileSync(
  OUTPUT,
  `/** 由 tools/sync-hd-icons.ts 生成，不要手改。 */\n\n`
    + setOf('HD_ICON_IDS', hd, '有手绘位图的 id，优先使用')
    + '\n'
    + setOf('VECTOR_ICON_IDS', v2, '有新矢量图标的 id，位图缺失时使用'),
);

console.log(`写入 ${OUTPUT}：位图 ${hd.length} 个，矢量 ${v2.length} 个`);

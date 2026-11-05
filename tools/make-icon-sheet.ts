/**
 * 生成自包含的道具图标评审页。
 *
 * 关键约束：所有 SVG 以 data URI 内嵌，不引用任何外部文件。
 * 原因：预览面板以页面所在目录为根打开，`../public/...` 这类越界路径会被拒绝，
 * 结果就是一整页裂图标。自包含之后，file:// / 预览面板 / 任意静态服务下都一样能看。
 *
 * 用法：npx tsx tools/make-icon-sheet.ts [输出路径]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

interface Item {
  id: string;
  name: string;
  kind: string;
  slot?: string;
  level?: number;
  heal?: number;
  mana?: number;
  skill?: string;
  seed?: boolean;
  boss?: boolean;
  special?: boolean;
}

const ICON_DIR = 'public/assets/icons/v2';
const BLOB_DIR = 'public/assets/icons/hd';

const items = Object.values(
  JSON.parse(readFileSync('public/data/items.json', 'utf8')) as Record<string, Item>,
);

const dataUri = (path: string, mime: string) =>
  `data:${mime};base64,${readFileSync(path).toString('base64')}`;

const svgUri = (id: string) => dataUri(`${ICON_DIR}/${id}.svg`, 'image/svg+xml');

/** 已出 AI 位图的道具，用来跟矢量方案并排对照 */
const blobIds = new Set(
  readdirSync(BLOB_DIR)
    .filter((f) => f.endsWith('.jpg'))
    .map((f) => f.replace('.jpg', '')),
);

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

const card = (item: Item) => `<figure class="c">
  <div class="cell"><img src="${svgUri(item.id)}" alt="${esc(item.name)}" loading="lazy"></div>
  <figcaption>${esc(item.name)}</figcaption>
</figure>`;

const compareCard = (item: Item) => `<figure class="c cmp">
  <div class="pair">
    <div class="cell"><img src="${svgUri(item.id)}" alt="矢量 ${esc(item.name)}"></div>
    <div class="cell"><img src="${dataUri(`${BLOB_DIR}/${item.id}.jpg`, 'image/jpeg')}" alt="位图 ${esc(item.name)}"></div>
  </div>
  <figcaption>${esc(item.name)}</figcaption>
</figure>`;

const section = (title: string, list: Item[], note = '') =>
  list.length === 0
    ? ''
    : `<section>
  <h2>${title}<span>${list.length}</span>${note ? `<em>${note}</em>` : ''}</h2>
  <div class="grid">${list.map(card).join('')}</div>
</section>`;

const equipBy = (slot: string) => items.filter((i) => i.kind === 'equip' && i.slot === slot);
const byKind = (kind: string) => items.filter((i) => i.kind === kind);

/** 同时有矢量稿和位图的道具，用于两种方案并排看 */
const dual = items.filter((i) => blobIds.has(i.id));

const body = [
  section('武器', equipBy('weapon')),
  section('防具', equipBy('armor')),
  section('头冠', equipBy('helmet')),
  section('项链', equipBy('necklace')),
  section('手镯', equipBy('bracelet')),
  section('戒指', equipBy('ring')),
  section('丹药', byKind('potion'), '治疗红 / 法力蓝 / 其他琥珀'),
  section('符箓与货币', [...byKind('scroll'), ...byKind('gold')]),
  section('功法书', byKind('book'), '按所授功法的职业分色'),
  section('材料', byKind('material'), '草药与对应种子同色系'),
].join('');

const compare = dual.length
  ? `<section class="dual">
  <h2>两种方案并排<span>${dual.length}</span><em>左＝矢量透明底，右＝AI 位图（已有位图的道具）</em></h2>
  <div class="grid">${dual.map(compareCard).join('')}</div>
</section>`
  : '';

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>道具图标 · 评审页</title>
<style>
  :root{--bg:#17140f;--panel:#2b2418;--line:#3a3020;--gold:#f0cf7a;--text:#efe6d0;--dim:#8d8472}
  *{box-sizing:border-box}
  body{margin:0;padding:28px 24px 60px;background:var(--bg);color:var(--text);
       font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
  header{display:flex;flex-wrap:wrap;align-items:flex-end;gap:14px;margin-bottom:6px}
  h1{font-size:18px;font-weight:600;color:var(--gold);margin:0}
  .sub{margin:0 0 22px;color:var(--dim);font-size:12px}
  .sub b{color:#c9bea6;font-weight:500}
  .sizes{margin-left:auto;display:flex;gap:6px}
  .sizes button{background:var(--panel);color:var(--dim);border:1px solid var(--line);
       border-radius:4px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:inherit}
  .sizes button[aria-pressed="true"]{color:var(--gold);border-color:#6b5630}
  section{margin-bottom:30px}
  h2{display:flex;align-items:baseline;gap:9px;font-size:12px;font-weight:500;color:#c9bea6;
     margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid #241e16}
  h2 span{font-size:11px;color:#6b5630}
  h2 em{font-style:normal;font-size:11px;color:#5a5038;margin-left:auto}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--cell),1fr));gap:12px 6px}
  :root{--cell:52px}
  figure{margin:0;text-align:center}
  .cell{background:var(--panel);border:1px solid var(--line);border-radius:3px;padding:2px;
        display:flex;align-items:center;justify-content:center;aspect-ratio:1}
  .cell img{width:100%;height:100%;display:block;object-fit:contain}
  figcaption{margin-top:3px;font-size:10px;color:var(--dim);white-space:nowrap;
             overflow:hidden;text-overflow:ellipsis}
  .pair{display:flex;gap:4px}
  .pair .cell{flex:1}
  .dual .grid{--cell:96px}
  .dual figcaption{color:#a79c84}
  img:hover{transform:scale(1.9);transition:transform .12s;position:relative;z-index:5}
</style>
</head>
<body>
<header>
  <h1>道具图标 · 评审页</h1>
  <div class="sizes">
    <button data-size="52" aria-pressed="true">44px</button>
    <button data-size="76" aria-pressed="false">64px</button>
    <button data-size="112" aria-pressed="false">96px</button>
  </div>
</header>
<p class="sub">共 <b>${items.length}</b> 个道具 · 透明底无底板 · 全部 SVG 内嵌（不依赖外部路径）· 鼠标悬停放大</p>
${body}
${compare}
<script>
  const root = document.documentElement;
  document.querySelectorAll('.sizes button').forEach((b) => {
    b.addEventListener('click', () => {
      root.style.setProperty('--cell', b.dataset.size + 'px');
      document.querySelectorAll('.sizes button').forEach((x) =>
        x.setAttribute('aria-pressed', String(x === b)));
    });
  });
</script>
</body>
</html>
`;

const out = process.argv[2] ?? 'output/icon-sheet.html';
writeFileSync(out, html);
console.log(`已生成 ${out}：${items.length} 个道具，对照 ${dual.length} 个，${(html.length / 1024).toFixed(0)}KB`);

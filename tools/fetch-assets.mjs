#!/usr/bin/env node
/**
 * 把外部免费素材拉取到 assets-src/（不放进 public/，避免打包体积膨胀）。
 *
 * 用法：
 *   node tools/fetch-assets.mjs icons         # game-icons.net，4000+ SVG
 *   node tools/fetch-assets.mjs polyhaven     # Poly Haven，CC0 3D 模型
 *   node tools/fetch-assets.mjs all           # 全部
 *   node tools/fetch-assets.mjs report        # 只重建 MANIFEST / 授权清单
 *
 * 素材来源与授权见 assets-src/LICENSES.md。
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';

const run = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'assets-src');

const ICONS_REPO = 'game-icons/icons';
const ICONS_BRANCH = 'master';

/**
 * Poly Haven 里和修仙 / 传奇世界题材相关的模型。
 * 全是 CC0，可以随便改、随便用。
 */
const POLYHAVEN_PICKS = [
  // 岩石与地形
  'boulder_01',
  'rock_07',
  'rock_09',
  'rock_face_01',
  'rock_moss_set_01',
  'stone_01',
  'mountainside',
  'coastal_cliff_04',
  'sand_rocks_small_01',
  // 树木
  // 注意：Poly Haven 的树是照片扫描的百万面模型（单个 .bin 动辄 900 MB），
  // 渲染成 96px 精灵毫无意义。树木请改用 Quaternius 的 Stylized Nature（低模）。
  // 这里只保留体积正常的枯木和树桩。
  'dead_tree_trunk_02',
  'tree_stump_01',
  // 草木
  'grass_medium_01',
  'shrub_01',
  'moss_01',
  'fern_02',
  'root_cluster_01',
  'dry_branches_medium_01',
  // 建筑构件
  'large_castle_door',
  'large_iron_gate',
  'modular_fort_01',
  'stone_fire_pit',
  'modular_wooden_pier',
  // 器物（香炉、灯、瓶、箱）
  'brass_candleholders',
  'brass_diya_lantern',
  'brass_pot_01',
  'ceramic_pot',
  'ceramic_vase_01',
  'chinese_chandelier',
  'treasure_chest',
  'vintage_oil_lamp',
  'wooden_bowl_01',
  'marble_bust_01',
  'bronze_ray_statue',
  'jug_01',
  'pot_enamel_01',
  'wicker_basket_01',
  'katana_stand_01',
  // 容器
  'Barrel_01',
  'barrel_03',
  'wooden_crate_01',
  'wooden_barrels_01',
  'planter_pot_clay',
  'wine_barrel_01',
  // 兵器
  'antique_estoc',
  'antique_katana_01',
];

// ---------------------------------------------------------------- 工具函数

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  await mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url, {
    headers: { 'user-agent': 'game-woool-asset-fetcher/1.0' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} <- ${url}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  await rm(dest, { force: true });
  await copyFile(tmp, dest);
  await rm(tmp, { force: true });
  return dest;
}

async function sha256(file) {
  const hash = createHash('sha256');
  hash.update(await readFile(file));
  return hash.digest('hex').slice(0, 16);
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// ---------------------------------------------------------------- game-icons

async function fetchIcons() {
  const dir = path.join(OUT, 'icons');
  console.log(`\n[icons] game-icons.net -> ${path.relative(ROOT, dir)}`);

  if (await exists(path.join(dir, '.fetched'))) {
    const count = (await readdir(dir)).filter((n) => !n.startsWith('.')).length;
    console.log(`[icons] 已存在（${count} 个条目），跳过。删除 ${path.relative(ROOT, dir)} 可重拉。`);
    return;
  }

  const tarball = path.join(tmpdir(), `game-icons-${Date.now()}.tar.gz`);
  const url = `https://codeload.github.com/${ICONS_REPO}/tar.gz/refs/heads/${ICONS_BRANCH}`;
  console.log(`[icons] 下载 ${url}`);
  await download(url, tarball);

  const size = (await stat(tarball)).size;
  console.log(`[icons] 已下载 ${kb(size)}，解包…`);

  await mkdir(dir, { recursive: true });
  await run('tar', ['-xzf', tarball, '-C', dir, '--strip-components=1']);
  await rm(tarball, { force: true });
  await writeFile(path.join(dir, '.fetched'), new Date().toISOString());

  const index = await buildIconIndex(dir);
  await writeFile(path.join(dir, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`[icons] 完成：${index.count} 个图标，索引已写入 icons/index.json`);
}

/** 扫描 <author>/<name>.svg，生成可搜索的索引。 */
async function buildIconIndex(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const icons = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const author = entry.name;
    const files = await readdir(path.join(dir, author));
    for (const file of files) {
      if (!file.endsWith('.svg')) continue;
      icons.push({
        name: file.replace(/\.svg$/, ''),
        author,
        path: `${author}/${file}`,
      });
    }
  }

  icons.sort((a, b) => a.name.localeCompare(b.name));
  return { source: 'game-icons.net', license: 'CC BY 3.0', count: icons.length, icons };
}

// ---------------------------------------------------------------- Poly Haven

async function fetchPolyHaven() {
  const base = path.join(OUT, 'models', 'polyhaven');
  console.log(`\n[polyhaven] ${POLYHAVEN_PICKS.length} 个模型 -> ${path.relative(ROOT, base)}`);

  const manifest = [];

  for (const id of POLYHAVEN_PICKS) {
    const dir = path.join(base, id);
    const marker = path.join(dir, '.fetched');
    if (await exists(marker)) {
      console.log(`[polyhaven] ${id} 已存在，跳过`);
      manifest.push(await readModelEntry(base, id));
      continue;
    }

    try {
      const res = await fetch(`https://api.polyhaven.com/files/${id}`, {
        headers: { 'user-agent': 'game-woool-asset-fetcher/1.0' },
      });
      if (!res.ok) throw new Error(`files API ${res.status}`);
      const files = await res.json();

      // 1k 贴图对 96px 的精灵渲染足够，能省掉 90% 体积。
      const node = files?.gltf?.['1k']?.gltf;
      if (!node?.url) throw new Error('没有 gltf/1k 变体');

      const gltfName = path.basename(node.url);
      await download(node.url, path.join(dir, gltfName));

      for (const [rel, info] of Object.entries(node.include ?? {})) {
        await download(info.url, path.join(dir, rel));
      }

      await writeFile(
        marker,
        JSON.stringify({ id, source: 'Poly Haven', license: 'CC0', fetched: new Date().toISOString() }, null, 2),
      );
      const entry = await readModelEntry(base, id);
      manifest.push(entry);
      console.log(`[polyhaven] ${id} ✓ ${entry.files} 个文件`);
    } catch (err) {
      console.warn(`[polyhaven] ${id} 失败：${err.message}`);
    }
  }

  return manifest;
}

async function readModelEntry(base, id) {
  const dir = path.join(base, id);
  let files = 0;
  let bytes = 0;
  const walk = async (d) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else {
        files += 1;
        bytes += (await stat(p)).size;
      }
    }
  };
  if (await exists(dir)) await walk(dir);
  return { id, source: 'Poly Haven', license: 'CC0', files, bytes };
}

// ---------------------------------------------------------------- Quaternius

/**
 * Quaternius 只通过 itch.io 分发（name your own price，可以填 0）。
 * 没有可用的公开 API，所以这里只负责把手工下载的 zip 归位。
 */
async function importQuaternius() {
  const incoming = path.join(OUT, '_incoming');
  const target = path.join(OUT, 'models', 'quaternius');
  await mkdir(incoming, { recursive: true });
  await mkdir(target, { recursive: true });

  const zips = (await readdir(incoming)).filter((f) => f.toLowerCase().endsWith('.zip'));
  if (zips.length === 0) {
    console.log(`\n[quaternius] ${path.relative(ROOT, incoming)}/ 里没有 zip，跳过。`);
    console.log('[quaternius] 下载方法见 assets-src/models/quaternius/README.md');
    return;
  }

  for (const zip of zips) {
    const name = zip.replace(/\.zip$/i, '');
    const dest = path.join(target, name);
    await mkdir(dest, { recursive: true });
    console.log(`[quaternius] 解包 ${zip} -> ${path.relative(ROOT, dest)}`);
    await run('unzip', ['-oq', path.join(incoming, zip), '-d', dest]);
  }
  console.log(`[quaternius] 完成，zip 保留在 _incoming/ 里，确认无误后可手动删除。`);
}

// ---------------------------------------------------------------- 报告

async function writeReport() {
  const manifestPath = path.join(OUT, 'MANIFEST.json');
  const iconsDir = path.join(OUT, 'icons');
  const phDir = path.join(OUT, 'models', 'polyhaven');

  const manifest = {
    generated: new Date().toISOString(),
    sources: [],
  };

  if (await exists(path.join(iconsDir, 'index.json'))) {
    const index = JSON.parse(await readFile(path.join(iconsDir, 'index.json'), 'utf8'));
    manifest.sources.push({
      name: 'game-icons.net',
      license: 'CC BY 3.0',
      attribution: 'Icons by game-icons.net contributors, see assets-src/icons/<author>/',
      url: 'https://game-icons.net',
      count: index.count,
      path: 'icons/',
    });
  }

  if (await exists(phDir)) {
    const ids = (await readdir(phDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    let bytes = 0;
    for (const id of ids) {
      const entry = await readModelEntry(phDir, id);
      bytes += entry.bytes;
    }
    manifest.sources.push({
      name: 'Poly Haven',
      license: 'CC0',
      attribution: 'No attribution required (CC0).',
      url: 'https://polyhaven.com',
      count: ids.length,
      bytes,
      path: 'models/polyhaven/',
    });
  }

  const qDir = path.join(OUT, 'models', 'quaternius');
  if (await exists(qDir)) {
    const ids = (await readdir(qDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    if (ids.length) {
      manifest.sources.push({
        name: 'Quaternius',
        license: 'CC0',
        attribution: 'No attribution required (CC0).',
        url: 'https://quaternius.com',
        count: ids.length,
        path: 'models/quaternius/',
      });
    }
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const lines = [
    '# 素材来源与授权',
    '',
    `自动生成于 ${manifest.generated}，由 \`node tools/fetch-assets.mjs report\` 重建。`,
    '',
    '| 来源 | 授权 | 数量 | 目录 |',
    '| --- | --- | --- | --- |',
  ];
  for (const s of manifest.sources) {
    const extra = s.bytes ? ` (${(s.bytes / 1024 / 1024).toFixed(1)} MB)` : '';
    lines.push(`| [${s.name}](${s.url}) | ${s.license} | ${s.count}${extra} | \`${s.path}\` |`);
  }
  lines.push(
    '',
    '## 注意',
    '',
    '- **CC BY 3.0**（game-icons.net）需要署名。若日后公开发布，在致谢页列出作者名即可，',
    '  作者名就是 `assets-src/icons/` 下的一级目录名。',
    '- **CC0**（Poly Haven / Quaternius）无需署名，可商用、可修改。',
    '- 本目录只放原始素材，不参与打包。成品素材请处理后放进 `public/assets/`。',
    '',
  );
  await writeFile(path.join(OUT, 'LICENSES.md'), lines.join('\n'));
  console.log(`\n[report] 已写入 assets-src/MANIFEST.json 和 assets-src/LICENSES.md`);
}

// ---------------------------------------------------------------- 入口

const target = process.argv[2] ?? 'all';

await mkdir(OUT, { recursive: true });

if (target === 'icons' || target === 'all') await fetchIcons();
if (target === 'polyhaven' || target === 'all') await fetchPolyHaven();
if (target === 'quaternius' || target === 'all') await importQuaternius();
await writeReport();

console.log('\n完成。');

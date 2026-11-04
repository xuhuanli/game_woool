#!/usr/bin/env node
/**
 * 把外部免费素材拉取到 assets-src/（不放进 public/，避免打包体积膨胀）。
 *
 * 用法：
 *   node tools/fetch-assets.mjs icons         # game-icons.net，4000+ SVG
 *   node tools/fetch-assets.mjs polyhaven     # Poly Haven，CC0 3D 模型
 *   node tools/fetch-assets.mjs quaternius    # 归位 _incoming/ 里的 Quaternius zip
 *   node tools/fetch-assets.mjs kenney        # Kenney CC0 音频包（签名直链自动下载）
 *   node tools/fetch-assets.mjs music         # OpenGameArt CC0 音乐（自动校验授权）
 *   node tools/fetch-assets.mjs music check   # 只列出候选曲目的授权/附件，不下载
 *   node tools/fetch-assets.mjs all           # 全部
 *   node tools/fetch-assets.mjs report        # 只重建 MANIFEST / 授权清单
 *
 * 素材来源与授权见 assets-src/LICENSES.md，站点总览见 assets-src/FREE-ASSETS.md。
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

/**
 * Kenney 的 CC0 音频包。全站资源都是 CC0，可商用、可修改、无需署名。
 * 官网下载按钮走 /download-link/<id> 换取一次性签名直链，这里直接复刻该流程，
 * 不再需要手工点浏览器下载再丢进 _incoming/。
 */
// 注意：`assets-src/audio/kenney/` 下已有手工下载的 interface/ 与 rpg/ 两包，
// 这里不再重复拉取，避免同一套音效在仓库里存两份。
// `sci-fi-sounds` 暂不自动拉取：该包 5.9 MB，Kenney 的 /download/ 端点不支持
// Range 断点续传且限速约 25 KB/s，单次下载常在 2~3 MB 处超时。
// 需要时去 https://kenney.nl/assets/sci-fi-sounds 手动下载 zip，放进 `_incoming/` 解包。
const KENNEY_PACKS = [
  { slug: 'music-jingles', note: '85 个短 jingle：升级、过关、开箱' },
  { slug: 'impact-sounds', note: '打击、撞击、破碎音效' },
];

/**
 * OpenGameArt 上的候选曲目，偏向东方 / 氛围 / 战斗，贴合修仙题材。
 * 注意：OGA 是混合授权库，脚本会逐个读取资源页的 License(s)，
 * 只有明确标为 CC0 的才下载，其余一律跳过并在日志里说明。
 * 项目已有的 Orien / Asianoriental 等曲目不重复拉取。
 */
const OGA_MUSIC_PICKS = [
  { slug: 'oriental', use: '备用主城 / 山门' },
  { slug: 'japaori', use: '东方氛围' },
  { slug: 'shangri-river', use: '水景 / 河畔' },
  { slug: 'sakura-variation', use: '柔和场景' },
  { slug: 'honor-lowrund-village-theme', use: '村落' },
  { slug: 'shinrin-yoku', use: '山林' },
  { slug: 'dark-shrine-loop', use: '禁地 / 神殿' },
  { slug: 'boss-battle-music', use: 'Boss 战备选' },
  { slug: 'clean-guitar-34-oriental', use: '过场 / 菜单' },
];

/** 单个附件超过这个体积就跳过，避免把几十 MB 的采样包拖进仓库。 */
const MAX_OGA_FILE_BYTES = 20 * 1024 * 1024;

// ---------------------------------------------------------------- 工具函数

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest, timeoutMs = 60_000) {
  await mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url, {
    headers: { 'user-agent': 'game-woool-asset-fetcher/1.0' },
    // 单个请求卡死不该拖垮整批抓取；OGA 源站较慢，可单独放宽
    signal: AbortSignal.timeout(timeoutMs),
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

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'game-woool-asset-fetcher/1.0' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} <- ${url}`);
  return res.text();
}

/** 递归统计一个目录下的文件数与总字节数，跳过 . 开头的标记文件。 */
async function scanDir(dir) {
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
  return { files, bytes };
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

// ---------------------------------------------------------------- Kenney

/**
 * Kenney 官网的下载按钮会先请求 /download-link/<hex id> 换取一次性签名 URL。
 * 这里复刻这个流程，因此这四类音频包不再需要手动下载 zip。
 */
async function fetchKenney() {
  const base = path.join(OUT, 'audio', 'kenney');
  console.log(`\n[kenney] ${KENNEY_PACKS.length} 个 CC0 音频包 -> ${path.relative(ROOT, base)}`);

  for (const pack of KENNEY_PACKS) {
    const dir = path.join(base, pack.slug);
    const marker = path.join(dir, '.fetched');
    if (await exists(marker)) {
      const { files } = await scanDir(dir);
      console.log(`[kenney] ${pack.slug} 已存在（${files} 个文件），跳过`);
      continue;
    }

    try {
      const page = `https://kenney.nl/assets/${pack.slug}`;
      const html = await fetchText(page);
      // download-id 是 "assets/<slug>" 的 hex 编码；页面能读到就用页面的，读不到自行编码。
      const id = html.match(/data-download-id='([0-9a-f]+)'/)?.[1]
        ?? Buffer.from(`assets/${pack.slug}`).toString('hex');

      const res = await fetch(`https://kenney.nl/download-link/${id}`, {
        headers: { 'user-agent': 'game-woool-asset-fetcher/1.0', referer: page },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`download-link ${res.status}`);
      const { url } = await res.json();
      if (!url) throw new Error('签名接口没有返回 url');

      const zip = path.join(tmpdir(), `kenney-${pack.slug}-${Date.now()}.zip`);
      await download(url, zip);
      console.log(`[kenney] ${pack.slug} 下载完成 ${kb((await stat(zip)).size)}，解包…`);

      await mkdir(dir, { recursive: true });
      await run('unzip', ['-oq', zip, '-d', dir]);
      await rm(zip, { force: true });
      await writeFile(marker, JSON.stringify({
        source: 'Kenney',
        license: 'CC0',
        slug: pack.slug,
        note: pack.note,
        page,
        fetched: new Date().toISOString(),
      }, null, 2));

      const { files } = await scanDir(dir);
      console.log(`[kenney] ${pack.slug} ✓ ${files} 个文件 — ${pack.note}`);
    } catch (err) {
      console.warn(`[kenney] ${pack.slug} 失败：${err.message}`);
    }
  }
}

// ---------------------------------------------------------------- OpenGameArt 音乐

/** 解析 OGA 资源页：作者、License(s)、正式附件直链（排除预览转码与缩略图）。 */
function parseOgaPage(html) {
  const author = html.match(/<span class='username'><a[^>]*>([^<]+)<\/a>/)?.[1]?.trim() ?? 'unknown';
  const licenses = [...html.matchAll(/<div class='license-name'>([^<]+)<\/div>/g)]
    .map((m) => m[1].trim());
  const files = [...html.matchAll(/href="(https:\/\/opengameart\.org\/sites\/default\/files\/[^"]+\.(?:ogg|mp3|wav|zip))"/g)]
    .map((m) => m[1])
    .filter((u) => !u.includes('/audio_preview/') && !u.includes('/styles/'));
  return { author, licenses, files: [...new Set(files)] };
}

async function fetchOgaMusic(checkOnly = false) {
  const base = path.join(OUT, 'audio', 'oga');
  console.log(`\n[music] OpenGameArt 候选 ${OGA_MUSIC_PICKS.length} 首${checkOnly ? '（只检查，不下载）' : ''}`);

  for (const pick of OGA_MUSIC_PICKS) {
    const page = `https://opengameart.org/content/${pick.slug}`;
    const dir = path.join(base, pick.slug);
    try {
      const info = parseOgaPage(await fetchText(page));
      const label = info.licenses.join(', ') || '页面未标注授权';
      console.log(`[music] ${pick.slug.padEnd(34)} ${label.padEnd(16)} ${info.files.length} 个附件  by ${info.author}`);

      // OGA 是混合授权库：不是 CC0 一律不碰，避免把 CC-BY-NC 带进项目。
      if (!info.licenses.some((l) => /^CC0/.test(l))) {
        console.log(`[music]   ↳ 跳过：${label}`);
        continue;
      }
      if (checkOnly) continue;
      if (await exists(path.join(dir, '.fetched'))) {
        console.log('[music]   ↳ 已存在，跳过');
        continue;
      }
      if (info.files.length === 0) {
        console.log('[music]   ↳ 跳过：没有找到可下载的正式附件');
        continue;
      }

      const saved = [];
      for (const url of info.files) {
        let size = 0;
        try {
          const head = await fetch(url, {
            method: 'HEAD',
            headers: { 'user-agent': 'game-woool-asset-fetcher/1.0' },
            signal: AbortSignal.timeout(15_000),
          });
          size = Number(head.headers.get('content-length') ?? 0);
        } catch {
          // 有些节点不给 HEAD，交给下面的实际下载判断
        }
        if (size > MAX_OGA_FILE_BYTES) {
          console.log(`[music]   ↳ 跳过超大附件 ${decodeURIComponent(url.split('/').pop())} (${kb(size)})`);
          continue;
        }
        const name = decodeURIComponent(path.basename(new URL(url).pathname));
        // OpenGameArt 常年限速（实测约 30 KB/s），音频附件给足时间
        await download(url, path.join(dir, name), 150_000);
        saved.push({ name, url, bytes: (await stat(path.join(dir, name))).size });
      }

      if (saved.length === 0) {
        console.log('[music]   ↳ 没有成功下载任何附件');
        continue;
      }

      await writeFile(path.join(dir, 'sources.json'), JSON.stringify({
        source: 'OpenGameArt',
        license: info.licenses,
        author: info.author,
        page,
        use: pick.use,
        files: saved,
        fetched: new Date().toISOString(),
      }, null, 2));
      await writeFile(path.join(dir, '.fetched'), new Date().toISOString());
      console.log(`[music]   ✓ ${saved.length} 个文件 -> ${path.relative(ROOT, dir)}（建议用于${pick.use}）`);
    } catch (err) {
      console.warn(`[music] ${pick.slug} 失败：${err.message}`);
    }
  }
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

/** 各来源的授权元数据，report 时按实际目录自动归并。 */
const SOURCE_META = {
  'game-icons.net': {
    license: 'CC BY 3.0',
    url: 'https://game-icons.net',
    attribution: '需要署名：在致谢页列出作者名（= icons/ 下一级目录名）',
  },
  'Poly Haven': {
    license: 'CC0',
    url: 'https://polyhaven.com',
    attribution: 'No attribution required (CC0).',
  },
  Quaternius: {
    license: 'CC0',
    url: 'https://quaternius.com',
    attribution: 'No attribution required (CC0).',
  },
  KayKit: {
    license: 'CC0',
    url: 'https://kaylousberg.com/game-assets',
    attribution: 'No attribution required (CC0).',
  },
  Kenney: {
    license: 'CC0',
    url: 'https://kenney.nl/assets',
    attribution: 'No attribution required (CC0).',
  },
  'OpenGameArt': {
    license: 'CC0（逐文件校验）',
    url: 'https://opengameart.org',
    attribution: 'No attribution required (CC0).',
  },
};

const AUDIO_SOURCES = {
  kenney: 'Kenney',
  music: 'OpenGameArt',
  'rpg-sound-pack': 'OpenGameArt',
  oga: 'OpenGameArt',
};

const MODEL_SOURCES = {
  polyhaven: 'Poly Haven',
  quaternius: 'Quaternius',
  kaykit: 'KayKit',
};

async function writeReport() {
  const manifest = { generated: new Date().toISOString(), sources: [] };

  const add = (name, dirPath, count, bytes) => {
    const meta = SOURCE_META[name];
    manifest.sources.push({
      name,
      license: meta.license,
      attribution: meta.attribution,
      url: meta.url,
      count,
      bytes,
      path: dirPath,
    });
  };

  // 图标：数量以 index.json 为准，体积按目录实算
  const iconsDir = path.join(OUT, 'icons');
  const iconIndex = path.join(iconsDir, 'index.json');
  if (await exists(iconIndex)) {
    const index = JSON.parse(await readFile(iconIndex, 'utf8'));
    add('game-icons.net', 'icons/', index.count, (await scanDir(iconsDir)).bytes);
  }

  // 模型：每个子目录算一个来源，count 记模型包数量
  for (const [folder, name] of Object.entries(MODEL_SOURCES)) {
    const dir = path.join(OUT, 'models', folder);
    if (!(await exists(dir))) continue;
    const { files, bytes } = await scanDir(dir);
    if (!files) continue;
    const packs = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory()).length;
    add(name, `models/${folder}/`, packs || files, bytes);
  }

  // 音频：每个子目录算一个来源，count 记文件数量
  for (const [folder, name] of Object.entries(AUDIO_SOURCES)) {
    const dir = path.join(OUT, 'audio', folder);
    if (!(await exists(dir))) continue;
    const { files, bytes } = await scanDir(dir);
    if (!files) continue;
    add(name, `audio/${folder}/`, files, bytes);
  }

  await writeFile(path.join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));

  const lines = [
    '# 素材来源与授权',
    '',
    `自动生成于 ${manifest.generated}，由 \`node tools/fetch-assets.mjs report\` 重建。`,
    '',
    '| 来源 | 授权 | 数量 | 体积 | 目录 |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const s of manifest.sources) {
    const size = s.bytes ? `${(s.bytes / 1024 / 1024).toFixed(1)} MB` : '—';
    lines.push(`| [${s.name}](${s.url}) | ${s.license} | ${s.count} | ${size} | \`${s.path}\` |`);
  }

  const needCredit = [...new Set(
    manifest.sources.filter((s) => s.license.startsWith('CC BY')).map((s) => s.name),
  )];
  lines.push('', '## 授权注意事项', '');
  if (needCredit.length) {
    lines.push(
      `- **${needCredit.join(' / ')} 需要署名**：公开发布时须在致谢页列出作者。`,
      '  game-icons.net 的作者名就是 `assets-src/icons/` 下的一级目录名。',
    );
  }
  lines.push(
    '- **CC0 / 站方免署名授权**：可商用、可修改、无需署名（Kenney、Poly Haven、Quaternius、KayKit、OpenGameArt 的 CC0 条目）。',
    '- **混合授权库要逐文件确认**：OpenGameArt、itch.io、Freesound 同站内既有 CC0 也有 CC-BY / CC-BY-NC。`music` 命令只下载页面明确标注 CC0 的附件。',
    '- **避开 CC BY-NC 与 CC BY-SA**：前者禁止任何带变现（含广告）的发行，后者对闭源商业项目的衍生授权有争议。',
    '- 下载当下就记录「资源名 / 作者 / 来源页 / 许可证」，别等发布前再补。',
    '- 本目录只放原始素材，不参与打包。成品素材请处理后放进 `public/assets/`。',
    '',
  );
  await writeFile(path.join(OUT, 'LICENSES.md'), lines.join('\n'));
  console.log(`\n[report] 已写入 assets-src/MANIFEST.json 和 assets-src/LICENSES.md（${manifest.sources.length} 条来源）`);
}

// ---------------------------------------------------------------- 入口

const target = process.argv[2] ?? 'all';
const checkOnly = process.argv[3] === 'check';

await mkdir(OUT, { recursive: true });

if (target === 'icons' || target === 'all') await fetchIcons();
if (target === 'polyhaven' || target === 'all') await fetchPolyHaven();
if (target === 'quaternius' || target === 'all') await importQuaternius();
if (target === 'kenney' || target === 'all') await fetchKenney();
if (target === 'music') await fetchOgaMusic(checkOnly);
if (target === 'all') await fetchOgaMusic(false);
await writeReport();

console.log('\n完成。');

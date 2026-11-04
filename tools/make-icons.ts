/**
 * 生成技能和物品图标，输出到 public/assets/icons/<id>.svg。
 * 图形来自 game-icons.net（CC BY 3.0，作者见 assets-src/icons/ 的目录名），按类别换底色和图形颜色。
 * 用法：npx tsx tools/make-icons.ts
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ItemDef, SkillDef } from '../src/game/config';

const SOURCE = 'assets-src/icons';
const OUTPUT = 'public/assets/icons';

interface Theme {
  /** 底色的中心和边缘 */
  inner: string;
  outer: string;
  /** 图形颜色 */
  glyph: string;
  border: string;
}

const theme = (inner: string, outer: string, glyph: string, border = outer): Theme => ({ inner, outer, glyph, border });

/** 法器按境界分色，越高越亮 */
const TIERS: [number, Theme][] = [
  [35, theme('#6a3a9a', '#2a1440', '#f0d8ff', '#c89aff')],
  [27, theme('#2a5a9a', '#101e40', '#d8ecff', '#7ab4ff')],
  [14, theme('#2a7a4a', '#0e2a1a', '#e0ffe8', '#6ad08a')],
  [0, theme('#5a5248', '#1e1b18', '#ece4d4', '#9a8e7a')],
];
const SPECIAL = theme('#9a6a1a', '#2e1e08', '#fff0c0', '#ffd27a');
const HEAL = theme('#a83a3a', '#2e0e0e', '#ffe0d8');
const MANA = theme('#2a5ab0', '#0c1a3a', '#d8e8ff');
const PILL = theme('#b8862a', '#2e2008', '#fff4d0', '#ffd27a');
const MATERIAL = theme('#6a5a3a', '#1e1810', '#f4e8c8');
const STORY = theme('#7a2a5a', '#240a1a', '#ffe0f0', '#e08ac0');
const SCROLL = theme('#8a7a4a', '#24200e', '#fff8d8');
const GOLD = theme('#3a8a8a', '#0e2424', '#d8fff8', '#7ae0d0');
/** 功法按职业分色 */
const CLASSES: Record<string, Theme> = {
  body: theme('#b0502a', '#2e120a', '#ffe8d0', '#ff9a5a'),
  spell: theme('#3a5ac0', '#0e1440', '#e0ecff', '#8ab4ff'),
  spirit: theme('#3a8a3a', '#0e260e', '#e8ffd8', '#8ae07a'),
};
const BOOK = theme('#c8b48a', '#4a3a22', '#3a2a18', '#e8d4a8');

/** 每个技能和物品用哪个图形 */
const GLYPHS: Record<string, string> = {
  'body-smash': 'hammer-drop',
  'body-pierce': 'thrust',
  'body-whirl': 'spinning-sword',
  'body-mingwang': 'spiked-halo',
  'body-vajra': 'bell-shield',
  'body-brahma': 'muscle-up',
  'body-charge': 'boulder-dash',
  'spell-fire': 'fireball',
  'spell-thunder': 'lightning-storm',
  'spell-shield': 'magic-shield',
  'spell-gale': 'tornado',
  'spell-qingyuan': 'flying-dagger',
  'spell-bixie': 'thunder-struck',
  'spell-firewall': 'fire-wave',
  'spirit-poison': 'poison-bottle',
  'spirit-heal': 'healing',
  'spirit-ward': 'checked-shield',
  'spirit-summon': 'bee',
  'spirit-puppet': 'robot-golem',
  'spirit-corrosion': 'acid',
  'spirit-miasma': 'poison-gas',

  gold: 'crystal-cluster',
  'small-potion': 'pill',
  'mid-potion': 'pill',
  'big-potion': 'pill',
  'small-mana': 'pill-drop',
  'mid-mana': 'pill-drop',
  'big-mana': 'pill-drop',
  'refine-stone': 'stone-block',
  'foundation-pill': 'pill',
  'core-pill': 'fire-gem',
  'nascent-pill': 'lotus',
  'ape-fur': 'animal-hide',
  'serpent-scale': 'scales',
  'recall-scroll': 'scroll-unfurled',
  'random-scroll': 'magic-portal',
  'skill-tome': 'tied-scroll',
  'ascension-token': 'token',
  'jinzhu-brush': 'quill-ink',
  'jade-marrow': 'mushroom-gills',
  'purple-monkey': 'flower-twirl',
  'sky-fruit': 'peach',
  'great-transfer-token': 'portal',
  'xutian-map': 'treasure-map',
  'xutian-cauldron': 'cauldron',

  'rusty-sword': 'broadsword',
  'steel-sword': 'piercing-sword',
  'sword-14': 'flying-dagger',
  'sword-27': 'energy-sword',
  'sword-35': 'winged-sword',
  'cloth-robe': 'robe',
  'robe-14': 'robe',
  'robe-27': 'robe',
  'robe-35': 'robe',
  'iron-helm': 'crown',
  'crown-14': 'crown',
  'crown-27': 'jewel-crown',
  'crown-35': 'queen-crown',
  'spirit-pendant': 'gem-necklace',
  'pendant-14': 'pearl-necklace',
  'pendant-27': 'emerald-necklace',
  'pendant-35': 'gem-necklace',
  'iron-bracelet': 'bracer',
  'bracelet-14': 'bracer',
  'bracelet-27': 'bracers',
  'bracelet-35': 'bracers',
  'jade-ring': 'ring',
  'ring-14': 'ring',
  'ring-27': 'diamond-ring',
  'ring-35': 'diamond-ring',
  'stun-ring': 'diamond-ring',
  'revive-ring': 'diamond-ring',
  'guard-ring': 'diamond-ring',
  'blink-ring': 'diamond-ring',
};

const STORY_ITEMS = ['ascension-token', 'jinzhu-brush', 'great-transfer-token', 'xutian-map', 'xutian-cauldron'];
const BREAKTHROUGH = ['foundation-pill', 'core-pill', 'nascent-pill'];
/** 丹药按档次缩放图形，大还丹最大 */
const POTION_SCALE: Record<string, number> = {
  'small-potion': 0.62,
  'small-mana': 0.62,
  'mid-potion': 0.72,
  'mid-mana': 0.72,
  'big-potion': 0.82,
  'big-mana': 0.82,
};

const index = JSON.parse(readFileSync(`${SOURCE}/index.json`, 'utf8')) as { icons: { name: string; path: string }[] };
const paths = new Map(index.icons.map((icon) => [icon.name, icon.path]));

/** 取出图形的路径，去掉黑色底板。 */
function glyphPaths(name: string): string {
  const path = paths.get(name);
  if (!path) throw new Error(`图标库里没有 ${name}`);
  const svg = readFileSync(`${SOURCE}/${path}`, 'utf8');
  const parts = [...svg.matchAll(/<path[^>]*\bd="([^"]+)"[^>]*\/>/g)].map((match) => match[1]!);
  return parts
    .filter((d) => d !== 'M0 0h512v512H0z')
    .map((d) => `<path d="${d}"/>`)
    .join('');
}

function render(glyph: string, look: Theme, scale = 0.78): string {
  const offset = (512 * (1 - scale)) / 2;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
    '<defs><radialGradient id="g" cx="50%" cy="40%" r="70%">',
    `<stop offset="0" stop-color="${look.inner}"/><stop offset="1" stop-color="${look.outer}"/>`,
    '</radialGradient></defs>',
    `<rect x="12" y="12" width="488" height="488" rx="72" fill="url(#g)" stroke="${look.border}" stroke-width="20"/>`,
    `<g transform="translate(${offset} ${offset}) scale(${scale})" fill="${look.glyph}">${glyphPaths(glyph)}</g>`,
    '</svg>',
  ].join('');
}

function itemTheme(item: ItemDef): Theme {
  if (item.kind === 'gold') return GOLD;
  if (item.kind === 'potion') return item.heal ? HEAL : MANA;
  if (item.kind === 'scroll') return SCROLL;
  if (item.kind === 'equip') {
    if (item.special) return SPECIAL;
    return TIERS.find(([level]) => (item.level ?? 1) >= level)![1];
  }
  if (STORY_ITEMS.includes(item.id)) return STORY;
  if (BREAKTHROUGH.includes(item.id)) return PILL;
  return MATERIAL;
}

const load = <T>(name: string) => JSON.parse(readFileSync(`public/data/${name}.json`, 'utf8')) as Record<string, T>;
const skills = load<SkillDef>('skills');
const items = load<ItemDef>('items');

rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(OUTPUT, { recursive: true });
const missing: string[] = [];
const write = (id: string, svg: string) => writeFileSync(`${OUTPUT}/${id}.svg`, svg);

for (const skill of Object.values(skills)) {
  const glyph = GLYPHS[skill.id];
  if (!glyph) missing.push(skill.id);
  else write(skill.id, render(glyph, CLASSES[skill.classId]!));
}
for (const item of Object.values(items)) {
  // 功法书用所授功法的图形，底色是纸色
  const glyph = item.kind === 'book' ? GLYPHS[item.skill ?? ''] : GLYPHS[item.id];
  if (!glyph) {
    missing.push(item.id);
    continue;
  }
  const look = item.kind === 'book' ? BOOK : itemTheme(item);
  write(item.id, render(glyph, look, POTION_SCALE[item.id] ?? (item.kind === 'book' ? 0.66 : 0.78)));
}
if (missing.length > 0) throw new Error(`没有配图形：${missing.join('、')}`);
console.log(`生成 ${Object.keys(skills).length + Object.keys(items).length} 个图标`);

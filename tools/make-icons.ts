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
const BOSS = theme('#9a2a2a', '#2e0a0a', '#ffe0d0', '#ff8a6a');
const SPECIAL = theme('#9a6a1a', '#2e1e08', '#fff0c0', '#ffd27a');
const HEAL = theme('#a83a3a', '#2e0e0e', '#ffe0d8');
const MANA = theme('#2a5ab0', '#0c1a3a', '#d8e8ff');
const PILL = theme('#b8862a', '#2e2008', '#fff4d0', '#ffd27a');
const MATERIAL = theme('#6a5a3a', '#1e1810', '#f4e8c8');
const HERB = theme('#3a7a3a', '#0e260e', '#e4ffd8', '#8ad86a');
const SEED = theme('#7a5a2a', '#241a0c', '#f8e8c8', '#d8b070');
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
  'huge-potion': 'pill',
  'huge-mana': 'pill-drop',
  'refine-stone': 'stone-block',
  'foundation-pill': 'pill',
  'core-pill': 'fire-gem',
  'nascent-pill': 'lotus',
  'ape-fur': 'animal-hide',
  'herb-huichun': 'herbs-bundle',
  'herb-ningqi': 'lotus-flower',
  'herb-yangyuan': 'tree-roots',
  'herb-juling': 'curling-vines',
  'herb-jinyuan': 'root-tip',
  'herb-xuanyin': 'dandelion-flower',
  'seed-huichun': 'plant-seed',
  'seed-ningqi': 'plant-seed',
  'seed-yangyuan': 'plant-seed',
  'seed-juling': 'plant-seed',
  'seed-jinyuan': 'plant-seed',
  'seed-xuanyin': 'plant-seed',
  'thorn-root': 'plant-roots',
  'spider-silk': 'spider-web',
  'bat-wing': 'bat-wing',
  'snake-gall': 'snake-egg',
  'blood-silk': 'cobweb',
  'bat-blood': 'blood',
  'toad-venom': 'bubbling-flask',
  'squid-ink': 'ink-swirl',
  'ray-fin': 'shark-fin',
  'skull-shard': 'broken-bone',
  'demon-hide': 'fur-shirt',
  'ape-blood': 'droplets',
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

  'rusty-sword': 'rusty-sword',
  'steel-sword': 'piercing-sword',
  'sword-14': 'ancient-sword',
  'sword-27': 'energy-sword',
  'sword-35': 'winged-sword',
  'cloth-robe': 'robe',
  'robe-14': 'cloak',
  'robe-27': 'cape',
  'robe-35': 'layered-armor',
  'iron-helm': 'crown',
  'crown-14': 'tiara',
  'crown-27': 'jewel-crown',
  'crown-35': 'queen-crown',
  'spirit-pendant': 'necklace',
  'pendant-14': 'pearl-necklace',
  'pendant-27': 'emerald-necklace',
  'pendant-35': 'intricate-necklace',
  'iron-bracelet': 'bracer',
  'bracelet-14': 'gauntlet',
  'bracelet-27': 'bracers',
  'bracelet-35': 'mailed-fist',
  'jade-ring': 'ring',
  'ring-14': 'ring-box',
  'ring-27': 'fire-ring',
  'ring-35': 'big-diamond-ring',
  'stun-ring': 'frozen-ring',
  'revive-ring': 'power-ring',
  'guard-ring': 'cloud-ring',
  'blink-ring': 'globe-ring',
  'boss-golden-pendant': 'gem-pendant',
  'boss-serpent-armor': 'scale-mail',
  'boss-qingwen-crown': 'laurel-crown',
  'boss-fengyue-bracer': 'thor-fist',
  'boss-mojiao-ring': 'diamond-ring',
  'boss-blood-sword': 'bloody-sword',
  'boss-blood-orb': 'crystal-ball',
  'boss-demon-armor': 'spiked-armor',
  'boss-sea-crown': 'crown-coin',
  'boss-jiyin-banner': 'flying-flag',
  'boss-xuangu-ring': 'skull-ring',
  'boss-warden-bracelet': 'linked-rings',
  'boss-nanlong-blade': 'relic-blade',
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
  'huge-potion': 0.92,
  'huge-mana': 0.92,
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
    if (item.boss) return BOSS;
    return TIERS.find(([level]) => (item.level ?? 1) >= level)![1];
  }
  if (item.seed) return SEED;
  if (item.id.startsWith('herb-')) return HERB;
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
  // 进阶功法沿用旧功法的图形
  const glyph = GLYPHS[skill.id] ?? GLYPHS[skill.replaces ?? ''];
  if (!glyph) missing.push(skill.id);
  else write(skill.id, render(glyph, CLASSES[skill.classId]!));
}
for (const item of Object.values(items)) {
  // 功法书用所授功法的图形，底色是纸色
  const taught = skills[item.skill ?? ''];
  const glyph = item.kind === 'book' ? (GLYPHS[taught?.id ?? ''] ?? GLYPHS[taught?.replaces ?? '']) : GLYPHS[item.id];
  if (!glyph) {
    missing.push(item.id);
    continue;
  }
  const look = item.kind === 'book' ? BOOK : itemTheme(item);
  write(item.id, render(glyph, look, POTION_SCALE[item.id] ?? (item.kind === 'book' ? 0.66 : 0.78)));
}
if (missing.length > 0) throw new Error(`没有配图形：${missing.join('、')}`);
// 法器各用各的图形，只靠底色区分太难认
const equipGlyphs = Object.values(items).filter((item) => item.kind === 'equip').map((item) => GLYPHS[item.id]);
const shared = equipGlyphs.filter((glyph, i) => equipGlyphs.indexOf(glyph) !== i);
if (shared.length > 0) throw new Error(`法器图形重复：${[...new Set(shared)].join('、')}`);
console.log(`生成 ${Object.keys(skills).length + Object.keys(items).length} 个图标`);

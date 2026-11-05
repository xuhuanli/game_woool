/**
 * 道具图标生成器（无底板 · 灵光主体方案）。
 * 形状库 + 配色令牌 + 名字变体 → 输出 public/assets/icons/v2/<id>.svg。
 * 用法：npm run icons:items
 *
 * 设计约定：
 * - 120×120 画布，背景透明，靠背包格自身当框
 * - 描边统一 #1b1408（暖黑），线宽 2.2
 * - 金色统一 #f0cf7a → #e0b757 → #7d5a1f
 * - 类别色只做主体背后的柔光，不做实色底板
 * - 同部位同档位的装备按名字再分变体，避免整排长一个样
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const OUTPUT = 'public/assets/icons/v2';
const INK = '#1b1408';

interface Tint {
  aura: string;
  light: string;
  mid: string;
  dark: string;
}

const TINT: Record<string, Tint> = {
  steel: { aura: '#9fc4d8', light: '#eef6fa', mid: '#8fa3ad', dark: '#33424b' },
  jade: { aura: '#7cf0b8', light: '#f2fff8', mid: '#8fe3bb', dark: '#22553f' },
  azure: { aura: '#6fd2ff', light: '#f2fbff', mid: '#9fd0e8', dark: '#1b3346' },
  violet: { aura: '#c9a6ff', light: '#f6efff', mid: '#b48ee0', dark: '#3a2352' },
  amber: { aura: '#ffd88a', light: '#fffdf2', mid: '#e0a54a', dark: '#4d2c08' },
  crimson: { aura: '#ff9a8a', light: '#fff0ec', mid: '#d9614e', dark: '#4a140c' },
  moss: { aura: '#9be07a', light: '#f4ffe8', mid: '#8cc45c', dark: '#2b4a14' },
  ink: { aura: '#9aa4b8', light: '#e8ecf4', mid: '#6b7688', dark: '#1e2430' },
  paper: { aura: '#ffd9a0', light: '#fff8e8', mid: '#e2c79a', dark: '#5a4426' },
  bronze: { aura: '#e8b878', light: '#fff2dc', mid: '#b4834a', dark: '#3d2410' },
  bone: { aura: '#f0e4c0', light: '#fffdf4', mid: '#ddd0ac', dark: '#5e5136' },
};

/* ---------------- 颜色工具 ---------------- */

function hueShift(hex: string, deg: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const hh = (((h + deg) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * sat;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(hh / 60) % 6;
  const rgb = ([[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg] ?? [0, 0, 0]) as number[];
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, '0');
  return `#${to(rgb[0] ?? 0)}${to(rgb[1] ?? 0)}${to(rgb[2] ?? 0)}`;
}

const hashOf = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return h;
};

const jitter = (t: Tint, id: string): Tint => {
  const deg = (hashOf(id) / 100000) * 12 - 6;
  return { aura: hueShift(t.aura, deg), light: t.light, mid: hueShift(t.mid, deg), dark: t.dark };
};

function tierTint(level: number): Tint {
  if (level >= 52) return TINT.amber!;
  if (level >= 35) return TINT.violet!;
  if (level >= 27) return TINT.azure!;
  if (level >= 14) return TINT.jade!;
  return TINT.steel!;
}

/* ---------------- SVG 零件 ---------------- */

const goldStops = (id: string) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
     <stop offset="0%" stop-color="#ffe9a8"/><stop offset="48%" stop-color="#e0b757"/><stop offset="100%" stop-color="#7d5a1f"/>
   </linearGradient>`;

const bodyStops = (id: string, t: Tint) =>
  `<radialGradient id="${id}" cx="34%" cy="26%" r="86%">
     <stop offset="0%" stop-color="${t.light}"/><stop offset="30%" stop-color="${t.mid}"/>
     <stop offset="76%" stop-color="${t.dark}"/><stop offset="100%" stop-color="#000"/>
   </radialGradient>`;

const flatStops = (id: string, t: Tint) =>
  `<linearGradient id="${id}" x1="0.1" y1="0" x2="0.9" y2="1">
     <stop offset="0%" stop-color="${t.light}"/><stop offset="38%" stop-color="${t.mid}"/>
     <stop offset="100%" stop-color="${t.dark}"/>
   </linearGradient>`;

const defs = (t: Tint) => `<defs>
  <radialGradient id="aura" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="${t.aura}" stop-opacity="0.42"/>
    <stop offset="58%" stop-color="${t.aura}" stop-opacity="0.12"/>
    <stop offset="100%" stop-color="${t.aura}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="shadow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#000" stop-opacity="0.5"/><stop offset="100%" stop-color="#000" stop-opacity="0"/>
  </radialGradient>
  ${goldStops('gold')}
  ${bodyStops('body', t)}
  ${flatStops('flat', t)}
</defs>`;

const auraCircle = () => `<circle cx="60" cy="58" r="50" fill="url(#aura)"/>`;

type Shape = (t: Tint, extra: string) => string;
const g = (inner: string) => `<g stroke="${INK}" stroke-width="2.2" stroke-linejoin="round">${inner}</g>`;
const parts = (extra: string) => extra.split('|');
const num = (s: string | undefined, d: number) => (s && !Number.isNaN(Number(s)) ? Number(s) : d);

/* ---------------- 武器 ---------------- */

const bladeBody = (v: string) => {
  switch (v) {
    case 'bronze':
      return '<path d="M60 20 L67 34 L65 82 L55 82 L53 34 Z" fill="url(#body)"/>';
    case 'bamboo':
      return `<path d="M60 12 L66 26 L64 84 L56 84 L54 26 Z" fill="url(#body)"/>
        <path d="M56 38 L64 38 M56 54 L64 54 M56 70 L64 70" stroke="${INK}" stroke-opacity="0.55" stroke-width="2" fill="none"/>`;
    case 'blood':
      return `<path d="M60 10 L67 24 L63 16 L66 44 L62 36 L64 84 L56 84 L58 34 L54 44 L57 14 Z" fill="url(#body)"/>`;
    case 'ancient':
      return `<path d="M60 10 L68 28 L66 84 L54 84 L52 28 Z" fill="url(#body)"/>
        <path d="M56 30 L56 82 M64 30 L64 82" stroke="${INK}" stroke-opacity="0.3" stroke-width="1.6" fill="none"/>
        <path d="M60 16 L60 30" stroke="#fff" stroke-opacity="0.5" stroke-width="2" fill="none"/>`;
    case 'steel':
      return '<path d="M60 12 L65 30 L64 84 L56 84 L55 30 Z" fill="url(#body)"/>';
    default:
      return '<path d="M60 14 L66 32 L64 84 L56 84 L54 32 Z" fill="url(#body)"/>';
  }
};

const swordDecor = (v: string) => {
  if (v === 'fly') {
    return `<path d="M40 46 L30 54 M44 62 L32 70" stroke="${INK}" stroke-opacity="0.28" stroke-width="2" fill="none"/>
      <circle cx="60" cy="8" r="2.6" fill="#fff" fill-opacity="0.7"/>`;
  }
  if (v === 'mag') {
    return `<circle cx="44" cy="34" r="3.4" fill="url(#gold)"/><circle cx="76" cy="52" r="2.8" fill="url(#gold)"/>
      <circle cx="46" cy="68" r="2.4" fill="url(#gold)"/>`;
  }
  if (v === 'blood') {
    return `<path d="M64 70 q3 8 0 12" stroke="#8a1a10" stroke-width="2.6" fill="none"/>`;
  }
  if (v === 'ancient') {
    return `<path d="M46 84 L34 76 L40 88 Z" fill="url(#gold)"/><path d="M74 84 L86 76 L80 88 Z" fill="url(#gold)"/>`;
  }
  return '';
};

const SWORD: Shape = (t, extra) => {
  const v = extra || 'steel';
  const guard = v === 'bronze'
    ? '<ellipse cx="60" cy="86" rx="17" ry="5" fill="url(#gold)"/>'
    : `<rect x="44" y="85" width="32" height="6.5" rx="3" fill="url(#gold)"/>`;
  return g(`<g transform="rotate(-30 60 60)">
    ${bladeBody(v)}
    <path d="M60 ${v === 'bronze' ? 24 : 16} L60 82" stroke="#fff" stroke-opacity="0.55" stroke-width="1.1" fill="none"/>
    ${swordDecor(v)}
    ${guard}
    <rect x="55.6" y="92" width="8.8" height="17" rx="4" fill="#3a2614"/>
    <circle cx="60" cy="112" r="4.6" fill="url(#gold)"/>
  </g>`);
};

/** 单刃弯刀：南陇魔刃、天澜骨刃 */
const BLADE: Shape = () =>
  g(`<g transform="rotate(-24 60 60)">
    <path d="M60 10 L69 32 L67 74 Q61 88 50 84 L54 40 Z" fill="url(#body)"/>
    <path d="M61 14 Q65 42 63 76" stroke="#fff" stroke-opacity="0.5" stroke-width="1.3" fill="none"/>
    <rect x="44" y="82" width="26" height="6" rx="3" fill="url(#gold)"/>
    <rect x="55" y="88" width="8" height="17" rx="4" fill="#3a2614"/>
    <circle cx="59" cy="108" r="4.2" fill="url(#gold)"/>
  </g>`);

/** 幡：极阴魔幡 */
const BANNER: Shape = () =>
  g(`<rect x="56" y="14" width="5" height="92" rx="2.5" fill="#4a3a24"/>
    <path d="M61 20 L96 26 L96 74 Q86 66 78 74 Q70 82 61 74 Z" fill="url(#flat)"/>
    <path d="M70 32 L88 36" stroke="#fff" stroke-opacity="0.4" stroke-width="1.6" fill="none"/>
    <path d="M70 44 L88 48" stroke="#fff" stroke-opacity="0.28" stroke-width="1.6" fill="none"/>
    <circle cx="58" cy="14" r="5" fill="url(#gold)"/>`);

/** 杖：仙师骨杖 */
const STAFF: Shape = () =>
  g(`<rect x="57" y="34" width="6" height="72" rx="3" fill="#4a3a24"/>
    <circle cx="60" cy="28" r="15" fill="url(#body)"/>
    <circle cx="60" cy="28" r="15" fill="none" stroke="url(#gold)" stroke-width="2.4"/>
    <path d="M60 12 L64 24 L60 34 L56 24 Z" fill="#fff" fill-opacity="0.35" stroke="none"/>
    <rect x="50" y="42" width="20" height="5" rx="2.5" fill="url(#gold)"/>`);

/** 翎：乌凤翎 */
const FEATHER: Shape = () =>
  g(`<g transform="rotate(18 60 60)">
    <path d="M60 8 Q84 40 74 78 Q68 96 60 104 Q52 96 46 78 Q36 40 60 8 Z" fill="url(#flat)"/>
    <path d="M60 16 L60 100" stroke="${INK}" stroke-opacity="0.45" stroke-width="1.6" fill="none"/>
    <path d="M60 30 L74 42 M60 30 L46 42 M60 48 L76 60 M60 48 L44 60 M60 66 L72 76 M60 66 L48 76" stroke="${INK}" stroke-opacity="0.22" stroke-width="1.3" fill="none"/>
  </g>`);

/** 尺：八灵尺 */
const RULER: Shape = () =>
  g(`<g transform="rotate(-32 60 60)">
    <rect x="50" y="10" width="20" height="100" rx="3" fill="url(#flat)"/>
    <rect x="50" y="10" width="20" height="100" rx="3" fill="none" stroke="url(#gold)" stroke-width="2"/>
    <path d="M50 28 L58 28 M50 40 L58 40 M50 52 L62 52 M50 64 L58 64 M50 76 L58 76 M50 88 L62 88" stroke="${INK}" stroke-opacity="0.55" stroke-width="1.8" fill="none"/>
  </g>`);

/* ---------------- 防具 ---------------- */

/**
 * 袍身轮廓（正视成衣）：肩线平、袖子横出、身筒直下、下摆微展。
 * 前两版的教训：宽肩收腰会缩成蘑菇，肩窄摆宽会缩成铃铛；只有「袖出两侧 + 身筒等宽」在小尺寸下读作衣服。
 */
const ROBE_BODY = 'M40 24 L26 27 L26 51 L39 51 L36 97 L84 97 L81 51 L94 51 L94 27 L80 24 Z';

const robeDecor = (v: string) => {
  if (v === 'cloud') {
    return `<path d="M46 62 q6 -5 12 0 q6 5 12 0" stroke="#fff" stroke-opacity="0.55" stroke-width="1.8" fill="none"/>
      <path d="M44 72 q7 -5 14 0 q7 5 14 0" stroke="#fff" stroke-opacity="0.38" stroke-width="1.6" fill="none"/>`;
  }
  if (v === 'ice') {
    return `<path d="M44 97 L39 110 L47 105 L45 114 L53 105" fill="#bfe6ff" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M76 97 L81 110 L73 105 L75 114 L67 105" fill="#bfe6ff" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>`;
  }
  if (v === 'fur') {
    return `<path d="M50 24 Q60 34 70 24 Q60 18 50 24 Z" fill="#f0e4c0" stroke="${INK}" stroke-width="1.6"/>
      <path d="M52 24 q4 3 8 0 M60 26 q4 3 8 0" stroke="${INK}" stroke-opacity="0.3" stroke-width="1.1" fill="none"/>`;
  }
  return '';
};

const ROBE: Shape = (t, extra) => {
  const v = extra || 'plain';
  return g(`<path d="${ROBE_BODY}" fill="url(#flat)"/>
    <path d="M37 88 L83 88 L84 97 L36 97 Z" fill="${t.dark}" fill-opacity="0.65"/>
    <path d="M39 51 L36 88 M81 51 L84 88" stroke="${INK}" stroke-opacity="0.22" stroke-width="1.4" fill="none"/>
    <path d="M50 24 L60 46 L70 24" fill="none" stroke="#e8f4f8" stroke-width="4" stroke-linejoin="round"/>
    <path d="M50 24 L60 46 L70 24" fill="none" stroke="${INK}" stroke-opacity="0.3" stroke-width="1.4"/>
    ${robeDecor(v)}
    <rect x="40" y="66" width="40" height="9" rx="2" fill="url(#gold)"/>
    <rect x="55" y="66" width="10" height="9" rx="2" fill="${t.dark}" fill-opacity="0.5"/>`);
};

/** 甲/铠：方尖魔铠、蛟龙宝甲 —— 同一件成衣骨架上换成硬质甲片：护肩球、胸心宝珠、腰带 */
const PLATE: Shape = () =>
  g(`<path d="M40 24 L26 27 L26 51 L39 51 L37 93 L60 99 L83 93 L81 51 L94 51 L94 27 L80 24 Z" fill="url(#body)"/>
    <circle cx="31" cy="33" r="11" fill="url(#flat)"/>
    <circle cx="89" cy="33" r="11" fill="url(#flat)"/>
    <path d="M50 24 L60 46 L70 24" fill="none" stroke="${INK}" stroke-opacity="0.35" stroke-width="2.4"/>
    <path d="M60 50 L60 94" stroke="${INK}" stroke-opacity="0.26" stroke-width="1.6" fill="none"/>
    <circle cx="60" cy="60" r="8" fill="url(#gold)"/>
    <circle cx="60" cy="60" r="3.4" fill="#fff" fill-opacity="0.7"/>
    <path d="M38 74 L82 74" stroke="url(#gold)" stroke-width="2.6" fill="none"/>
    <path d="M38 84 L82 84" stroke="${INK}" stroke-opacity="0.3" stroke-width="2" fill="none"/>`);

/** 鳞甲：蛟鳞甲 */
/** 鳞甲：蛟鳞甲 —— 与甲同骨架，整片覆盖鳞纹 */
const SCALE: Shape = () =>
  g(`<path d="M40 24 L26 27 L26 51 L39 51 L37 93 L60 99 L83 93 L81 51 L94 51 L94 27 L80 24 Z" fill="url(#flat)"/>
    <path d="M32 34 q10 9 20 0 q10 9 20 0 q10 9 20 0
             M30 50 q11 9 22 0 q11 9 22 0 q11 9 22 0
             M40 66 q10 9 20 0 q10 9 20 0
             M38 82 q11 9 22 0 q11 9 22 0"
          fill="none" stroke="${INK}" stroke-opacity="0.42" stroke-width="1.9"/>
    <circle cx="60" cy="22" r="4.4" fill="url(#gold)"/>`);

/* ---------------- 冠 ---------------- */

const CROWN: Shape = (t, extra) => {
  const v = extra || 'plain';
  if (v === 'taoist') {
    return g(`<path d="M42 66 Q42 34 60 34 Q78 34 78 66 Z" fill="url(#body)"/>
      <path d="M40 66 L80 66 L80 76 L40 76 Z" fill="url(#gold)"/>
      <path d="M60 30 L60 18" stroke="url(#gold)" stroke-width="3" fill="none"/>
      <circle cx="60" cy="16" r="3.4" fill="url(#gold)"/>`);
  }
  // 玄铁冠：素发带 + 一根竖簪，不用尖顶
  if (v === 'iron') {
    return g(`<path d="M30 60 Q60 44 90 60 L90 74 Q60 58 30 74 Z" fill="url(#body)"/>
      <path d="M30 60 Q60 44 90 60" fill="none" stroke="url(#gold)" stroke-width="2.4"/>
      <path d="M60 46 L60 18" stroke="url(#gold)" stroke-width="3.2" fill="none"/>
      <circle cx="60" cy="16" r="3.6" fill="url(#gold)"/>`);
  }
  // 海妖王冠：珊瑚枝，枝头挂珠
  if (v === 'sea') {
    return g(`<path d="M34 76 L38 52 Q44 40 46 52 L48 78 Z" fill="url(#body)"/>
      <path d="M52 76 L54 40 Q60 26 64 40 L66 78 Z" fill="url(#body)"/>
      <path d="M72 76 L76 50 Q82 38 86 50 L88 76 Z" fill="url(#body)"/>
      <rect x="30" y="74" width="60" height="10" rx="3" fill="url(#gold)"/>
      <circle cx="46" cy="50" r="3.4" fill="url(#gold)"/>
      <circle cx="60" cy="36" r="4" fill="url(#gold)"/>
      <circle cx="82" cy="48" r="3.2" fill="url(#gold)"/>`);
  }
  // 紫罗天冠：通天冠式高冠，纵向罗纹
  if (v === 'tall') {
    return g(`<path d="M44 74 L48 26 Q60 16 72 26 L76 74 Z" fill="url(#body)"/>
      <path d="M52 70 L55 26 M60 68 L60 22 M68 70 L65 26" stroke="${INK}" stroke-opacity="0.26" stroke-width="1.5" fill="none"/>
      <rect x="40" y="72" width="40" height="12" rx="3" fill="url(#gold)"/>
      <path d="M60 18 L60 8" stroke="url(#gold)" stroke-width="2.6" fill="none"/>`);
  }
  const extraPoint = v === 'star' ? '<path d="M60 14 L60 26" stroke="url(#gold)" stroke-width="2.4" fill="none"/>' : '';
  const gem = v === 'crystal' || v === 'plain' ? '<circle cx="60" cy="50" r="4.6" fill="#fff" fill-opacity="0.8"/>' : '';
  const featherTag = v === 'feather'
    ? '<path d="M86 34 Q100 24 98 42 Q92 44 86 40 Z" fill="#f0e4c0" stroke-width="1.8"/>' : '';
  return g(`<path d="M28 76 L34 34 L48 54 L60 26 L72 54 L86 34 L92 76 Z" fill="url(#body)"/>
    <rect x="28" y="74" width="64" height="12" rx="3" fill="url(#gold)"/>
    ${gem}${extraPoint}${featherTag}`);
};

/* ---------------- 首饰 ---------------- */

const NECKLACE: Shape = (t, extra) => {
  const gem = extra === 'pearl'
    ? '<circle cx="60" cy="80" r="12" fill="url(#body)"/>'
    : extra === 'round'
      ? '<circle cx="60" cy="78" r="13" fill="url(#body)"/>'
      : '<path d="M60 62 L72 78 L60 96 L48 78 Z" fill="url(#body)"/>';
  return g(`<path d="M32 34 Q60 74 88 34" fill="none" stroke="${INK}" stroke-width="3.4"/>
    <path d="M32 34 Q60 70 88 34" fill="none" stroke="url(#gold)" stroke-width="1.8"/>
    ${gem}`);
};

const BRACELET: Shape = () =>
  g(`<circle cx="60" cy="58" r="30" fill="none" stroke="${INK}" stroke-width="9"/>
    <circle cx="60" cy="58" r="30" fill="none" stroke="url(#flat)" stroke-width="6.5"/>
    <path d="M60 28 L60 88" stroke="${INK}" stroke-opacity="0.35" stroke-width="1.6"/>
    <path d="M42 36 L78 80" stroke="${INK}" stroke-opacity="0.2" stroke-width="1.4"/>
    <circle cx="60" cy="28" r="6" fill="url(#gold)"/>`);

const RING: Shape = (t, extra) => {
  const gem = extra === 'round'
    ? '<circle cx="60" cy="36" r="12" fill="url(#body)"/>'
    : extra === 'square'
      ? '<rect x="49" y="25" width="22" height="22" rx="3" fill="url(#body)"/>'
      : '<path d="M60 22 L74 38 L60 54 L46 38 Z" fill="url(#body)"/>';
  return g(`<circle cx="60" cy="76" r="21" fill="none" stroke="${INK}" stroke-width="10"/>
    <circle cx="60" cy="76" r="21" fill="none" stroke="url(#gold)" stroke-width="7"/>
    ${gem}`);
};

/* ---------------- 丹药 ---------------- */

const PILL: Shape = (t, extra) => {
  const [rRaw, motif] = parts(extra);
  const r = num(rRaw, 26);
  const overlays: Record<string, string> = {
    leaf: `<path d="M60 40 q10 -8 16 -2 q-6 10 -16 2 Z" fill="#e8ffd8" stroke-width="1.6"/>
      <path d="M56 52 q-10 -6 -14 2 q8 8 14 -2 Z" fill="#e8ffd8" stroke-width="1.6"/>`,
    swirl: `<path d="M60 48 q10 0 10 9 q0 10 -11 10 q-10 0 -10 -9" fill="none" stroke="#e8f6ff" stroke-opacity="0.85" stroke-width="2.6"/>`,
    star: `<path d="M52 44 l2 5 5 1 -4 4 1 5 -4 -3 -4 3 1 -5 -4 -4 5 -1 Z" fill="#fff" fill-opacity="0.8" stroke-width="1.2"/>
      <path d="M70 62 l1.6 4 4 0.8 -3 3 0.8 4 -3.4 -2.4 -3.4 2.4 0.8 -4 -3 -3 4 -0.8 Z" fill="#fff" fill-opacity="0.6" stroke-width="1"/>`,
    bolt: `<path d="M62 40 L54 58 L60 58 L56 76" fill="none" stroke="#f0e4ff" stroke-width="3" stroke-linecap="round"/>`,
    flame: `<path d="M60 38 q8 12 2 20 q8 -2 6 -10 q8 10 -2 20 q-10 8 -16 -2 q-4 -10 6 -16 q-2 6 2 8 q2 -12 2 -20 Z" fill="#ffd0a0" fill-opacity="0.9" stroke-width="1.6"/>`,
    ring: `<circle cx="60" cy="56" r="${r * 0.62}" fill="none" stroke="#fff6d8" stroke-opacity="0.55" stroke-width="2.2"/>`,
    cloud: `<path d="M46 54 q6 -8 14 -2 q6 -8 14 -1 q8 0 6 8" fill="none" stroke="#eaf4ff" stroke-opacity="0.75" stroke-width="2.4"/>`,
    eye: `<ellipse cx="60" cy="56" rx="13" ry="8" fill="none" stroke="#fff" stroke-opacity="0.75" stroke-width="2.4"/><circle cx="60" cy="56" r="3.4" fill="#fff" fill-opacity="0.85"/>`,
    none: '',
  };
  return g(`<circle cx="60" cy="59" r="${r}" fill="url(#body)"/>
    <path d="M${60 - r} ${59 + 5} q${r} ${r * 0.45} ${r * 2} -5" fill="none" stroke="${INK}" stroke-opacity="0.38" stroke-width="2.2"/>
    <circle cx="60" cy="59" r="${r}" fill="none" stroke="url(#gold)" stroke-width="3"/>
    ${overlays[motif ?? 'none'] ?? ''}
    <ellipse cx="${60 - r * 0.42}" cy="${59 - r * 0.52}" rx="${r * 0.28}" ry="${r * 0.19}" fill="#fff" opacity="0.65" stroke="none" transform="rotate(-34 ${60 - r * 0.42} ${59 - r * 0.52})"/>`);
};

/* ---------------- 功法书 ---------------- */

const BOOK: Shape = (_t, extra) => {
  const [cls = '#2c4491', char = '功'] = parts(extra);
  return g(`<rect x="40" y="24" width="46" height="68" rx="3" fill="#f6ecd2"/>
    <rect x="28" y="22" width="50" height="70" rx="4" fill="${cls}"/>
    <rect x="28" y="22" width="9" height="70" fill="#0f1830" opacity="0.45" stroke="none"/>
    <rect x="44" y="42" width="22" height="22" rx="2" fill="#f7efd8" stroke="url(#gold)" stroke-width="2.4"/>
    <text x="55" y="54" font-family="STKaiti, KaiTi, serif" font-size="16" font-weight="600" fill="${INK}" stroke="none" text-anchor="middle" dominant-baseline="central">${char}</text>
    <rect x="44" y="70" width="22" height="3.4" rx="1.7" fill="url(#gold)" stroke="none"/>`);
};

/* ---------------- 材料 ---------------- */

const GRASS: Shape = () =>
  g(`<path d="M60 98 L58 52 M58 70 Q40 62 36 44 Q54 48 58 66 Z" fill="url(#flat)"/>
    <path d="M60 62 Q80 54 84 36 Q64 40 60 58 Z" fill="url(#flat)"/>
    <path d="M62 96 Q78 78 76 58 Q64 72 62 92 Z" fill="url(#flat)"/>
    <path d="M60 98 L60 60" stroke="${INK}" stroke-width="2" fill="none"/>`);

const FLOWER: Shape = () =>
  g(`<path d="M60 98 L60 62" stroke="${INK}" stroke-width="2.6" fill="none"/>
    <path d="M60 76 Q42 70 38 54 Q56 56 60 72 Z" fill="url(#flat)"/>
    <ellipse cx="60" cy="30" rx="6" ry="9" fill="url(#flat)"/>
    <ellipse cx="46" cy="42" rx="9" ry="6" fill="url(#flat)"/>
    <ellipse cx="74" cy="42" rx="9" ry="6" fill="url(#flat)"/>
    <ellipse cx="60" cy="56" rx="8" ry="5" fill="url(#flat)"/>
    <circle cx="60" cy="44" r="8" fill="url(#body)"/>
    <circle cx="60" cy="44" r="4" fill="url(#gold)"/>`);

const ROOT: Shape = (t, extra) => {
  const curl = extra === 'curl'
    ? `<path d="M62 44 Q80 34 88 22 Q74 26 62 42 Z" fill="url(#flat)"/>
       <path d="M58 60 Q40 54 30 42 Q46 44 58 58 Z" fill="url(#flat)"/>`
    : `<path d="M62 44 Q78 40 84 30 Q70 32 62 42 Z" fill="url(#flat)"/>
       <path d="M58 52 Q42 48 38 38 Q52 40 58 50 Z" fill="url(#flat)"/>`;
  return g(`<path d="M60 30 Q66 48 62 70 Q58 86 60 100" stroke="${INK}" stroke-width="3" fill="none"/>
    ${curl}
    <path d="M60 70 Q76 74 82 86 Q66 84 60 72 Z" fill="url(#flat)"/>
    <path d="M58 78 Q42 82 38 94 Q54 92 58 80 Z" fill="url(#flat)"/>
    <circle cx="60" cy="32" r="4" fill="url(#gold)"/>`);
};

const VINE: Shape = () =>
  g(`<path d="M44 100 Q30 76 46 58 Q62 40 52 22" fill="none" stroke="${INK}" stroke-width="4"/>
    <path d="M44 100 Q30 76 46 58 Q62 40 52 22" fill="none" stroke="url(#flat)" stroke-width="2.4"/>
    <path d="M46 58 Q64 54 70 40 Q52 40 46 56 Z" fill="url(#flat)"/>
    <path d="M42 76 Q26 74 22 60 Q40 62 42 74 Z" fill="url(#flat)"/>
    <path d="M52 22 Q58 8 72 6 Q66 20 52 22 Z" fill="url(#flat)"/>`);

const SEED: Shape = (t, extra) => {
  const triple = extra === 'triple';
  return g(`<path d="M60 24 Q82 46 76 72 Q72 92 60 98 Q48 92 44 72 Q38 46 60 24 Z" fill="url(#flat)"/>
    <circle cx="54" cy="62" r="5" fill="${INK}" fill-opacity="0.45"/>
    <circle cx="67" cy="74" r="4.2" fill="${INK}" fill-opacity="0.35"/>
    ${triple ? `<circle cx="60" cy="46" r="3.8" fill="${INK}" fill-opacity="0.35"/>` : ''}
    <path d="M58 30 Q52 50 56 84" fill="none" stroke="#fff" stroke-opacity="0.4" stroke-width="1.6"/>`);
};

const HIDE: Shape = (t, extra) => {
  const fin = extra === 'fin';
  return g(`<path d="${fin ? 'M60 22 Q86 40 82 66 Q78 92 60 96 Q42 92 38 66 Q34 40 60 22 Z' : 'M34 30 Q46 18 60 24 Q74 18 86 30 Q92 52 84 74 Q72 92 60 86 Q48 92 36 74 Q28 52 34 30 Z'}" fill="url(#flat)"/>
    <path d="M44 42 Q60 52 76 42 M46 62 Q60 70 74 62" fill="none" stroke="${INK}" stroke-opacity="0.26" stroke-width="1.6"/>
    <path d="M60 ${fin ? 26 : 24} L60 ${fin ? 92 : 86}" stroke="${INK}" stroke-opacity="0.22" stroke-width="1.4"/>`);
};

const BONE: Shape = (t, extra) => {
  if (extra === 'horn') {
    return g(`<path d="M40 96 Q40 44 78 18 Q86 30 76 36 Q58 50 56 96 Z" fill="#f0ead8"/>
      <path d="M48 84 Q50 54 72 34" stroke="${INK}" stroke-opacity="0.3" stroke-width="3" fill="none"/>
      <path d="M52 46 Q58 40 64 42" stroke="#fff" stroke-opacity="0.6" stroke-width="2" fill="none"/>`);
  }
  return g(`<path d="M46 22 Q60 14 74 22 Q80 40 70 58 L64 94 Q60 100 56 94 L50 58 Q40 40 46 22 Z" fill="#f0ead8"/>
    <path d="M54 40 Q60 46 66 40" fill="none" stroke="${INK}" stroke-opacity="0.4" stroke-width="1.8"/>
    <path d="M52 62 L68 58" stroke="${INK}" stroke-opacity="0.28" stroke-width="1.6" fill="none"/>
    <path d="M50 30 Q56 24 62 30" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="2"/>`);
};

const VIAL: Shape = (t, extra) => {
  const cork = extra === 'gourd';
  return g(`${cork
    ? `<path d="M60 20 Q48 34 50 46 Q36 58 38 78 Q42 96 60 96 Q78 96 82 78 Q84 58 70 46 Q72 34 60 20 Z" fill="url(#flat)"/>`
    : `<path d="M50 22 L70 22 L70 44 Q86 56 84 76 Q80 96 60 96 Q40 96 36 76 Q34 56 50 44 Z" fill="#dfeef4"/>`}
    <path d="M40 70 Q60 84 80 70 Q82 92 60 94 Q38 92 40 70 Z" fill="url(#flat)"/>
    <rect x="46" y="14" width="28" height="9" rx="4" fill="#5a4426"/>
    <path d="M44 60 Q60 68 76 60" fill="none" stroke="#fff" stroke-opacity="0.4" stroke-width="1.8"/>`);
};

const SILK: Shape = () =>
  g(`<circle cx="60" cy="60" r="30" fill="url(#flat)"/>
    <path d="M34 52 Q60 36 86 52 M34 66 Q60 50 86 66 M40 80 Q60 66 80 80" fill="none" stroke="${INK}" stroke-opacity="0.35" stroke-width="1.8"/>
    <path d="M86 60 Q104 66 96 84" fill="none" stroke="url(#gold)" stroke-width="2.4"/>`);

const TOKEN: Shape = (t, extra) => {
  if (extra === 'tally') {
    return g(`<rect x="42" y="26" width="36" height="68" rx="4" fill="url(#body)"/>
      <rect x="42" y="26" width="36" height="68" rx="4" fill="none" stroke="url(#gold)" stroke-width="2"/>
      <path d="M52 40 L68 40 M52 52 L68 52 M52 64 L68 64 M52 76 L60 76" stroke="${INK}" stroke-opacity="0.5" stroke-width="2" fill="none"/>`);
  }
  return g(`<path d="M42 20 L78 20 L86 44 L86 96 L34 96 L34 44 Z" fill="url(#body)"/>
    <path d="M42 20 L78 20 L82 34 L38 34 Z" fill="url(#gold)"/>
    <rect x="52" y="50" width="16" height="16" rx="2" fill="none" stroke="url(#gold)" stroke-width="2.4"/>
    <path d="M60 54 L60 62 M56 58 L64 58" stroke="url(#gold)" stroke-width="2" fill="none"/>`);
};

const ORE: Shape = (t, extra) => {
  if (extra === 'block') {
    return g(`<path d="M36 46 L60 32 L84 46 L84 78 L60 92 L36 78 Z" fill="url(#flat)"/>
      <path d="M36 46 L60 60 L84 46 M60 60 L60 92" fill="none" stroke="${INK}" stroke-opacity="0.4" stroke-width="1.8"/>`);
  }
  return g(`<path d="M60 18 L80 40 L74 82 L46 82 L40 40 Z" fill="url(#body)"/>
    <path d="M60 18 L60 82 M40 40 L60 50 L80 40" fill="none" stroke="${INK}" stroke-opacity="0.32" stroke-width="1.6"/>
    <path d="M60 26 L66 44 L60 60" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="1.8"/>`);
};

const MAP: Shape = () =>
  g(`<path d="M28 26 L50 34 L74 24 L92 32 L90 92 L68 86 L46 96 L30 88 Z" fill="#f3e6c4"/>
    <path d="M50 34 L46 96 M74 24 L68 86" stroke="${INK}" stroke-opacity="0.35" stroke-width="1.8" fill="none"/>
    <path d="M36 52 Q46 46 54 54 M62 66 Q72 60 80 68" fill="none" stroke="${INK}" stroke-opacity="0.4" stroke-width="1.6"/>
    <circle cx="48" cy="72" r="3.4" fill="#b8342a"/>`);

const KEY: Shape = () =>
  g(`<circle cx="42" cy="40" r="16" fill="none" stroke="${INK}" stroke-width="9"/>
    <circle cx="42" cy="40" r="16" fill="none" stroke="url(#gold)" stroke-width="6"/>
    <path d="M54 52 L92 90" stroke="${INK}" stroke-width="9" fill="none"/>
    <path d="M54 52 L92 90" stroke="url(#gold)" stroke-width="6" fill="none"/>
    <path d="M74 74 L86 62 M82 82 L94 70" stroke="url(#gold)" stroke-width="5" fill="none"/>`);

const FRUIT: Shape = () =>
  g(`<path d="M60 26 Q88 38 84 68 Q80 96 60 96 Q40 96 36 68 Q32 38 60 26 Z" fill="url(#body)"/>
    <path d="M60 26 Q56 14 44 12 Q50 26 60 30 Z" fill="#6f9a3a"/>
    <path d="M44 58 Q58 48 74 58" fill="none" stroke="${INK}" stroke-opacity="0.3" stroke-width="1.8"/>
    <ellipse cx="50" cy="46" rx="7" ry="5" fill="#fff" opacity="0.45" stroke="none" transform="rotate(-28 50 46)"/>`);

const CAULDRON: Shape = () =>
  g(`<path d="M30 48 L90 48 Q86 88 60 88 Q34 88 30 48 Z" fill="url(#body)"/>
    <path d="M26 44 L94 44 L94 52 L26 52 Z" fill="url(#gold)"/>
    <path d="M40 88 L34 100 M80 88 L86 100" stroke="${INK}" stroke-width="4" fill="none"/>
    <path d="M48 36 Q60 24 72 36" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="2"/>`);

const BRUSH: Shape = () =>
  g(`<g transform="rotate(-28 60 60)">
    <rect x="54" y="16" width="12" height="54" rx="4" fill="#5a3c1e"/>
    <rect x="52" y="66" width="16" height="10" rx="3" fill="url(#gold)"/>
    <path d="M54 76 L66 76 L62 106 Q60 110 58 106 Z" fill="url(#body)"/>
  </g>`);

const WING: Shape = () =>
  g(`<path d="M60 40 Q34 34 22 60 Q30 74 44 72 Q32 84 38 96 Q56 88 60 68 Z" fill="url(#flat)"/>
    <path d="M60 40 Q86 34 98 60 Q90 74 76 72 Q88 84 82 96 Q64 88 60 68 Z" fill="url(#flat)"/>
    <path d="M56 44 L34 62 M60 56 L44 80" stroke="${INK}" stroke-opacity="0.28" stroke-width="1.6" fill="none"/>`);

/** 残卷：功法残卷 */
const SCROLL: Shape = () =>
  g(`<path d="M34 24 L86 24 L86 92 L34 92 Z" fill="#f3e6c4"/>
    <path d="M34 24 L86 24 L86 32 L34 32 Z" fill="#c8b48a"/>
    <path d="M34 84 L86 84 L86 92 L34 92 Z" fill="#c8b48a"/>
    <path d="M46 44 L74 44 M46 56 L74 56 M46 68 L64 68" stroke="${INK}" stroke-opacity="0.5" stroke-width="2" fill="none"/>
    <rect x="66" y="60" width="14" height="14" rx="2" fill="#b8342a"/>`);

/* ---------------- 派发表 ---------------- */

const SHAPES: Record<string, Shape> = {
  sword: SWORD, blade: BLADE, banner: BANNER, staff: STAFF, feather: FEATHER, ruler: RULER,
  robe: ROBE, plate: PLATE, scale: SCALE, crown: CROWN,
  necklace: NECKLACE, bracelet: BRACELET, ring: RING,
  pill: PILL, book: BOOK,
  grass: GRASS, flower: FLOWER, root: ROOT, vine: VINE, seed: SEED,
  hide: HIDE, bone: BONE, vial: VIAL, silk: SILK, token: TOKEN,
  ore: ORE, map: MAP, key: KEY, fruit: FRUIT, cauldron: CAULDRON,
  brush: BRUSH, wing: WING, scroll: SCROLL,
};

const has = (s: string, ...keys: string[]) => keys.some((k) => s.includes(k));

/* ---------------- 数据 ---------------- */

interface Item {
  id: string;
  name: string;
  kind: string;
  slot?: string;
  level?: number;
  skill?: string;
  seed?: boolean;
  scroll?: string;
  special?: string;
  boss?: boolean;
  heal?: number;
  mana?: number;
}
interface Skill { id: string; name: string; classId: string }

const load = <T>(name: string) =>
  JSON.parse(readFileSync(`public/data/${name}.json`, 'utf8')) as Record<string, T>;

const items = load<Item>('items');
const skills = load<Skill>('skills');

/* ---------------- 名字 → 变体 ---------------- */

function weaponSpec(name: string): { shape: string; variant: string } {
  if (has(name, '幡')) return { shape: 'banner', variant: '' };
  if (has(name, '杖')) return { shape: 'staff', variant: '' };
  if (has(name, '翎')) return { shape: 'feather', variant: '' };
  if (has(name, '尺')) return { shape: 'ruler', variant: '' };
  if (has(name, '刃')) return { shape: 'blade', variant: '' };
  if (has(name, '竹')) return { shape: 'sword', variant: 'bamboo' };
  if (has(name, '飞')) return { shape: 'sword', variant: 'fly' };
  if (has(name, '磁')) return { shape: 'sword', variant: 'mag' };
  if (has(name, '血', '魔')) return { shape: 'sword', variant: 'blood' };
  if (has(name, '昆吾', '古')) return { shape: 'sword', variant: 'ancient' };
  if (has(name, '青铜', '铜')) return { shape: 'sword', variant: 'bronze' };
  return { shape: 'sword', variant: 'steel' };
}

function armorSpec(name: string): { shape: string; variant: string } {
  if (has(name, '铠', '宝甲')) return { shape: 'plate', variant: '' };
  if (has(name, '鳞')) return { shape: 'scale', variant: '' };
  if (has(name, '裘')) return { shape: 'robe', variant: 'fur' };
  if (has(name, '冰')) return { shape: 'robe', variant: 'ice' };
  if (has(name, '云', '纹')) return { shape: 'robe', variant: 'cloud' };
  return { shape: 'robe', variant: 'plain' };
}

function crownSpec(name: string): string {
  if (has(name, '道')) return 'taoist';
  if (has(name, '羽')) return 'feather';
  if (has(name, '星')) return 'star';
  if (has(name, '铁')) return 'iron';
  if (has(name, '妖', '海')) return 'sea';
  if (has(name, '罗')) return 'tall';
  if (has(name, '玉', '晶')) return 'crystal';
  return 'plain';
}

function materialSpec(name: string, isSeed: boolean): { shape: string; variant: string } {
  if (isSeed) return { shape: 'seed', variant: has(name, '金', '参') ? 'triple' : '' };
  if (has(name, '花')) return { shape: 'flower', variant: '' };
  if (has(name, '参', '芝')) return { shape: 'root', variant: has(name, '金') ? 'curl' : '' };
  if (has(name, '根', '枝')) return { shape: 'root', variant: '' };
  if (has(name, '藤')) return { shape: 'vine', variant: '' };
  if (has(name, '草')) return { shape: 'grass', variant: '' };
  if (has(name, '丝', '网', '线')) return { shape: 'silk', variant: '' };
  if (has(name, '鳍')) return { shape: 'hide', variant: 'fin' };
  if (has(name, '皮', '鳞')) return { shape: 'hide', variant: '' };
  if (has(name, '角')) return { shape: 'bone', variant: 'horn' };
  if (has(name, '骨', '牙', '针')) return { shape: 'bone', variant: '' };
  if (has(name, '墨')) return { shape: 'vial', variant: 'gourd' };
  if (has(name, '血', '毒', '酥', '胆')) return { shape: 'vial', variant: '' };
  if (has(name, '图')) return { shape: 'map', variant: '' };
  if (has(name, '钥匙')) return { shape: 'key', variant: '' };
  if (has(name, '令', '牌', '符', '片')) return { shape: 'token', variant: has(name, '牌', '令') ? 'tally' : '' };
  if (has(name, '铁', '石')) return { shape: 'ore', variant: has(name, '铁') ? 'block' : '' };
  if (has(name, '果')) return { shape: 'fruit', variant: '' };
  if (has(name, '鼎')) return { shape: 'cauldron', variant: '' };
  if (has(name, '笔')) return { shape: 'brush', variant: '' };
  if (has(name, '羽')) return { shape: 'feather', variant: '' };
  if (has(name, '翼', '魟')) return { shape: 'wing', variant: '' };
  if (has(name, '丹')) return { shape: 'pill', variant: '' };
  return { shape: 'token', variant: 'tally' };
}

/** 丹药按名字挑纹样 */
function pillMotif(name: string): string {
  if (has(name, '回春', '养元', '草')) return 'leaf';
  if (has(name, '回气', '聚气', '凝气')) return 'swirl';
  if (has(name, '凝神', '玄')) return 'star';
  if (has(name, '雷', '辟邪')) return 'bolt';
  if (has(name, '火', '回天', '大还')) return 'flame';
  if (has(name, '筑基', '降尘')) return 'cloud';
  if (has(name, '定灵', '固元')) return 'eye';
  return 'ring';
}

const PILL_RADIUS: Record<string, number> = {
  'small-potion': 19, 'small-mana': 19, 'mid-potion': 22, 'mid-mana': 22,
  'big-potion': 25, 'big-mana': 25, 'huge-potion': 28, 'huge-mana': 28,
  'foundation-pill': 24, 'core-pill': 26, 'nascent-pill': 28,
};

/** 药园作物各自的色系，种子与成草同色便于对照 */
const PLANT_TINT: [string, Tint][] = [
  ['回春', TINT.moss!],
  ['凝气', { ...TINT.jade!, aura: '#8fe0ff' }],
  ['养元', TINT.amber!],
  ['聚灵', TINT.jade!],
  ['金元', { ...TINT.bronze! }],
  ['玄阴', TINT.violet!],
];
const plantTint = (name: string) => PLANT_TINT.find(([key]) => name.includes(key))?.[1] ?? TINT.moss!;

function materialTint(name: string): Tint {
  if (has(name, '血')) return TINT.crimson!;
  if (has(name, '毒')) return TINT.moss!;
  if (has(name, '墨')) return TINT.ink!;
  if (has(name, '骨', '牙', '角', '鳞', '皮', '羽', '鳍', '针')) return TINT.bone!;
  if (has(name, '铁', '石')) return TINT.steel!;
  if (has(name, '金')) return TINT.bronze!;
  if (has(name, '阴', '玄')) return TINT.violet!;
  if (has(name, '令', '牌', '图', '符', '钥匙', '笔')) return TINT.azure!;
  return plantTint(name);
}

/* ---------------- 组装 ---------------- */

interface Spec { shape: string; tint: Tint; extra: string }

const CLASS_BOOK: Record<string, string> = { body: '#9a5a2a', spell: '#2c4491', spirit: '#2f6b3a' };

function specFor(item: Item): Spec | null {
  if (item.kind === 'book') {
    const taught = skills[item.skill ?? ''];
    const char = (taught?.name ?? '功').slice(0, 1);
    return { shape: 'book', tint: TINT.paper!, extra: `${CLASS_BOOK[taught?.classId ?? 'spell'] ?? '#2c4491'}|${char}` };
  }
  if (item.kind === 'potion') {
    const tint = item.heal ? TINT.crimson! : item.mana ? TINT.azure! : TINT.amber!;
    return { shape: 'pill', tint: jitter(tint, item.id), extra: `${PILL_RADIUS[item.id] ?? 24}|${pillMotif(item.name)}` };
  }
  if (item.kind === 'gold') return { shape: 'ore', tint: TINT.jade!, extra: 'block' };
  if (item.kind === 'scroll') {
    return item.id === 'flying-boots'
      ? { shape: 'wing', tint: TINT.paper!, extra: '' }
      : { shape: 'scroll', tint: TINT.paper!, extra: '' };
  }
  if (item.kind === 'equip') {
    const base = item.boss ? TINT.crimson! : item.special ? TINT.amber! : tierTint(item.level ?? 1);
    const tint = jitter(base, item.id);
    if (item.slot === 'weapon') {
      const s = weaponSpec(item.name);
      return { shape: s.shape, tint, extra: s.variant };
    }
    if (item.slot === 'armor') {
      const s = armorSpec(item.name);
      return { shape: s.shape, tint, extra: s.variant };
    }
    if (item.slot === 'helmet') return { shape: 'crown', tint, extra: crownSpec(item.name) };
    if (item.slot === 'necklace') {
      return { shape: 'necklace', tint, extra: /\d/.test(item.id) ? 'pearl' : 'diamond' };
    }
    if (item.slot === 'bracelet') return { shape: 'bracelet', tint, extra: '' };
    return { shape: 'ring', tint, extra: (hashOf(item.id) % 3 === 0 ? 'round' : hashOf(item.id) % 3 === 1 ? 'square' : 'diamond') };
  }
  if (item.kind === 'material') {
    if (has(item.name, '丹')) {
      return { shape: 'pill', tint: TINT.amber!, extra: `${PILL_RADIUS[item.id] ?? 24}|${pillMotif(item.name)}` };
    }
    const s = materialSpec(item.name, Boolean(item.seed));
    return { shape: s.shape, tint: jitter(materialTint(item.name), item.id), extra: s.variant };
  }
  return null;
}

function render(item: Item): string | null {
  const spec = specFor(item);
  if (!spec) return null;
  const shape = SHAPES[spec.shape];
  if (!shape) return null;
  const rot = (hashOf(item.id) % 7) - 3;
  const scale = (0.94 + (hashOf(item.id) % 9) * 0.015).toFixed(3);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
${defs(spec.tint)}
<ellipse cx="60" cy="100" rx="26" ry="5" fill="url(#shadow)"/>
${auraCircle()}
<g transform="translate(60 60) rotate(${rot}) scale(${scale}) translate(-60 -60)">
${shape(spec.tint, spec.extra)}
</g>
</svg>
`;
}

rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(OUTPUT, { recursive: true });

const written: string[] = [];
const skipped: string[] = [];
for (const item of Object.values(items)) {
  const svg = render(item);
  if (!svg) {
    skipped.push(`${item.id}(${item.kind})`);
    continue;
  }
  writeFileSync(`${OUTPUT}/${item.id}.svg`, svg);
  written.push(item.id);
}

console.log(`生成 ${written.length} 个道具图标`);
if (skipped.length > 0) console.log(`跳过 ${skipped.length} 个：${skipped.join('、')}`);

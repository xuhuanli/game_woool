/** 烘焙名单：每个角色用哪个模型、怎么改色、输出哪些动作。 */

const ADVENTURERS = '/kaykit/adventurers/addons/kaykit_character_pack_adventures';
const ENEMIES = '/quaternius/easy-enemies/Easy Animated Enemy Pack - Jan 2019/FBX';
const MONSTERS = '/quaternius/monsters/FBX';

export interface ClipSpec {
  name: string;
  /** glTF 动画名，或 FBX 动画名的结尾 */
  source: string;
  frames: number;
  rate: number;
  loop: boolean;
}

export interface Recolor {
  col: number;
  row: number;
  span?: number;
  color: string;
}

export interface Entry {
  key: string;
  model: string;
  /** 像素帧大小，显示时统一缩到 96 */
  frame: number;
  clips: ClipSpec[];
  /** 身高（世界单位），人形按头顶算，妖兽按包围盒算 */
  size: number;
  humanoid?: boolean;
  recolor?: Recolor[];
  /** 不显示的节点 */
  hide?: string[];
  headScale?: number;
  topknot?: boolean;
  /** 挂在右手的道具 */
  prop?: { model: string; scale: number };
  /** FBX 材质按名称换色 */
  materials?: Record<string, string>;
  /** 模型默认朝向的修正，单位是度 */
  yaw?: number;
}

const clip = (name: string, source: string, frames: number, rate: number, loop = true): ClipSpec => ({
  name,
  source,
  frames,
  rate,
  loop,
});

const heroClips = (attack: string): ClipSpec[] => [
  clip('idle', 'Idle', 4, 4),
  clip('walk', 'Walking_A', 8, 14),
  clip('run', 'Running_A', 6, 14),
  clip('attack', attack, 6, 16, false),
];
const npcClips = [clip('idle', 'Idle', 4, 4)];
const humanoidEnemyClips = (attack: string): ClipSpec[] => [
  clip('idle', 'Idle', 3, 4),
  clip('walk', 'Walking_A', 6, 12),
  clip('attack', attack, 5, 14, false),
];
const beastClips = (idle: string, walk: string): ClipSpec[] => [
  clip('idle', idle, 3, 5),
  clip('walk', walk, 6, 12),
  clip('attack', '_Attack', 5, 14, false),
];

const MAGE_HIDDEN = ['Spellbook', 'Spellbook_open', '1H_Wand', 'Mage_Hat'];

/** 法师长袍的色块：长袍、披风、腰带、靴子、袖口 */
const robe = (main: string, cape: string, trim = '#e6dfc8', belt = '#d9a441') => [
  { col: 0, row: 1, span: 2, color: main },
  { col: 7, row: 1, color: main },
  { col: 2, row: 1, color: cape },
  { col: 1, row: 2, color: cape },
  { col: 5, row: 0, color: belt },
  { col: 6, row: 0, color: '#3b2a22' },
  { col: 3, row: 0, span: 2, color: trim },
  { col: 3, row: 1, color: trim },
];

const npc = (key: string, main: string, cape: string): Entry => ({
  key: `npc-${key}`,
  model: `${ADVENTURERS}/Characters/gltf/Mage.glb`,
  frame: 128,
  clips: npcClips,
  size: 1.9,
  humanoid: true,
  headScale: 0.84,
  topknot: true,
  hide: [...MAGE_HIDDEN, '2H_Staff'],
  recolor: robe(main, cape),
});

/** 山魈用蛮族模型，皮肤全部换成毛色。 */
const ape = (key: string, fur: string, attack: string): Entry => ({
  key,
  model: `${ADVENTURERS}/Characters/gltf/Barbarian.glb`,
  frame: 128,
  clips: humanoidEnemyClips(attack),
  size: 1.6,
  humanoid: true,
  hide: ['Barbarian_Hat', 'Barbarian_Round_Shield', '1H_Axe', '1H_Axe_Offhand', '2H_Axe', 'Mug'],
  recolor: [
    { col: 0, row: 0, color: fur },
    { col: 0, row: 1, span: 2, color: '#6e2a24' },
    { col: 2, row: 2, color: '#6e2a24' },
  ],
});

export const ROSTER: Entry[] = [
  {
    key: 'body',
    model: `${ADVENTURERS}/Characters/gltf/Mage.glb`,
    frame: 192,
    clips: heroClips('1H_Melee_Attack_Slice_Diagonal'),
    size: 1.9,
    humanoid: true,
    headScale: 0.84,
    topknot: true,
    hide: [...MAGE_HIDDEN, '2H_Staff'],
    recolor: robe('#4c9a98', '#b23a2e'),
    prop: { model: `${ADVENTURERS}/Assets/gltf/sword_1handed.gltf`, scale: 0.62 },
  },
  {
    key: 'spell',
    model: `${ADVENTURERS}/Characters/gltf/Mage.glb`,
    frame: 192,
    clips: heroClips('Spellcast_Shoot'),
    size: 1.9,
    humanoid: true,
    headScale: 0.84,
    topknot: true,
    hide: MAGE_HIDDEN,
    recolor: robe('#dfe6ee', '#3f6fb5', '#8fb6e8', '#b9c8dc'),
  },
  {
    key: 'spirit',
    model: `${ADVENTURERS}/Characters/gltf/Rogue_Hooded.glb`,
    frame: 192,
    clips: heroClips('Spellcast_Shoot'),
    size: 1.9,
    humanoid: true,
    headScale: 0.84,
    hide: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'],
    recolor: [
      { col: 0, row: 1, span: 2, color: '#6a4c93' },
      { col: 1, row: 2, color: '#3f2d5a' },
    ],
  },

  npc('guide-senior', '#d9b84a', '#8a6a2a'),
  npc('herb-keeper', '#7ddc6f', '#3f7a3a'),
  npc('vault-keeper', '#c9a24a', '#6b4a2a'),
  npc('gate-steward', '#9fd0ff', '#3f6fb5'),
  npc('mo-doctor', '#6e6a62', '#3a3734'),
  npc('li-feiyu', '#b85c4a', '#5a2a22'),
  npc('qixuan-steward', '#a07a4a', '#5a3f2a'),
  npc('wan-xiaoshan', '#7fb0d0', '#3f5f7a'),
  npc('qingyan-elder', '#e6e6f0', '#7a7a90'),
  npc('han-yunzhi', '#e8a0b8', '#a05a70'),
  npc('sect-judge', '#5a5a6a', '#2f2f3a'),
  npc('valley-merchant', '#c9a24a', '#7a5a2a'),

  {
    key: 'ash-rat',
    model: `${ENEMIES}/Rat.fbx`,
    frame: 128,
    clips: beastClips('_Idle', '_Walk'),
    size: 1.7,
  },
  {
    key: 'gold-bug',
    model: `${ENEMIES}/Wasp.fbx`,
    frame: 128,
    clips: beastClips('_Flying', '_Flying'),
    size: 1.2,
  },
  {
    key: 'venom-spider',
    model: `${ENEMIES}/Spider.fbx`,
    frame: 128,
    clips: beastClips('_Idle', '_Walk'),
    size: 1.3,
  },
  {
    key: 'thorn-sprite',
    model: `${MONSTERS}/Slime.fbx`,
    frame: 128,
    clips: beastClips('_Idle', '_Walk'),
    size: 1.1,
  },
  {
    key: 'green-snake',
    model: `${ENEMIES}/Snake.fbx`,
    frame: 128,
    clips: beastClips('_Idle', '_Walk'),
    size: 1.6,
  },
  {
    key: 'night-bat',
    model: `${MONSTERS}/Bat.fbx`,
    frame: 128,
    clips: beastClips('_Flying', '_Flying'),
    size: 1.1,
  },
  {
    key: 'flood-serpent',
    model: `${MONSTERS}/Dragon.fbx`,
    frame: 192,
    clips: beastClips('_Flying', '_Flying'),
    size: 1.5,
    materials: { Main: '#2f8f8a', Belly: '#d9c98a', Wings: '#1f5f5f', Claws: '#e6dfc8' },
  },
  ape('mountain-ape', '#4a3626', 'Unarmed_Melee_Attack_Punch_A'),
  ape('ape-shaman', '#3f2d4a', 'Spellcast_Shoot'),
  {
    key: 'iron-puppet',
    model: `${ADVENTURERS}/Characters/gltf/Knight.glb`,
    frame: 128,
    clips: humanoidEnemyClips('1H_Melee_Attack_Chop'),
    size: 1.5,
    humanoid: true,
    hide: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '2H_Sword'],
  },
  {
    key: 'wolf-rider',
    model: `${ADVENTURERS}/Characters/gltf/Rogue.glb`,
    frame: 128,
    clips: humanoidEnemyClips('1H_Melee_Attack_Stab'),
    size: 1.6,
    humanoid: true,
    hide: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable'],
    recolor: [
      { col: 0, row: 1, span: 2, color: '#5a4634' },
      { col: 1, row: 2, color: '#3a2c20' },
    ],
  },
  {
    key: 'qingwen-daoren',
    model: `${ADVENTURERS}/Characters/gltf/Mage.glb`,
    frame: 192,
    clips: humanoidEnemyClips('Spellcast_Shoot'),
    size: 1.9,
    humanoid: true,
    headScale: 0.84,
    topknot: true,
    hide: MAGE_HIDDEN,
    recolor: robe('#3f7a6a', '#1f3f3a', '#b8d8c8', '#8fb6a0'),
  },
  {
    key: 'golden-master',
    model: `${ADVENTURERS}/Characters/gltf/Mage.glb`,
    frame: 192,
    clips: humanoidEnemyClips('Spellcast_Shoot'),
    size: 1.9,
    humanoid: true,
    hide: ['Spellbook', 'Spellbook_open', '1H_Wand'],
    recolor: robe('#e0b63c', '#8a5a1a', '#fff0b0', '#fff0b0'),
  },
];

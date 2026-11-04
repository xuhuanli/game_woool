/** 烘焙名单：每个角色用哪个模型、怎么改色、输出哪些动作。 */

const ADVENTURERS = '/kaykit/adventurers/addons/kaykit_character_pack_adventures';
const SKELETONS = '/kaykit/skeletons/addons/kaykit_character_pack_skeletons';
const ENEMIES = '/quaternius/easy-enemies/Easy Animated Enemy Pack - Jan 2019/FBX';
const MONSTERS = '/quaternius/monsters/FBX';
const ULTIMATE = '/quaternius/ultimate-monsters';

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

/** Ultimate Monsters 的大体型（Big）和飞行（Flying）两类骨骼的动作名不同 */
const bigClips = (attack = 'Punch'): ClipSpec[] => [
  clip('idle', '|Idle', 3, 5),
  clip('walk', '|Walk', 6, 12),
  clip('attack', `|${attack}`, 5, 14, false),
];
const flyingClips = (attack = 'Punch'): ClipSpec[] => [
  clip('idle', '|Flying_Idle', 3, 5),
  clip('walk', '|Fast_Flying', 6, 12),
  clip('attack', `|${attack}`, 5, 14, false),
];

/** Ultimate Monsters 的圆团体型（Blob）用咬作攻击 */
const blobClips = (): ClipSpec[] => [
  clip('idle', '|Idle', 3, 5),
  clip('walk', '|Walk', 6, 12),
  clip('attack', '|Bite_Front', 5, 14, false),
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

/** 山魈用 Ultimate Monsters 的猴形妖兽，毛色和脸色按种类改。 */
const ape = (key: string, fur: string, face: string, attack: string): Entry => ({
  key,
  model: `${ULTIMATE}/Big/Monkroose.glb`,
  frame: 128,
  clips: bigClips(attack),
  size: 1.6,
  materials: { Monkroose_Main: fur, Monkroose_Ears: '#2a1a12', Monkroose_Secondary: face },
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
  npc('forbidden-guard', '#d9b84a', '#7a2a22'),
  npc('nangong-wan', '#eef2f8', '#6a8ac8'),
  npc('li-huayuan', '#3f4a6a', '#a8342a'),
  npc('dong-xuaner', '#f0b8c8', '#c86a8a'),
  npc('yan-host', '#8a6a3a', '#4a3a2a'),
  npc('mine-steward', '#6a7a8a', '#3a4a5a'),
  npc('front-commander', '#c8a24a', '#7a2a22'),
  npc('dong-xuaner-fort', '#f0b8c8', '#c86a8a'),
  npc('li-huayuan-front', '#3f4a6a', '#a8342a'),
  npc('star-steward', '#8ab4ff', '#2a3a6a'),
  npc('star-merchant', '#c9a24a', '#5a3f2a'),
  npc('star-gate', '#9fd0ff', '#3f6fb5'),
  npc('sea-hunter', '#5a9ac8', '#2a4a5a'),
  npc('wu-chou', '#4a3a2a', '#1a1a1a'),
  npc('wu-chou-mist', '#4a3a2a', '#1a1a1a'),
  npc('xuangu-hall', '#d8d0c0', '#5a4a6a'),
  npc('xuangu-core', '#d8d0c0', '#5a4a6a'),
  npc('luoyun-steward', '#b4c8ff', '#3a4a7a'),
  npc('luoyun-elder', '#e6e6f0', '#6a6a8a'),
  npc('luoyun-merchant', '#c9a24a', '#5a3f2a'),
  npc('luoyun-gate', '#9fd0ff', '#3f6fb5'),
  npc('nanlong-hou', '#5a4a6a', '#2a1a2a'),
  npc('nanlong-outer', '#5a4a6a', '#2a1a2a'),
  npc('nanlong-inner', '#5a4a6a', '#2a1a2a'),
  npc('lu-weiying', '#8a6a3a', '#3a2a1a'),
  npc('lu-weiying-gate', '#8a6a3a', '#3a2a1a'),

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
    key: 'blood-spider',
    model: `${ENEMIES}/Spider.fbx`,
    frame: 128,
    clips: beastClips('_Idle', '_Walk'),
    size: 1.4,
    materials: { Material: '#4a0e0e', 'Material.001': '#e0a040' },
  },
  {
    key: 'red-snake',
    model: `${ENEMIES}/Snake.fbx`,
    frame: 128,
    clips: beastClips('_Idle', '_Walk'),
    size: 1.7,
    materials: { DarkGreen: '#6a1a1a', LightGreen: '#b83a2a' },
  },
  {
    key: 'mo-jiao',
    model: `${MONSTERS}/Dragon.fbx`,
    frame: 192,
    clips: beastClips('_Flying', '_Flying'),
    size: 1.6,
    materials: { Main: '#2a2a36', Belly: '#5a4a6a', Wings: '#1a1a24', Claws: '#c8b8a0' },
  },
  {
    key: 'rival-disciple',
    model: `${ADVENTURERS}/Characters/gltf/Rogue_Hooded.glb`,
    frame: 128,
    clips: humanoidEnemyClips('1H_Melee_Attack_Stab'),
    size: 1.6,
    humanoid: true,
    hide: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable'],
    recolor: [
      { col: 0, row: 1, span: 2, color: '#6a2a2a' },
      { col: 1, row: 2, color: '#3a1a1a' },
    ],
  },
  {
    key: 'feng-yue',
    model: `${ADVENTURERS}/Characters/gltf/Knight.glb`,
    frame: 192,
    clips: humanoidEnemyClips('2H_Melee_Attack_Chop'),
    size: 1.9,
    humanoid: true,
    hide: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', 'Knight_Helmet'],
  },
  {
    key: 'yin-soul',
    model: `${SKELETONS}/Characters/gltf/Skeleton_Minion.glb`,
    frame: 128,
    clips: humanoidEnemyClips('Unarmed_Melee_Attack_Punch_A'),
    size: 1.5,
    humanoid: true,
  },
  {
    key: 'corpse-puppet',
    model: `${SKELETONS}/Characters/gltf/Skeleton_Warrior.glb`,
    frame: 128,
    clips: humanoidEnemyClips('1H_Melee_Attack_Chop'),
    size: 1.7,
    humanoid: true,
  },
  {
    key: 'ghost-disciple',
    model: `${ADVENTURERS}/Characters/gltf/Mage.glb`,
    frame: 128,
    clips: humanoidEnemyClips('Spellcast_Shoot'),
    size: 1.8,
    humanoid: true,
    headScale: 0.84,
    topknot: true,
    hide: MAGE_HIDDEN,
    recolor: robe('#3a2a4a', '#1a1a2a', '#8a7aa0', '#6a5a80'),
  },
  {
    key: 'wang-chan',
    model: `${ADVENTURERS}/Characters/gltf/Rogue_Hooded.glb`,
    frame: 192,
    clips: humanoidEnemyClips('Spellcast_Shoot'),
    size: 1.9,
    humanoid: true,
    hide: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'],
    recolor: [
      { col: 0, row: 1, span: 2, color: '#4a3468' },
      { col: 1, row: 2, color: '#8a1a2a' },
    ],
  },
  {
    key: 'demon-cultist',
    model: `${ADVENTURERS}/Characters/gltf/Rogue.glb`,
    frame: 128,
    clips: humanoidEnemyClips('1H_Melee_Attack_Stab'),
    size: 1.7,
    humanoid: true,
    hide: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable'],
    recolor: [
      { col: 0, row: 1, span: 2, color: '#2a1a1a' },
      { col: 1, row: 2, color: '#8a1a1a' },
    ],
  },
  {
    key: 'blood-bat',
    model: `${MONSTERS}/Bat.fbx`,
    frame: 128,
    clips: beastClips('_Flying', '_Flying'),
    size: 1.2,
    materials: { Main: '#5a1a1a', Belly: '#8a3a2a' },
  },
  {
    key: 'blood-guardian',
    model: `${ADVENTURERS}/Characters/gltf/Barbarian.glb`,
    frame: 192,
    clips: humanoidEnemyClips('2H_Melee_Attack_Chop'),
    size: 2,
    humanoid: true,
    hide: ['Barbarian_Hat', 'Barbarian_Round_Shield', '1H_Axe', '1H_Axe_Offhand', 'Mug'],
    recolor: [
      { col: 0, row: 1, span: 2, color: '#6a1010' },
      { col: 2, row: 2, color: '#3a0a0a' },
    ],
  },
  {
    key: 'demon-swordsman',
    model: `${ADVENTURERS}/Characters/gltf/Knight.glb`,
    frame: 128,
    clips: humanoidEnemyClips('1H_Melee_Attack_Slice_Diagonal'),
    size: 1.7,
    humanoid: true,
    hide: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '2H_Sword'],
  },
  {
    key: 'poison-toad',
    model: `${ENEMIES}/Frog.fbx`,
    frame: 128,
    clips: beastClips('_Idle', '_Jump'),
    size: 1.3,
  },
  {
    key: 'demon-sorcerer',
    model: `${SKELETONS}/Characters/gltf/Skeleton_Mage.glb`,
    frame: 128,
    clips: humanoidEnemyClips('Spellcast_Shoot'),
    size: 1.7,
    humanoid: true,
  },
  {
    key: 'demon-commander',
    model: `${SKELETONS}/Characters/gltf/Skeleton_Warrior.glb`,
    frame: 192,
    clips: humanoidEnemyClips('2H_Melee_Attack_Spin'),
    size: 2.1,
    humanoid: true,
  },
  {
    key: 'flood-serpent',
    model: `${MONSTERS}/Dragon.fbx`,
    frame: 192,
    clips: beastClips('_Flying', '_Flying'),
    size: 1.5,
    materials: { Main: '#2f8f8a', Belly: '#d9c98a', Wings: '#1f5f5f', Claws: '#e6dfc8' },
  },
  ape('mountain-ape', '#5a4030', '#b8402e', 'Punch'),
  ape('ape-shaman', '#3f2d4a', '#3a6ab8', 'Weapon'),
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
  {
    key: 'sea-squid',
    model: `${ULTIMATE}/Flying/Squidle.glb`,
    frame: 128,
    clips: flyingClips(),
    size: 2,
    materials: { Squidle_Main: '#3a1a3a', Squidle_Secondary: '#1a3a5a' },
  },
  {
    key: 'fish-demon',
    model: `${ULTIMATE}/Big/Fish.glb`,
    frame: 128,
    clips: bigClips(),
    size: 1.7,
  },
  {
    key: 'flying-ray',
    model: `${ULTIMATE}/Flying/Glub.glb`,
    frame: 128,
    clips: flyingClips('Headbutt'),
    size: 1.9,
    materials: { Glub_Main: '#1a2a4a', Wings: '#4a6a9a' },
  },
  {
    key: 'sea-king',
    model: `${ULTIMATE}/Flying/Glub_Evolved.glb`,
    frame: 192,
    clips: flyingClips('Headbutt'),
    size: 2.9,
    materials: { Glub_Main: '#2a5a8a', Wings: '#d9a441' },
  },
  {
    key: 'mist-ghost',
    model: `${ULTIMATE}/Flying/Ghost.glb`,
    frame: 128,
    clips: flyingClips(),
    size: 1.4,
    materials: { Ghost_Main: '#5a6a7a' },
  },
  {
    key: 'skull-ghost',
    model: `${ULTIMATE}/Flying/Ghost_Skull.glb`,
    frame: 128,
    clips: flyingClips(),
    size: 1.5,
  },
  {
    key: 'palace-puppet',
    model: `${ULTIMATE}/Flying/Goleling_Evolved.glb`,
    frame: 128,
    clips: flyingClips(),
    size: 2.2,
    materials: { Goleling_Main: '#6a6a70', Goleling_Secondary: '#3a3a40' },
  },
  {
    key: 'treasure-seeker',
    model: `${ADVENTURERS}/Characters/gltf/Rogue_Hooded.glb`,
    frame: 128,
    clips: humanoidEnemyClips('Spellcast_Shoot'),
    size: 1.7,
    humanoid: true,
    hide: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'],
    recolor: [
      { col: 0, row: 1, span: 2, color: '#2a3a5a' },
      { col: 1, row: 2, color: '#c8a06a' },
    ],
  },
  {
    key: 'jiyin',
    model: `${ADVENTURERS}/Characters/gltf/Mage.glb`,
    frame: 192,
    clips: humanoidEnemyClips('Spellcast_Shoot'),
    size: 2,
    humanoid: true,
    headScale: 0.84,
    topknot: true,
    hide: MAGE_HIDDEN,
    recolor: robe('#1a2a24', '#3a6a5a', '#8ab4a0', '#6a8a7a'),
  },
  {
    key: 'heavenly-demon',
    model: `${ULTIMATE}/Big/Demon.glb`,
    frame: 128,
    clips: bigClips('Weapon'),
    size: 1.8,
  },
  {
    key: 'shadow-demon',
    model: `${ULTIMATE}/Flying/Demon.glb`,
    frame: 128,
    clips: flyingClips(),
    size: 1.5,
    materials: { Demon_Main: '#2a0a2a' },
  },
  {
    key: 'xuangu',
    model: `${SKELETONS}/Characters/gltf/Skeleton_Mage.glb`,
    frame: 192,
    clips: humanoidEnemyClips('Spellcast_Shoot'),
    size: 2.1,
    humanoid: true,
    topknot: true,
    hide: ['Skeleton_Mage_Hat'],
  },
  {
    key: 'demon-beast',
    model: `${ULTIMATE}/Big/Dino.glb`,
    frame: 128,
    clips: bigClips(),
    size: 1.8,
    materials: { Dino_Main: '#3a1a3a', Dino_Secondary: '#8a2a4a' },
  },
  {
    key: 'valley-wraith',
    model: `${ULTIMATE}/Flying/Tribal.glb`,
    frame: 128,
    clips: flyingClips(),
    size: 1.6,
    materials: { Tribal_Main: '#2a2a3a', Tribal_Secondary: '#5a4a6a', Tribal_Gold: '#8a7aa0' },
  },
  {
    key: 'valley-warden',
    model: `${ULTIMATE}/Big/BlueDemon.glb`,
    frame: 192,
    clips: bigClips('Weapon'),
    size: 2.5,
    materials: { BlueDemon_Main: '#1a2a3a', BlueDemon_Secondary: '#8a2a2a' },
  },
  {
    key: 'blood-ape',
    model: `${ULTIMATE}/Big/Yeti.glb`,
    frame: 128,
    clips: bigClips(),
    size: 1.9,
    materials: { Yeti_Main: '#6a1010', Yeti_Secondary: '#2a0a0a' },
  },
  {
    key: 'curse-spirit',
    model: `${ULTIMATE}/Flying/Hywirl.glb`,
    frame: 128,
    clips: flyingClips(),
    size: 1.6,
    materials: { Hywirl_Main: '#5a0a2a' },
  },
  {
    key: 'demon-cultivator',
    model: `${ADVENTURERS}/Characters/gltf/Rogue_Hooded.glb`,
    frame: 128,
    clips: humanoidEnemyClips('1H_Melee_Attack_Stab'),
    size: 1.7,
    humanoid: true,
    hide: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable'],
    recolor: [
      { col: 0, row: 1, span: 2, color: '#2a1a2a' },
      { col: 1, row: 2, color: '#6a1a3a' },
    ],
  },
  {
    key: 'ancient-shade',
    model: `${ULTIMATE}/Flying/Ghost.glb`,
    frame: 128,
    clips: flyingClips(),
    size: 1.6,
    materials: { Ghost_Main: '#3a1a5a' },
  },
  {
    key: 'demon-nanlong',
    model: `${ADVENTURERS}/Characters/gltf/Barbarian.glb`,
    frame: 192,
    clips: humanoidEnemyClips('2H_Melee_Attack_Chop'),
    size: 2.2,
    humanoid: true,
    hide: ['Barbarian_Hat', 'Barbarian_Round_Shield', '1H_Axe', '1H_Axe_Offhand', 'Mug'],
    recolor: [
      { col: 0, row: 1, span: 2, color: '#2a0a2a' },
      { col: 2, row: 2, color: '#8a1a3a' },
      { col: 0, row: 0, color: '#6a5a7a' },
    ],
  },
  // ---- 第 6 章支线：慕兰之战 ----
  {
    key: 'mulan-rider',
    model: `${ADVENTURERS}/Characters/gltf/Knight.glb`,
    frame: 128,
    clips: humanoidEnemyClips('2H_Melee_Attack_Stab'),
    size: 1.8,
    humanoid: true,
    hide: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', 'Knight_Helmet'],
    recolor: [
      { col: 0, row: 1, span: 2, color: '#5a4a2a' },
      { col: 1, row: 2, color: '#c8a06a' },
    ],
  },
  {
    key: 'mulan-mage',
    model: `${ADVENTURERS}/Characters/gltf/Mage.glb`,
    frame: 128,
    clips: humanoidEnemyClips('Spellcast_Shoot'),
    size: 1.8,
    humanoid: true,
    headScale: 0.84,
    hide: ['Spellbook', 'Spellbook_open', '1H_Wand'],
    recolor: robe('#3a5a4a', '#2a3a2a', '#d8c08a', '#c8a06a'),
  },
  {
    key: 'sacred-bird',
    model: `${ULTIMATE}/Blob/Birb.glb`,
    frame: 128,
    clips: blobClips(),
    size: 1.4,
    materials: { Birb_Main: '#e6b84a', Birb_Secondary: '#fff0c8', Birb_Beak: '#c8642a' },
  },
  {
    key: 'le-shangshi',
    model: `${ADVENTURERS}/Characters/gltf/Mage.glb`,
    frame: 192,
    clips: humanoidEnemyClips('Spellcast_Shoot'),
    size: 2.2,
    humanoid: true,
    headScale: 0.84,
    hide: ['Spellbook', 'Spellbook_open', '1H_Wand'],
    recolor: robe('#e6b84a', '#3a5a4a', '#fff0c8', '#c83a3a'),
  },
  // ---- 第 7 章：天澜草原 ----
  {
    key: 'grass-beast',
    model: `${ULTIMATE}/Flying/Alpaking.glb`,
    frame: 128,
    clips: flyingClips('Headbutt'),
    size: 1.7,
    materials: { Alpaking_Main: '#c8b08a', Alpaking_Secondary: '#8a6a4a', Wings: '#e8dcc0' },
  },
  {
    key: 'tuwu-rider',
    model: `${ULTIMATE}/Big/Orc.glb`,
    frame: 128,
    clips: bigClips('Weapon'),
    size: 1.9,
    materials: { Orc_Main: '#c89a6a', Orc_Secondary: '#6a4a2a', Orc_Hair: '#2a1a12', Belt: '#c83a3a' },
  },
  {
    key: 'tuwu-archer',
    model: `${ADVENTURERS}/Characters/gltf/Rogue.glb`,
    frame: 128,
    clips: humanoidEnemyClips('1H_Ranged_Shoot'),
    size: 1.7,
    humanoid: true,
    hide: ['Knife_Offhand', 'Knife', '2H_Crossbow', 'Throwable'],
    recolor: [
      { col: 0, row: 1, span: 2, color: '#6a4a2a' },
      { col: 1, row: 2, color: '#c83a3a' },
    ],
  },
  {
    key: 'tuwu-shaman',
    model: `${ULTIMATE}/Blob/Wizard.glb`,
    frame: 128,
    clips: blobClips(),
    size: 1.5,
    materials: { Wizard_Main: '#3a2a4a', Wizard_Secondary: '#8ad86a' },
  },
  {
    key: 'totem-golem',
    model: `${ULTIMATE}/Flying/Goleling.glb`,
    frame: 128,
    clips: flyingClips('Headbutt'),
    size: 1.9,
    materials: { Goleling_Main: '#8a6a4a', Goleling_Secondary: '#c83a3a' },
  },
  {
    key: 'tuwu-acolyte',
    model: `${ULTIMATE}/Flying/Tribal.glb`,
    frame: 128,
    clips: flyingClips(),
    size: 1.6,
    materials: { Tribal_Main: '#2a3a5a', Tribal_Secondary: '#6a4a2a', Tribal_Gold: '#e6b84a' },
  },
  {
    key: 'hu-xianshi',
    model: `${ULTIMATE}/Big/Ninja.glb`,
    frame: 192,
    clips: bigClips('Weapon'),
    size: 2.4,
    materials: { Ninja_Main: '#2a3a5a', Ninja_Secondary: '#e6b84a', Belt: '#c83a3a', Gold: '#e6b84a' },
  },
  {
    key: 'tianlan-beast',
    model: `${ULTIMATE}/Flying/Dragon_Evolved.glb`,
    frame: 192,
    clips: flyingClips('Headbutt'),
    size: 2.7,
    materials: { Dragon_Main: '#f0e8d4', Dragon_Secondary: '#e6b84a', Dragon_Horn: '#c8a06a' },
  },
  npc('cangl-chief', '#8a5a34', '#c83a3a'),
  npc('cangl-merchant', '#6a4a2a', '#c9a24a'),
  npc('cangl-guide', '#5a6a8a', '#e8dcc0'),
  npc('fengyue', '#7a6a4a', '#3a2c20'),
  npc('cangl-hunter', '#5a4634', '#a8865a'),
  npc('cangl-scout', '#4a3a2a', '#8a6a4a'),
  npc('tiandao-envoy', '#3a4a7a', '#b4c8ff'),
];

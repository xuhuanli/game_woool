import Phaser from 'phaser';
import { validateConfig, type GameConfig } from './game/config';
import { assembleConfig } from './game/configLoader';
import { World } from './game/world';
import { GameScene } from './render/GameScene';
import type { PropManifest, SpriteManifest, SpriteManifests } from './render/placeholders';
import { AutoSaver } from './save/autoSaver';
import { IndexedDbSaveStore } from './save/saveStore';
import { AutoPanel } from './ui/autoPanel';
import { Hud } from './ui/hud';
import { NpcPanel } from './ui/npcPanel';
import { showOfflineReport } from './ui/offlineDialog';
import { Panels } from './ui/panels';
import { SavePanel } from './ui/savePanel';
import { CodexPanel } from './ui/codexPanel';
import { GardenPanel } from './ui/gardenPanel';
import { SkillPanel } from './ui/skillPanel';
import { showStartScreen } from './ui/startScreen';
import './ui/hud.css';

const BAKED_SPRITES = [
  'body',
  'spell',
  'spirit',
  'ash-rat',
  'gold-bug',
  'venom-spider',
  'thorn-sprite',
  'flood-serpent',
  'mountain-ape',
  'ape-shaman',
  'iron-puppet',
  'wolf-rider',
  'golden-master',
  'npc-guide-senior',
  'npc-herb-keeper',
  'npc-vault-keeper',
  'npc-gate-steward',
  'npc-mo-doctor',
  'npc-li-feiyu',
  'npc-qixuan-steward',
  'npc-wan-xiaoshan',
  'npc-qingyan-elder',
  'npc-han-yunzhi',
  'npc-sect-judge',
  'npc-valley-merchant',
  'npc-forbidden-guard',
  'npc-nangong-wan',
  'npc-li-huayuan',
  'npc-dong-xuaner',
  'npc-dong-xuaner-fort',
  'npc-yan-host',
  'npc-mine-steward',
  'npc-front-commander',
  'npc-li-huayuan-front',
  'yin-soul',
  'corpse-puppet',
  'ghost-disciple',
  'wang-chan',
  'demon-cultist',
  'blood-bat',
  'blood-guardian',
  'demon-swordsman',
  'poison-toad',
  'demon-sorcerer',
  'demon-commander',
  'npc-star-steward',
  'npc-star-merchant',
  'npc-star-gate',
  'npc-sea-hunter',
  'npc-wu-chou',
  'npc-wu-chou-mist',
  'npc-xuangu-hall',
  'npc-xuangu-core',
  'sea-squid',
  'fish-demon',
  'flying-ray',
  'sea-king',
  'mist-ghost',
  'skull-ghost',
  'palace-puppet',
  'treasure-seeker',
  'jiyin',
  'heavenly-demon',
  'shadow-demon',
  'xuangu',
  'npc-luoyun-steward',
  'npc-luoyun-elder',
  'npc-luoyun-merchant',
  'npc-luoyun-gate',
  'npc-nanlong-hou',
  'npc-nanlong-outer',
  'npc-nanlong-inner',
  'npc-lu-weiying',
  'npc-lu-weiying-gate',
  'demon-beast',
  'valley-wraith',
  'valley-warden',
  'blood-ape',
  'curse-spirit',
  'demon-cultivator',
  'ancient-shade',
  'demon-nanlong',
  'blood-spider',
  'red-snake',
  'mo-jiao',
  'rival-disciple',
  'feng-yue',
  'green-snake',
  'night-bat',
  'qingwen-daoren',
  'mulan-rider',
  'mulan-mage',
  'sacred-bird',
  'le-shangshi',
  'grass-beast',
  'tuwu-rider',
  'tuwu-archer',
  'tuwu-shaman',
  'totem-golem',
  'tuwu-acolyte',
  'hu-xianshi',
  'tianlan-beast',
  'npc-cangl-chief',
  'npc-cangl-merchant',
  'npc-cangl-guide',
  'npc-fengyue',
  'npc-cangl-hunter',
  'npc-cangl-scout',
  'npc-tiandao-envoy',
];

function loadConfig(): Promise<GameConfig> {
  const readJson = async <T>(path: string): Promise<T> => {
    const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
    if (!response.ok) throw new Error(`无法读取 ${path}`);
    return (await response.json()) as T;
  };
  return assembleConfig(
    (name) => readJson(`data/${name}.json`),
    (file) => readJson(`maps/${file}`),
  );
}

/** 读取已烘焙的精灵表说明，没有的角色继续用占位图。 */
async function loadSpriteManifests(): Promise<SpriteManifests> {
  const manifests: SpriteManifests = {};
  for (const key of BAKED_SPRITES) {
    const response = await fetch(`${import.meta.env.BASE_URL}assets/sprites/${key}.json`);
    if (response.ok) manifests[key] = (await response.json()) as SpriteManifest;
  }
  return manifests;
}

async function loadPropManifest(): Promise<PropManifest> {
  const response = await fetch(`${import.meta.env.BASE_URL}assets/props/props.json`);
  return (await response.json()) as PropManifest;
}

const config = await loadConfig();
const [sprites, props] = await Promise.all([loadSpriteManifests(), loadPropManifest()]);
const errors = validateConfig(config);
if (errors.length > 0) throw new Error(errors.join('\n'));

const store = new IndexedDbSaveStore();
const start = await showStartScreen(config, store);
const seed = Date.now();
const world =
  start.kind === 'continue'
    ? World.fromSave(config, start.save, seed)
    : new World(config, config.game.startMap, start.classId, seed, start.name);

const report = start.kind === 'continue' ? world.settleOffline(start.save.savedAt, Date.now()) : null;

const hud = new Hud(config, world);
const panels = new Panels(world, config);
const npcPanel = new NpcPanel(world, config);
const saver = new AutoSaver(world, store, (error) => {
  console.error(error);
  hud.log('保存失败，请导出存档', 'bad');
});
new SavePanel(world, store, saver, hud);
const autoPanel = new AutoPanel(world);
new SkillPanel(world);
new CodexPanel(world);
new GardenPanel(world);
void saver.saveNow();
if (report) showOfflineReport(report);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) void saver.saveNow();
});
window.addEventListener('pagehide', () => void saver.saveNow());

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#17140f',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: new GameScene(world, hud, panels, saver, npcPanel, autoPanel, sprites, props),
});

if (import.meta.env.DEV) {
  (window as unknown as { __world: World }).__world = world;
}

import Phaser from 'phaser';
import { validateConfig, type GameConfig } from './game/config';
import { assembleConfig } from './game/configLoader';
import { World } from './game/world';
import { GameScene } from './render/GameScene';
import type { PropManifest, SpriteManifests } from './render/placeholders';
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

/** 读取烘焙时生成的精灵表索引，索引里没有的角色用占位图。 */
async function loadSpriteManifests(): Promise<SpriteManifests> {
  const response = await fetch(`${import.meta.env.BASE_URL}assets/sprites/index.json`);
  if (!response.ok) throw new Error('无法读取 assets/sprites/index.json，请运行 npm run sprites:index');
  return (await response.json()) as SpriteManifests;
}

async function loadPropManifest(): Promise<PropManifest> {
  const response = await fetch(`${import.meta.env.BASE_URL}assets/props/props.json`);
  if (!response.ok) throw new Error('无法读取 assets/props/props.json');
  return (await response.json()) as PropManifest;
}

/** 启动页上的状态：读配置时显示进度，出错时把原因列出来，不留白屏。 */
const boot = document.getElementById('boot')!;
const bootStatus = (text: string) => {
  boot.querySelector('p')!.textContent = text;
};

async function loadEverything(): Promise<{ config: GameConfig; sprites: SpriteManifests; props: PropManifest }> {
  bootStatus('读取配置…');
  const config = await loadConfig();
  bootStatus('读取素材清单…');
  const [sprites, props] = await Promise.all([loadSpriteManifests(), loadPropManifest()]);
  const errors = validateConfig(config);
  if (errors.length > 0) throw new Error(`配置表有 ${errors.length} 处错误：\n${errors.join('\n')}`);
  return { config, sprites, props };
}

let loaded: Awaited<ReturnType<typeof loadEverything>>;
try {
  loaded = await loadEverything();
} catch (error) {
  boot.classList.add('failed');
  bootStatus('游戏没能启动');
  const detail = document.createElement('pre');
  detail.textContent = error instanceof Error ? error.message : String(error);
  const retry = document.createElement('button');
  retry.textContent = '重新加载';
  retry.addEventListener('click', () => location.reload());
  boot.append(detail, retry);
  throw error;
}
boot.remove();
const { config, sprites, props } = loaded;

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

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#17140f',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: new GameScene(world, hud, panels, saver, npcPanel, autoPanel, sprites, props),
});

if (import.meta.env.DEV) {
  Object.assign(window, { __world: world, __game: game });
}

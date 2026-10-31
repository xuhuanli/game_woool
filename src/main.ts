import Phaser from 'phaser';
import { CONFIG_FILES, validateConfig, type GameConfig } from './game/config';
import { World } from './game/world';
import { GameScene } from './render/GameScene';
import { AutoSaver } from './save/autoSaver';
import { IndexedDbSaveStore } from './save/saveStore';
import { Hud } from './ui/hud';
import { Panels } from './ui/panels';
import { SavePanel } from './ui/savePanel';
import { showStartScreen } from './ui/startScreen';
import './ui/hud.css';

async function loadConfig(): Promise<GameConfig> {
  const entries = await Promise.all(
    CONFIG_FILES.map(async (name) => {
      const response = await fetch(`${import.meta.env.BASE_URL}data/${name}.json`);
      if (!response.ok) throw new Error(`无法读取配置表 ${name}`);
      return [name, await response.json()] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as GameConfig;
}

const config = await loadConfig();
const errors = validateConfig(config);
if (errors.length > 0) throw new Error(errors.join('\n'));

const store = new IndexedDbSaveStore();
const start = await showStartScreen(config, store);
const seed = Date.now();
const world =
  start.kind === 'continue'
    ? World.fromSave(config, start.save, seed)
    : new World(config, 'starter-field', start.classId, seed, start.name);

const hud = new Hud(config);
const panels = new Panels(world, config);
const saver = new AutoSaver(world, store, (error) => {
  console.error(error);
  hud.log('保存失败，请导出存档', 'bad');
});
new SavePanel(world, store, saver, hud);
void saver.saveNow();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) void saver.saveNow();
});
window.addEventListener('pagehide', () => void saver.saveNow());

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#17140f',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: new GameScene(world, hud, panels, saver),
});

if (import.meta.env.DEV) {
  (window as unknown as { __world: World }).__world = world;
}

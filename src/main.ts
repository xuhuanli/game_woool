import Phaser from 'phaser';
import { CONFIG_FILES, validateConfig, type GameConfig } from './game/config';
import { World } from './game/world';
import { GameScene } from './render/GameScene';
import { createCharacter } from './ui/characterCreate';
import { Hud } from './ui/hud';
import { Panels } from './ui/panels';
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

const character = await createCharacter(config);
const world = new World(config, 'starter-field', character.classId, Date.now(), character.name);
const hud = new Hud(config);
const panels = new Panels(world, config);

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#17140f',
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  scene: new GameScene(world, hud, panels),
});

if (import.meta.env.DEV) {
  (window as unknown as { __world: World }).__world = world;
}

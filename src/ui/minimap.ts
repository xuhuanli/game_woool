import type { World } from '../game/world';

const WIDTH = 190;
const HEIGHT = 110;
const MARGIN = 6;
const WATER_TILE = 6;
/** 崖外，小地图上直接留空 */
const VOID_TILE = 10;
/** 地形编号的颜色：泥路、岩石、水面、河岸、木桥、石板 */
const TERRAIN_COLORS: Record<number, string> = {
  4: '#94805a',
  5: '#2b2a26',
  6: '#3a7fa0',
  7: '#a89a72',
  8: '#7a5533',
  9: '#8f8b80',
};

/** 小地图：和主画面一样的斜 45 度朝向，地形只在切图时重画。 */
export class Minimap {
  private readonly name = document.getElementById('hud-map-name')!;
  private readonly canvas = document.getElementById('hud-minimap') as HTMLCanvasElement;
  private readonly context = this.canvas.getContext('2d')!;
  private readonly terrain = document.createElement('canvas');
  private mapId = '';
  private scale = 1;
  private originX = 0;

  constructor(private readonly world: World) {
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.terrain.width = WIDTH;
    this.terrain.height = HEIGHT;
  }

  update(): void {
    const { world, context } = this;
    if (world.mapId !== this.mapId) this.drawTerrain();

    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.drawImage(this.terrain, 0, 0);
    for (const portal of world.portals) this.dot(portal, '#b48cff', 3);
    for (const npc of world.npcs) this.dot(npc, '#7fd0ff', 2);
    for (const monster of world.monsters) {
      if (monster.hp > 0) this.dot(monster.cell, monster.def.boss ? '#ff4040' : '#e08a70', monster.def.boss ? 3 : 1.5);
    }
    for (const { mapId, item } of world.deathDrops) {
      if (mapId === world.mapId) this.dot(item.cell, '#ffd84a', 3);
    }
    this.dot(world.player.cell, '#ffffff', 3);
  }

  private drawTerrain(): void {
    const { world } = this;
    const { grid } = world;
    this.mapId = world.mapId;
    this.name.textContent = world.map.name;
    const span = grid.width + grid.height;
    this.scale = Math.min((WIDTH - MARGIN * 2) / span, (HEIGHT - MARGIN * 2) / (span / 2)) ;
    this.originX = WIDTH / 2 + ((grid.height - grid.width) * this.scale) / 2;

    const context = this.terrain.getContext('2d')!;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const { px, py } = this.project({ x, y });
        const tile = world.map.ground?.[y * grid.width + x] ?? 0;
        if (tile === VOID_TILE) continue;
        const walkable = grid.isWalkable({ x, y });
        const open = walkable || tile === WATER_TILE;
        context.fillStyle = open ? (TERRAIN_COLORS[tile] ?? '#4f6038') : '#2b2a26';
        context.beginPath();
        context.moveTo(px, py - this.scale / 2);
        context.lineTo(px + this.scale, py);
        context.lineTo(px, py + this.scale / 2);
        context.lineTo(px - this.scale, py);
        context.closePath();
        context.fill();
      }
    }
  }

  private project(cell: { x: number; y: number }): { px: number; py: number } {
    return {
      px: this.originX + (cell.x - cell.y) * this.scale,
      py: MARGIN + ((cell.x + cell.y) * this.scale) / 2,
    };
  }

  private dot(cell: { x: number; y: number }, color: string, radius: number): void {
    const { px, py } = this.project(cell);
    this.context.fillStyle = color;
    this.context.beginPath();
    this.context.arc(px, py, radius, 0, Math.PI * 2);
    this.context.fill();
  }
}

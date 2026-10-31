import type { Cell } from '../game/config';
import type { Vec } from '../game/world';

export const TILE_W = 64;
export const TILE_H = 32;

export function toScreen(point: Vec): Vec {
  return {
    x: ((point.x - point.y) * TILE_W) / 2,
    y: ((point.x + point.y) * TILE_H) / 2,
  };
}

export function toCell(screenX: number, screenY: number): Cell {
  const a = screenX / (TILE_W / 2);
  const b = screenY / (TILE_H / 2);
  return { x: Math.round((a + b) / 2), y: Math.round((b - a) / 2) };
}

/** 把格子朝向换成精灵表的方向行：0 东，顺时针到 7 东北。 */
export function directionRow(facing: Vec): number {
  const angle = Math.atan2(facing.x + facing.y, facing.x - facing.y);
  return ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
}

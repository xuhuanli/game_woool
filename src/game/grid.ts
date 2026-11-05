import type { Cell, MapDef } from './config';

/** 从 from 指向 to 的单位方向，八个方向之一。 */
export function direction(from: Cell, to: Cell): { x: number; y: number } {
  return { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) };
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

/** 格子距离，斜向也算 1 格。 */
export function cellDistance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export class Grid {
  readonly width: number;
  readonly height: number;
  private readonly blocked: Uint8Array;

  constructor(map: MapDef, extraBlocked: readonly Cell[] = []) {
    this.width = map.width;
    this.height = map.height;
    this.blocked = new Uint8Array(map.width * map.height);
    for (const rect of map.obstacles) {
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          if (this.inBounds({ x, y })) this.blocked[y * this.width + x] = 1;
        }
      }
    }
    for (const cell of extraBlocked) {
      if (this.inBounds(cell)) this.blocked[cell.y * this.width + cell.x] = 1;
    }
  }

  inBounds(cell: Cell): boolean {
    return cell.x >= 0 && cell.y >= 0 && cell.x < this.width && cell.y < this.height;
  }

  isWalkable(cell: Cell): boolean {
    return this.inBounds(cell) && this.blocked[cell.y * this.width + cell.x] === 0;
  }

  /** 从 origin 向外逐圈查找第一个满足条件的格子。 */
  nearest(origin: Cell, accept: (cell: Cell) => boolean, maxRadius = 8): Cell | null {
    for (let radius = 0; radius <= maxRadius; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const cell = { x: origin.x + dx, y: origin.y + dy };
          if (accept(cell)) return cell;
        }
      }
    }
    return null;
  }
}

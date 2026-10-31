import type { Cell } from './config';
import { sameCell, type Grid } from './grid';

const DIAGONAL_COST = Math.SQRT2;
const DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

interface PathNode {
  cell: Cell;
  cost: number;
  estimate: number;
  parent: PathNode | null;
}

function octile(a: Cell, b: Cell): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + (DIAGONAL_COST - 1) * Math.min(dx, dy);
}

/**
 * A* 寻路，返回不含起点的格子序列，找不到时返回 null。
 * canEnter 决定动态占用（如其他单位），斜走不能穿过静态障碍的拐角。
 */
export function findPath(
  grid: Grid,
  from: Cell,
  to: Cell,
  canEnter: (cell: Cell) => boolean,
): Cell[] | null {
  if (sameCell(from, to)) return [];

  const key = (cell: Cell) => cell.y * grid.width + cell.x;
  const open: PathNode[] = [{ cell: from, cost: 0, estimate: octile(from, to), parent: null }];
  const bestCost = new Map<number, number>([[key(from), 0]]);

  while (open.length > 0) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i]!.estimate < open[bestIndex]!.estimate) bestIndex = i;
    }
    const node = open.splice(bestIndex, 1)[0]!;

    if (sameCell(node.cell, to)) {
      const path: Cell[] = [];
      for (let step: PathNode | null = node; step?.parent; step = step.parent) {
        path.unshift(step.cell);
      }
      return path;
    }
    if (node.cost > (bestCost.get(key(node.cell)) ?? Infinity)) continue;

    for (const [dx, dy] of DIRECTIONS) {
      const next = { x: node.cell.x + dx, y: node.cell.y + dy };
      if (!grid.isWalkable(next) || !canEnter(next)) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (
        diagonal &&
        (!grid.isWalkable({ x: node.cell.x + dx, y: node.cell.y }) ||
          !grid.isWalkable({ x: node.cell.x, y: node.cell.y + dy }))
      ) {
        continue;
      }
      const cost = node.cost + (diagonal ? DIAGONAL_COST : 1);
      if (cost >= (bestCost.get(key(next)) ?? Infinity)) continue;
      bestCost.set(key(next), cost);
      open.push({ cell: next, cost, estimate: cost + octile(next, to), parent: node });
    }
  }
  return null;
}

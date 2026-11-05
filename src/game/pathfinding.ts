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

/** 按 estimate 排的最小堆，开放列表大时比逐个比较快得多 */
function push(heap: PathNode[], node: PathNode): void {
  heap.push(node);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent]!.estimate <= node.estimate) break;
    heap[i] = heap[parent]!;
    i = parent;
  }
  heap[i] = node;
}

function pop(heap: PathNode[]): PathNode {
  const top = heap[0]!;
  const last = heap.pop()!;
  if (heap.length === 0) return top;
  let i = 0;
  for (;;) {
    const left = i * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child = right < heap.length && heap[right]!.estimate < heap[left]!.estimate ? right : left;
    if (heap[child]!.estimate >= last.estimate) break;
    heap[i] = heap[child]!;
    i = child;
  }
  heap[i] = last;
  return top;
}

function octile(a: Cell, b: Cell): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + (DIAGONAL_COST - 1) * Math.min(dx, dy);
}

/**
 * A* 寻路，返回不含起点的格子序列，找不到时返回 null。
 * canEnter 决定动态占用（如其他单位），斜走不能穿过静态障碍的拐角。
 * limit 限制最多展开多少格，目标被围住走不到时不用把整张图搜一遍。
 */
export function findPath(
  grid: Grid,
  from: Cell,
  to: Cell,
  canEnter: (cell: Cell) => boolean,
  limit = Infinity,
): Cell[] | null {
  if (sameCell(from, to)) return [];

  const key = (cell: Cell) => cell.y * grid.width + cell.x;
  const open: PathNode[] = [{ cell: from, cost: 0, estimate: octile(from, to), parent: null }];
  const bestCost = new Map<number, number>([[key(from), 0]]);

  let expanded = 0;
  while (open.length > 0 && expanded < limit) {
    const node = pop(open);

    if (sameCell(node.cell, to)) {
      const path: Cell[] = [];
      for (let step: PathNode | null = node; step?.parent; step = step.parent) {
        path.unshift(step.cell);
      }
      return path;
    }
    if (node.cost > (bestCost.get(key(node.cell)) ?? Infinity)) continue;
    expanded += 1;

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
      push(open, { cell: next, cost, estimate: cost + octile(next, to), parent: node });
    }
  }
  return null;
}

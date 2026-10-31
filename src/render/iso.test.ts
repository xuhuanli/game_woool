import { describe, expect, it } from 'vitest';
import { directionRow, toCell, toScreen } from './iso';

describe('等距坐标', () => {
  it('屏幕坐标能换回原来的格子', () => {
    for (const cell of [{ x: 0, y: 0 }, { x: 5, y: 12 }, { x: 31, y: 2 }]) {
      const { x, y } = toScreen(cell);
      expect(toCell(x, y)).toEqual(cell);
    }
  });

  it('8 个朝向对应 8 个不同的方向行', () => {
    const facings = [
      { x: 1, y: -1 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: -1, y: 1 },
      { x: -1, y: 0 },
      { x: -1, y: -1 },
      { x: 0, y: -1 },
    ];
    expect(facings.map(directionRow)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

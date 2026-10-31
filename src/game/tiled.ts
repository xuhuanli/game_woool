import type { MapDef } from './config';

interface TiledProperty {
  name: string;
  value: string | number;
}

interface TiledObject {
  type: string;
  x: number;
  y: number;
  properties?: TiledProperty[];
}

interface TiledLayer {
  name: string;
  type: string;
  data?: number[];
  objects?: TiledObject[];
}

export interface TiledMap {
  width: number;
  height: number;
  tileheight: number;
  layers: TiledLayer[];
}

/** maps.json 里的条目，Tiled 地图只需要写 id、名称和复活点。 */
export type MapEntry = Pick<MapDef, 'id' | 'name' | 'safe' | 'respawn' | 'tiled'> & Partial<MapDef>;

/**
 * 把 Tiled 导出的等距地图转成 MapDef。
 * 需要三个图层：ground（地形）、blocked（障碍）、objects（start、portal、spawn 点）。
 */
export function parseTiledMap(entry: MapEntry, tiled: TiledMap): MapDef {
  const layer = (name: string) => {
    const found = tiled.layers.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`地图 ${entry.id} 缺少图层 ${name}`);
    return found;
  };
  const toCell = (object: TiledObject) => ({
    x: Math.floor(object.x / tiled.tileheight),
    y: Math.floor(object.y / tiled.tileheight),
  });
  const property = (object: TiledObject, name: string) => {
    const value = object.properties?.find((candidate) => candidate.name === name)?.value;
    if (value === undefined) throw new Error(`地图 ${entry.id} 的 ${object.type} 缺少属性 ${name}`);
    return value;
  };

  const obstacles: MapDef['obstacles'] = [];
  (layer('blocked').data ?? []).forEach((tile, index) => {
    if (tile === 0) return;
    obstacles.push({ x: index % tiled.width, y: Math.floor(index / tiled.width), w: 1, h: 1 });
  });

  const objects = layer('objects').objects ?? [];
  const start = objects.find((object) => object.type === 'start');
  if (!start) throw new Error(`地图 ${entry.id} 缺少 start 点`);

  return {
    ...entry,
    width: tiled.width,
    height: tiled.height,
    ground: layer('ground').data ?? [],
    obstacles,
    playerStart: toCell(start),
    portals: objects
      .filter((object) => object.type === 'portal')
      .map((object) => ({
        ...toCell(object),
        name: String(property(object, 'label')),
        toMap: String(property(object, 'toMap')),
        toX: Number(property(object, 'toX')),
        toY: Number(property(object, 'toY')),
      })),
    spawns: objects
      .filter((object) => object.type === 'spawn')
      .map((object) => ({ ...toCell(object), monster: String(property(object, 'monster')) })),
  };
}

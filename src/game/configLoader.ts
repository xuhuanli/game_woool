import { CONFIG_FILES, type GameConfig, type MapDef } from './config';
import { parseTiledMap, type MapEntry, type TiledMap } from './tiled';

/** 读取全部配置表，并把 Tiled 地图解析成统一的 MapDef。文件读取方式由调用方提供。 */
export async function assembleConfig(
  readData: (name: string) => Promise<unknown>,
  readTiled: (file: string) => Promise<TiledMap>,
): Promise<GameConfig> {
  const entries = await Promise.all(
    CONFIG_FILES.map(async (name) => [name, await readData(name)] as const),
  );
  const config = Object.fromEntries(entries) as unknown as GameConfig;
  const maps: Record<string, MapDef> = {};
  for (const [id, entry] of Object.entries(config.maps as Record<string, MapEntry>)) {
    maps[id] = entry.tiled ? parseTiledMap(entry, await readTiled(entry.tiled)) : (entry as MapDef);
  }
  return { ...config, maps };
}

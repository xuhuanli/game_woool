import type { Cell } from '../game/config';
import type { EquipSlot, Equipment } from '../game/equipment';
import type { QuestState } from '../game/quests';
import type { HotbarEntry } from '../game/world';

export const SAVE_VERSION = 3;

export interface SavedPlayer {
  name: string;
  classId: string;
  level: number;
  exp: number;
  gold: number;
  hp: number;
  mp: number;
  cell: Cell;
  bag: Record<string, number>;
  equipBag: Equipment[];
  equipment: Partial<Record<EquipSlot, Equipment>>;
  skills: string[];
  hotbar: (HotbarEntry | null)[];
  quests: QuestState;
  realmPassed: string[];
}

export interface SavedDeathDrop {
  mapId: string;
  cell: Cell;
  equipment: Equipment;
  /** 消失的游戏内时间 */
  expiresAt: number;
}

export interface SaveData {
  version: number;
  /** 保存时的现实时间（毫秒），闭关结算用 */
  savedAt: number;
  mapId: string;
  /** 游戏内累计时间（秒） */
  time: number;
  nextId: number;
  /** Boss 下次刷新的游戏内时间，键是 地图:刷怪点序号 */
  bossReadyAt: Record<string, number>;
  deathDrops: SavedDeathDrop[];
  player: SavedPlayer;
}

type RawSave = Record<string, unknown>;

/** 键是旧版本号，函数把该版本的存档升级到下一版。 */
export type Migrations = Record<number, (save: RawSave) => RawSave>;

export const MIGRATIONS: Migrations = {
  1: (save) => ({
    ...save,
    bossReadyAt: {},
    player: { ...(save.player as object), quests: { active: [], completed: [] } },
  }),
  2: (save) => ({
    ...save,
    deathDrops: [],
    player: { ...(save.player as object), realmPassed: [] },
  }),
};

export class SaveError extends Error {}

/** 把任意版本的存档逐版升级到当前版本。 */
export function migrateSave(
  raw: unknown,
  migrations: Migrations = MIGRATIONS,
  current: number = SAVE_VERSION,
): SaveData {
  if (typeof raw !== 'object' || raw === null) throw new SaveError('存档格式不正确');
  let save = raw as RawSave;
  if (typeof save.version !== 'number') throw new SaveError('存档缺少版本号');
  if (save.version > current) throw new SaveError('存档来自更新版本的游戏');

  while ((save.version as number) < current) {
    const version = save.version as number;
    const migrate = migrations[version];
    if (!migrate) throw new SaveError(`缺少版本 ${version} 的迁移函数`);
    save = { ...migrate(save), version: version + 1 };
  }

  const player = save.player as Partial<SavedPlayer> | undefined;
  if (!player?.classId || typeof save.mapId !== 'string') throw new SaveError('存档内容不完整');
  return save as unknown as SaveData;
}

export function parseSave(text: string): SaveData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError('不是有效的存档文件');
  }
  return migrateSave(raw);
}

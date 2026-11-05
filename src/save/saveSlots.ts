import type { GameConfig } from '../game/config';
import { realmName } from '../game/realm';
import { migrateSave, type SaveData } from './saveData';
import { clearLegacySave, readLegacySave, readRawSlots, SLOT_COUNT, writeRawSlot } from './saveStore';

export interface LoadedSlot {
  slot: number;
  save: SaveData | null;
  /** 存档读不出来时的原因，空存档和正常存档都是空字符串 */
  error: string;
}

/** 把某个槽位的原始数据解析成存档，读不出来就记下原因，不抛错。 */
export function parseSlot(slot: number, raw: unknown): LoadedSlot {
  if (raw === undefined || raw === null) return { slot, save: null, error: '' };
  try {
    return { slot, save: migrateSave(raw), error: '' };
  } catch (error) {
    return { slot, save: null, error: error instanceof Error ? error.message : '存档损坏' };
  }
}

/**
 * 读三个槽位。旧的单槽存档（键 'main'）在这里搬到 1 号槽，
 * 只搬一次：搬成功后删掉旧键。
 */
export interface SlotGateway {
  readSlots: () => Promise<(unknown | undefined)[]>;
  readLegacy: () => Promise<unknown>;
  writeSlot: (slot: number, raw: unknown) => Promise<void>;
  clearLegacy: () => Promise<void>;
}

const indexedDb: SlotGateway = {
  readSlots: readRawSlots,
  readLegacy: readLegacySave,
  writeSlot: writeRawSlot,
  clearLegacy: clearLegacySave,
};

export async function loadSlotsWith(gateway: SlotGateway): Promise<LoadedSlot[]> {
  const raws = await gateway.readSlots();
  const legacy = await gateway.readLegacy();
  if (raws[0] === undefined && legacy !== undefined && legacy !== null) {
    await gateway.writeSlot(1, legacy);
    await gateway.clearLegacy();
    raws[0] = legacy;
  }
  return Array.from({ length: SLOT_COUNT }, (_, index) => parseSlot(index + 1, raws[index]));
}

export function loadSlots(): Promise<LoadedSlot[]> {
  return loadSlotsWith(indexedDb);
}

/** 最近一次保存距今多久，给槽位列表用。 */
export function formatAgo(savedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} 天前` : `${Math.floor(days / 30)} 个月前`;
}

/** 槽位上那一行字：角色、职业、境界、等级、上次保存时间。 */
export function slotSummary(config: GameConfig, loaded: LoadedSlot, now: number): string {
  if (loaded.error) return `无法读取：${loaded.error}`;
  const { save } = loaded;
  if (!save) return '空存档';
  const className = config.classes[save.player.classId]?.name ?? save.player.classId;
  const realm = realmName(config.realms, save.player.level);
  return `${save.player.name} · ${className} · ${realm} · ${save.player.level} 级 · ${formatAgo(save.savedAt, now)}`;
}


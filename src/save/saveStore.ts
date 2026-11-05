const DB_NAME = 'xiuxian-legend';
const STORE_NAME = 'saves';
/** 旧版只有一个 'main' 键，多槽上线后第一次读到就搬到 1 号槽 */
const LEGACY_KEY = 'main';

/** 存档槽位数量 */
export const SLOT_COUNT = 3;
const ACTIVE_SLOT_KEY = 'xiuxian-slot';

export interface SaveStore {
  load(): Promise<unknown>;
  save(data: unknown): Promise<void>;
  clear(): Promise<void>;
}

export const slotKey = (slot: number): string => `slot-${slot}`;

/** 槽位号只接受 1～SLOT_COUNT，脏数据一律回到 1。 */
export function clampSlot(slot: unknown): number {
  const value = typeof slot === 'number' ? Math.trunc(slot) : Number(slot);
  if (!Number.isFinite(value)) return 1;
  return Math.min(SLOT_COUNT, Math.max(1, value));
}

/** 上次玩的是哪个槽，下次开游戏默认选中它。 */
export function readActiveSlot(): number {
  try {
    return clampSlot(window.localStorage.getItem(ACTIVE_SLOT_KEY));
  } catch {
    return 1;
  }
}

export function writeActiveSlot(slot: number): void {
  try {
    window.localStorage.setItem(ACTIVE_SLOT_KEY, String(clampSlot(slot)));
  } catch {
    // 浏览器禁用存储时只是记不住上次的槽位
  }
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      // 打不开（隐私模式、配额）时别把失败缓存在这里，下次还能重试
      database = null;
      reject(request.error);
    };
  });
  return database;
}

async function request<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return promisify(run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)));
}

/** 绑定到某一个槽位的存取器，自动保存和存档面板都用它。 */
export class IndexedDbSaveStore implements SaveStore {
  constructor(readonly slot: number = 1) {}

  load(): Promise<unknown> {
    return request('readonly', (store) => store.get(slotKey(this.slot)));
  }

  async save(data: unknown): Promise<void> {
    await request('readwrite', (store) => store.put(data, slotKey(this.slot)));
  }

  async clear(): Promise<void> {
    await request('readwrite', (store) => store.delete(slotKey(this.slot)));
  }
}

// 开始界面和存档面板要一次看三个槽，所以另外提供按槽读写的自由函数。

export function readRawSlot(slot: number): Promise<unknown> {
  return request('readonly', (store) => store.get(slotKey(clampSlot(slot))));
}

export async function writeRawSlot(slot: number, data: unknown): Promise<void> {
  await request('readwrite', (store) => store.put(data, slotKey(clampSlot(slot))));
}

export async function clearRawSlot(slot: number): Promise<void> {
  await request('readwrite', (store) => store.delete(slotKey(clampSlot(slot))));
}

/** 三个槽位的原始数据，按槽位顺序返回，空格是 undefined。 */
export async function readRawSlots(): Promise<(unknown | undefined)[]> {
  const slots: (unknown | undefined)[] = [];
  for (let slot = 1; slot <= SLOT_COUNT; slot++) slots.push(await readRawSlot(slot));
  return slots;
}

export function readLegacySave(): Promise<unknown> {
  return request('readonly', (store) => store.get(LEGACY_KEY));
}

export async function clearLegacySave(): Promise<void> {
  await request('readwrite', (store) => store.delete(LEGACY_KEY));
}

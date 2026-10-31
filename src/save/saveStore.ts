const DB_NAME = 'xiuxian-legend';
const STORE_NAME = 'saves';
const SAVE_KEY = 'main';

export interface SaveStore {
  load(): Promise<unknown>;
  save(data: unknown): Promise<void>;
  clear(): Promise<void>;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
  return promisify(request);
}

export class IndexedDbSaveStore implements SaveStore {
  private database: Promise<IDBDatabase> | null = null;

  private async objectStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    this.database ??= openDatabase();
    const database = await this.database;
    return database.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  async load(): Promise<unknown> {
    return promisify((await this.objectStore('readonly')).get(SAVE_KEY));
  }

  async save(data: unknown): Promise<void> {
    await promisify((await this.objectStore('readwrite')).put(data, SAVE_KEY));
  }

  async clear(): Promise<void> {
    await promisify((await this.objectStore('readwrite')).delete(SAVE_KEY));
  }
}

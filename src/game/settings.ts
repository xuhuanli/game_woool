/**
 * 本机偏好：音量、画质、飘叶。
 * 不进存档——换电脑或换存档时，音量应该跟着这台机器走，所以存在 localStorage。
 */

export type Quality = 'high' | 'low';

export interface GameSettings {
  /** 主音量 0～1，乘在音乐和音效上 */
  master: number;
  /** 音乐音量 0～1 */
  music: number;
  /** 音效音量 0～1 */
  sfx: number;
  /** 低画质会关掉水面波光、把飘叶放慢到一半 */
  quality: Quality;
  /** 野外飘叶 */
  leaves: boolean;
}

export const SETTINGS_KEY = 'xiuxian-settings';

/**
 * 默认值和改造前的常量对齐：0.7 × 0.5 = 原来的音乐 0.35；
 * 音效 0.8 × 单条 0.5 ≈ 原来的 0.5 × 0.5，听感基本不变。
 */
export const DEFAULT_SETTINGS: GameSettings = {
  master: 0.7,
  music: 0.5,
  sfx: 0.8,
  quality: 'high',
  leaves: true,
};

/** 只用到 localStorage 的这两个方法，测试可以塞一个假的。 */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function clamp(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/** 读进来的可能不是 JSON、缺字段、被手改过，逐项兜底。 */
export function normalizeSettings(raw: unknown): GameSettings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Partial<GameSettings>) : {};
  return {
    master: clamp(source.master, DEFAULT_SETTINGS.master),
    music: clamp(source.music, DEFAULT_SETTINGS.music),
    sfx: clamp(source.sfx, DEFAULT_SETTINGS.sfx),
    quality: source.quality === 'low' ? 'low' : 'high',
    leaves: typeof source.leaves === 'boolean' ? source.leaves : DEFAULT_SETTINGS.leaves,
  };
}

function defaultStorage(): SettingsStorage | null {
  try {
    return window.localStorage;
  } catch {
    // 浏览器禁用存储时设置只在本次生效
    return null;
  }
}

/** 设置的唯一入口：改一项就存盘并通知订阅者。 */
export class SettingsStore {
  private current: GameSettings;
  private readonly listeners = new Set<(settings: GameSettings) => void>();

  constructor(private readonly storage: SettingsStorage | null = defaultStorage()) {
    this.current = normalizeSettings(this.read());
  }

  get value(): GameSettings {
    return this.current;
  }

  /** 改一项或几项，越界的值会被夹回 0～1。 */
  update(patch: Partial<GameSettings>): GameSettings {
    this.current = normalizeSettings({ ...this.current, ...patch });
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(this.current));
    } catch {
      // 存不进去就只在本机内存里生效
    }
    for (const listener of this.listeners) listener(this.current);
    return this.current;
  }

  reset(): GameSettings {
    return this.update({ ...DEFAULT_SETTINGS });
  }

  /** 返回取消订阅的函数，界面或场景销毁时调用。 */
  onChange(listener: (settings: GameSettings) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private read(): unknown {
    try {
      const text = this.storage?.getItem(SETTINGS_KEY);
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }
}

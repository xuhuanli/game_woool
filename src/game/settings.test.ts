import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, SETTINGS_KEY, SettingsStore, type SettingsStorage } from './settings';

function fakeStorage(initial: Record<string, string> = {}): SettingsStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function storageWith(raw: unknown): SettingsStorage {
  return fakeStorage({ [SETTINGS_KEY]: JSON.stringify(raw) });
}

describe('设置', () => {
  it('没存过时用默认值', () => {
    const store = new SettingsStore(fakeStorage());
    expect(store.value).toEqual(DEFAULT_SETTINGS);
  });

  it('越界和非数字都被夹回 0～1', () => {
    const store = new SettingsStore(
      storageWith({ master: 3, music: -2, sfx: 'loud', quality: 'low', leaves: false }),
    );
    expect(store.value).toMatchObject({
      master: 1,
      music: 0,
      sfx: DEFAULT_SETTINGS.sfx,
      quality: 'low',
      leaves: false,
    });
  });

  it('画质只认 high 和 low', () => {
    expect(normalizeSettings({ quality: 'ultra' }).quality).toBe('high');
    expect(normalizeSettings({ quality: 'low' }).quality).toBe('low');
  });

  it('改一项会写进存储并通知订阅者', () => {
    const storage = fakeStorage();
    const store = new SettingsStore(storage);
    const seen: number[] = [];
    store.onChange((value) => seen.push(value.music));

    store.update({ music: 0.25 });

    expect(store.value.music).toBe(0.25);
    expect(JSON.parse(storage.getItem(SETTINGS_KEY)!)).toMatchObject({ music: 0.25 });
    expect(seen).toEqual([0.25]);
  });

  it('改音量不影响其它项', () => {
    const store = new SettingsStore(fakeStorage());
    const before = store.value;
    store.update({ sfx: 0.1 });
    expect(store.value).toEqual({ ...before, sfx: 0.1 });
  });

  it('恢复默认会把所有项拉回默认值', () => {
    const store = new SettingsStore(storageWith({ master: 0, quality: 'low', leaves: false }));
    expect(store.reset()).toEqual(DEFAULT_SETTINGS);
    expect(store.value).toEqual(DEFAULT_SETTINGS);
  });

  it('坏 JSON 或空字符串不抛错，回落到默认值', () => {
    expect(new SettingsStore(fakeStorage({ [SETTINGS_KEY]: '{oops' })).value).toEqual(DEFAULT_SETTINGS);
    expect(new SettingsStore(fakeStorage({ [SETTINGS_KEY]: '' })).value).toEqual(DEFAULT_SETTINGS);
  });

  it('没有存储（浏览器禁用）时也能改，只是不持久化', () => {
    const store = new SettingsStore(null);
    store.update({ master: 0.2 });
    expect(store.value.master).toBe(0.2);
  });

  it('取消订阅后不再收到通知', () => {
    const store = new SettingsStore(fakeStorage());
    let calls = 0;
    const off = store.onChange(() => calls++);
    store.update({ master: 0.3 });
    off();
    store.update({ master: 0.4 });
    expect(calls).toBe(1);
  });
});

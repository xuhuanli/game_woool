import { describe, expect, it } from 'vitest';
import { loadConfigFromDisk } from '../game/testConfig';
import { World } from '../game/world';
import { SAVE_VERSION } from './saveData';
import { clampSlot, SLOT_COUNT, slotKey } from './saveStore';
import { formatAgo, loadSlotsWith, parseSlot, slotSummary, type SlotGateway } from './saveSlots';

const config = await loadConfigFromDisk();
const newSave = () => new World(config, 'starter-field', 'body', 1, '韩立').toSave(1000);

function gateway(initial: { slots?: (unknown | undefined)[]; legacy?: unknown }) {
  const state: SlotGateway & { slots: (unknown | undefined)[]; legacy: unknown; writes: number } = {
    slots: initial.slots ?? Array.from({ length: SLOT_COUNT }, () => undefined),
    legacy: initial.legacy,
    writes: 0,
    async readSlots() {
      return [...this.slots];
    },
    async readLegacy() {
      return this.legacy;
    },
    async writeSlot(slot: number, raw: unknown) {
      this.writes++;
      this.slots[slot - 1] = raw;
    },
    async clearLegacy() {
      this.legacy = undefined;
    },
  };
  return state;
}

describe('存档槽位', () => {
  it('槽位号被夹到 1～3', () => {
    expect(clampSlot(0)).toBe(1);
    expect(clampSlot(2.7)).toBe(2);
    expect(clampSlot('3')).toBe(3);
    expect(clampSlot(9)).toBe(SLOT_COUNT);
    expect(clampSlot(null)).toBe(1);
    expect(clampSlot('abc')).toBe(1);
    expect(slotKey(2)).toBe('slot-2');
  });

  it('空槽位没有存档也没有错误', () => {
    expect(parseSlot(2, undefined)).toEqual({ slot: 2, save: null, error: '' });
  });

  it('正常存档解析出名字和等级', () => {
    const parsed = parseSlot(1, newSave());
    expect(parsed.error).toBe('');
    expect(parsed.save?.player.name).toBe('韩立');
    expect(parsed.save?.version).toBe(SAVE_VERSION);
  });

  it('损坏的存档只记错误，不抛异常', () => {
    const parsed = parseSlot(3, { version: 1 });
    expect(parsed.save).toBeNull();
    expect(parsed.error).toContain('不完整');
  });

  it('旧版单槽存档搬到 1 号槽，并删掉旧键', async () => {
    const save = newSave();
    const store = gateway({ legacy: save });
    const slots = await loadSlotsWith(store);

    expect(slots[0]?.save?.player.name).toBe('韩立');
    expect(slots[1]?.save).toBeNull();
    expect(store.legacy).toBeUndefined();
    expect(store.writes).toBe(1);
  });

  it('1 号槽已有存档时不动旧键', async () => {
    const save = newSave();
    const store = gateway({ slots: [save], legacy: save });
    const slots = await loadSlotsWith(store);

    expect(slots[0]?.save?.player.name).toBe('韩立');
    expect(store.writes).toBe(0);
    expect(store.legacy).toBe(save);
  });

  it('某个槽位损坏不影响其他槽位', async () => {
    const store = gateway({ slots: [{ version: 99 }, newSave()] });
    const slots = await loadSlotsWith(store);

    expect(slots[0]?.error).toContain('更新版本');
    expect(slots[1]?.save?.player.name).toBe('韩立');
    expect(slots[2]?.save).toBeNull();
  });

  it('保存时间显示成中文的相对时间', () => {
    const now = 1_000_000_000_000;
    expect(formatAgo(now - 30_000, now)).toBe('刚刚');
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5 分钟前');
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe('3 小时前');
    expect(formatAgo(now - 2 * 86_400_000, now)).toBe('2 天前');
    expect(formatAgo(now - 40 * 86_400_000, now)).toBe('1 个月前');
  });

  it('槽位摘要带上角色、职业、境界和等级', () => {
    const parsed = parseSlot(1, newSave());
    const summary = slotSummary(config, parsed, 1000 + 65_000);
    expect(summary).toContain('韩立');
    expect(summary).toContain(config.classes.body!.name);
    expect(summary).toContain('1 级');
    expect(summary).toContain('1 分钟前');
  });

  it('空槽和坏档的摘要能区分', () => {
    expect(slotSummary(config, parseSlot(1, undefined), 0)).toBe('空存档');
    expect(slotSummary(config, parseSlot(2, { version: 1 }), 0)).toContain('无法读取');
  });
});

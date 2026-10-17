import { describe, expect, it, vi } from 'vitest';
import { createDevotionPreferencesStore } from '../../src/services/devotionPreferences';

const key = 'qingmu.devotion.follow.v1.m-6d'; // existing v1 key for synthetic member m
function memory(raw?: unknown) {
  const values = new Map<string, string>(raw ? [[key, JSON.stringify(raw)]] : []);
  return { values, getItem: async (k: string) => values.get(k) ?? null, setItem: async (k: string, v: string) => { values.set(k, v); } };
}
// 2026-10-17 (維護者): the seven-day 接續靈修 offer is gone; the reading end shows 接著讀靈修 › every day instead,
// so the only way to turn auto-follow on or off is the ⋯ menu switch.
describe('接續靈修 opt in, chosen only in the ⋯ menu (#10)', () => {
  it('stays off when local preference storage cannot be read, and the menu can still choose', async () => {
    const store = createDevotionPreferencesStore({ getItem: async () => { throw new Error('temporarily locked'); }, setItem: async () => undefined });
    await store.load('m');
    expect(store.getSnapshot('m').enabled).toBe(false);
    store.setEnabled('m', true);
    expect(store.getSnapshot('m')).toMatchObject({ enabled: true, touched: true });
  });
  it.each([undefined, { enabled: true, touched: false }, { enabled: false, touched: false, firstOfferedOn: '2026-10-14' }])('defaults off and migrates untouched v1 %j off', async raw => {
    const store = createDevotionPreferencesStore(memory(raw));
    expect(store.getSnapshot('m').enabled).toBe(false);
    await store.load('m');
    expect(store.getSnapshot('m')).toMatchObject({ ready: true, enabled: false, touched: false });
  });
  it.each([true, false])('preserves an explicit %s selection across reopen', async enabled => {
    const storage = memory({ enabled, touched: true });
    const store = createDevotionPreferencesStore(storage);
    await store.load('m');
    expect(store.getSnapshot('m').enabled).toBe(enabled);
    store.setEnabled('m', !enabled);
    await vi.waitFor(() => expect(JSON.parse(storage.values.get(key)!)).toMatchObject({ enabled: !enabled, touched: true }));
    const reopened = createDevotionPreferencesStore(storage);
    await reopened.load('m');
    expect(reopened.getSnapshot('m')).toMatchObject({ enabled: !enabled, touched: true });
  });
  it('offers no time-limited prompt any more', () => {
    const store = createDevotionPreferencesStore(memory());
    expect(Object.keys(store).sort()).toEqual(['getSnapshot', 'load', 'setEnabled', 'subscribe']);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDevotionPreferencesStore } from '../../src/services/devotionPreferences';

const key = 'qingmu.devotion.follow.v1.m-6d'; // existing v1 key for synthetic member m
function memory(raw?: unknown) {
  const values = new Map<string, string>(raw ? [[key, JSON.stringify(raw)]] : []);
  return { values, getItem: async (k: string) => values.get(k) ?? null, setItem: async (k: string, v: string) => { values.set(k, v); } };
}
afterEach(() => vi.useRealTimers());
describe('接續靈修 opt in and seven calendar day local offer (#6/#10)', () => {
  it('does not infer an untouched member when local preference storage cannot be read', async () => {
    const store = createDevotionPreferencesStore({ getItem: async () => { throw new Error('temporarily locked'); }, setItem: async () => undefined });
    await store.load('m');
    expect(store.getSnapshot('m').enabled).toBe(false);
    expect(store.canOffer('m', '2026-10-14')).toBe(false);
    expect(store.firstFollow('m', '2026-10-14')).toBe(false);
    store.setEnabled('m', true); // the member can still explicitly choose from the menu
    expect(store.getSnapshot('m')).toMatchObject({ enabled: true, touched: true });
  });
  it.each([undefined, { enabled: true, touched: false }, { enabled: false, touched: false }])('defaults off and migrates untouched v1 %j off', async raw => {
    const store = createDevotionPreferencesStore(memory(raw));
    expect(store.getSnapshot('m').enabled).toBe(false);
    await store.load('m');
    expect(store.getSnapshot('m')).toMatchObject({ ready: true, enabled: false, touched: false });
  });
  it.each([true, false])('preserves an explicit %s selection, and never offers again', async enabled => {
    const store = createDevotionPreferencesStore(memory({ enabled, touched: true }));
    await store.load('m');
    expect(store.getSnapshot('m').enabled).toBe(enabled);
    expect(store.canOffer('m', '2026-10-14')).toBe(false);
    expect(store.firstFollow('m', '2026-10-14')).toBe(false);
    expect(store.getSnapshot('m').enabled).toBe(enabled);
  });
  it('starts on first exposure, expires at calendar day seven, survives reopen and isolates members', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T15:59:59Z'));
    const storage = memory(); const store = createDevotionPreferencesStore(storage);
    expect(store.canOffer('m', '2026-10-14')).toBe(false); // loading
    await store.load('m');
    expect(store.canOffer('m', '2026-10-14')).toBe(true);
    store.recordOfferShown('m', '2026-10-14');
    store.recordOfferShown('m', '2026-10-17');
    await vi.waitFor(() => expect(JSON.parse(storage.values.get(key)!).firstOfferedOn).toBe('2026-10-14'));
    const reopened = createDevotionPreferencesStore(storage); await reopened.load('m');
    expect(reopened.getSnapshot('m').firstOfferedOn).toBe('2026-10-14');
    expect(reopened.canOffer('m', '2026-10-20')).toBe(true);
    expect(reopened.canOffer('m', '2026-10-21')).toBe(false);
    expect(reopened.canOffer('m', '2026-10-13')).toBe(false);
    await reopened.load('other'); expect(reopened.canOffer('other', '2026-10-21')).toBe(true);
  });
  it('only an eligible explicit CTA or menu can enable; a later off remains off', async () => {
    const storage = memory(); const store = createDevotionPreferencesStore(storage); await store.load('m');
    store.recordOfferShown('m', '2026-10-14');
    expect(store.firstFollow('m', '2026-10-14')).toBe(true);
    expect(store.getSnapshot('m')).toMatchObject({ enabled: true, touched: true });
    store.setEnabled('m', false);
    expect(store.firstFollow('m', '2026-10-14')).toBe(false);
    await vi.waitFor(() => expect(JSON.parse(storage.values.get(key)!)).toMatchObject({ enabled: false, touched: true }));
    const reopened = createDevotionPreferencesStore(storage); await reopened.load('m');
    expect(reopened.getSnapshot('m')).toMatchObject({ enabled: false, touched: true });
  });
});

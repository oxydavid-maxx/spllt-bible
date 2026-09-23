import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined }));
import { createProfileCache } from '../../src/services/profileCache';
import { createAnnouncementClient } from '../../src/services/announcementClient';
import { createGamificationApiClient } from '../../src/services/gamificationApiClient';

const profile = (memberId: string) => ({ memberId, displayName: 'QA', earnedTotal: 3, band: null, months: [], private: { redeemableBalance: 3, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } });
const storage = () => {
  const values = new Map<string, string>();
  const validate = (key: string) => { if (!/^[\w.-]+$/.test(key)) throw new Error('Invalid SecureStore key'); };
  return { values, getItem: vi.fn(async (key: string) => { validate(key); return values.get(key) ?? null; }), setItem: vi.fn(async (key: string, value: string) => { validate(key); values.set(key, value); }) };
};
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
afterEach(() => vi.useRealTimers());

describe('native-safe profile cache', () => {
  it('round-trips colon and Unicode IDs through the real SecureStore key contract without collisions', async () => {
    const store = storage(); const cache = createProfileCache(store);
    for (const id of ['pilot:qa', 'pilot_qa', '成員:甲']) await cache.save(id, profile(id));
    for (const id of ['pilot:qa', 'pilot_qa', '成員:甲']) expect(await cache.load(id)).toMatchObject({ memberId: id, earnedTotal: 3 });
    expect(store.values.size).toBe(3);
  });
});

describe('bounded, shared reads', () => {
  it('shares an in-flight GET and aborts at 8 seconds even if fetch ignores abort', async () => {
    vi.useFakeTimers(); const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));
    const client = createGamificationApiClient({ baseUrl: 'https://qa.invalid', token: 'qa', memberId: 'qa', fetchImpl });
    const results = Promise.allSettled([client.getRewards(), client.getRewards()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8000);
    expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
  });
  it('cancels active reads and lets the next focus issue a fresh GET', async () => {
    const old = deferred<Response>(); const fetchImpl = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(new Response(JSON.stringify({ rewards: [] })));
    const client = createGamificationApiClient({ baseUrl: 'https://qa.invalid', token: 'qa', memberId: 'qa', fetchImpl });
    const pending = client.getRewards().catch((error) => error);
    client.cancelReads();
    expect(await pending).toMatchObject({ code: 'REQUEST_CANCELLED' });
    await expect(client.getRewards()).resolves.toEqual([]);
    old.resolve(new Response(JSON.stringify({ rewards: [] })));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('includes a stalled response body in the GET deadline', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: () => new Promise(() => undefined) }) as Response);
    const client = createGamificationApiClient({ baseUrl: 'https://qa.invalid', token: 'qa', memberId: 'qa', fetchImpl });
    const pending = client.getRewards().catch((error) => error);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({ code: 'READ_TIMEOUT' });
  });
  it('keeps mutation requests out of read cancellation and deduplication', async () => {
    const write = deferred<Response>(); const fetchImpl = vi.fn(() => write.promise);
    const client = createGamificationApiClient({ baseUrl: 'https://qa.invalid', token: 'qa', memberId: 'qa', fetchImpl });
    const pending = client.setRewardTarget('r'); client.cancelReads();
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBeUndefined();
    write.resolve(new Response('{}')); await pending;
  });
  it('reads announcement cache independently while one shared request is pending', async () => {
    const store = storage(); store.values.set('qingmu.announcement.latest', JSON.stringify({ week: '2026-09-20', past: [] }));
    const remote = deferred<Response>(); const fetchImpl = vi.fn(() => remote.promise);
    const client = createAnnouncementClient({ storage: store, fetchImpl });
    const first = client.load(); const second = client.load();
    await expect(client.readCached()).resolves.toMatchObject({ week: '2026-09-20' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    remote.resolve(new Response(JSON.stringify({ week: '2026-09-27', past: [] })));
    expect((await first).announcement?.week).toBe('2026-09-27'); await second;
  });
  it('returns announcement fallback at 8 seconds despite a transport that ignores abort', async () => {
    vi.useFakeTimers(); const store = storage(); store.values.set('qingmu.announcement.latest', JSON.stringify({ week: '2026-09-20', past: [] }));
    const client = createAnnouncementClient({ storage: store, fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)) });
    const pending = client.load(); await vi.advanceTimersByTimeAsync(8000);
    await expect(pending).resolves.toMatchObject({ stale: true, announcement: { week: '2026-09-20' } });
  });
});

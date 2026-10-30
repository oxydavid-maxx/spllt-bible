import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));

import { clearAuthSession, setAuthSession } from '../../src/services/authSession';
import { ASK_AGAIN, createViewCache, viewCache, viewCacheKey } from '../../src/services/viewCache';

// The one store behind every instant switch (光佑 2026-10-23). See src/services/viewCache.ts.
const memberA = { memberId: 'member-a', sessionToken: 'token-a' };
const memberB = { memberId: 'member-b', sessionToken: 'token-b' };

describe('viewCache', () => {
  beforeEach(() => { viewCache.clear(); });

  it('asks once per visit: a kept answer or one on its way is used, and a new visit shows it while asking again', async () => {
    const cache = createViewCache();
    let answer = 'first';
    const load = vi.fn(async () => answer);
    const visit = cache.beginVisit();
    await Promise.all([cache.read('k', load, visit), cache.read('k', load, visit)]);
    await cache.read('k', load, visit);
    expect(load).toHaveBeenCalledTimes(1);
    answer = 'second';
    const again = cache.read('k', load, cache.beginVisit());
    expect(cache.peek('k')).toBe('first');
    await again;
    expect(cache.peek('k')).toBe('second');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps the last answer when the network fails, and reports a failure only with nothing kept', async () => {
    const cache = createViewCache();
    await cache.read('kept', async () => 'saved', cache.beginVisit());
    const visit = cache.beginVisit();
    await expect(cache.read('kept', async () => { throw new Error('offline'); }, visit)).rejects.toThrow('offline');
    expect(cache.peek('kept')).toBe('saved');
    expect(cache.failed('kept')).toBe(false);
    await expect(cache.read('empty', async () => { throw new Error('offline'); }, visit)).rejects.toThrow('offline');
    expect(cache.failed('empty')).toBe(true);
    expect(cache.failure('empty')?.at).toBe(visit);
  });

  it('keeps the old object when the answer did not change, so nothing re-renders for it', async () => {
    const cache = createViewCache();
    await cache.read('k', async () => ({ readers: 3 }), cache.beginVisit());
    const first = cache.peek('k');
    await cache.read('k', async () => ({ readers: 3 }), cache.beginVisit());
    expect(cache.peek('k')).toBe(first);
  });

  it('ASK_AGAIN always asks; reuseValue: false asks past a finished answer; joinAnyInflight waits for any ask out', async () => {
    const cache = createViewCache();
    const visit = cache.beginVisit();
    const load = vi.fn(async () => 'x');
    await cache.read('k', load, visit);
    await cache.read('k', load, visit, { reuseValue: false });
    expect(load).toHaveBeenCalledTimes(2);
    void cache.read('k', () => new Promise<string>(() => undefined), ASK_AGAIN);
    void cache.read('k', load, visit, { reuseValue: false });
    expect(load).toHaveBeenCalledTimes(2);
    void cache.read('k', load, cache.beginVisit(), { joinAnyInflight: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('holds at most its limit, dropping the oldest', async () => {
    const cache = createViewCache({ maxEntries: 2 });
    for (const key of ['a', 'b', 'c']) await cache.read(key, async () => key);
    expect(cache.peek('a')).toBeUndefined();
    expect(cache.peek('c')).toBe('c');
  });

  it('換帳號後看不到前一個人的暫存: a change of member or a sign-out empties the store, and a late answer is dropped', async () => {
    setAuthSession(memberA);
    await viewCache.read(viewCacheKey(memberA, 'group', 'own', '2026-10'), async () => 'A 的人數');
    let release!: (value: string) => void;
    const late = viewCache.read(viewCacheKey(memberA, 'rewards', 'main'), () => new Promise<string>((resolve) => { release = resolve; }));
    await Promise.resolve();
    setAuthSession(memberB);
    expect(viewCache.peek(viewCacheKey(memberA, 'group', 'own', '2026-10'))).toBeUndefined();
    release('A 的獎品'); await late;
    expect(viewCache.peek(viewCacheKey(memberA, 'rewards', 'main'))).toBeUndefined();
    expect(viewCacheKey(memberA, 'group')).not.toBe(viewCacheKey(memberB, 'group'));
    await viewCache.read(viewCacheKey(memberB, 'group'), async () => 'B');
    clearAuthSession();
    expect(viewCache.peek(viewCacheKey(memberB, 'group'))).toBeUndefined();
  });
});

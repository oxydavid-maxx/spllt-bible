import { describe, expect, it, vi } from 'vitest';
import { createProfileCache } from '../../src/services/profileCache';
import type { ScoreProfile } from '../../src/domain/gamificationV1';

const profile = (memberId: string): ScoreProfile => ({
  memberId, displayName: '光佑', earnedTotal: 7, band: null,
  permissions: { canEditTarget: true },
  private: { redeemableBalance: 7, targetReward: null },
} as unknown as ScoreProfile);

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  };
}

describe('keeping the member their own points when the server is down', () => {
  it('saves and returns it', async () => {
    const storage = memoryStorage();
    const cache = createProfileCache(storage);
    await cache.save('pilot:guangyou', profile('pilot:guangyou'));
    expect((await cache.load('pilot:guangyou'))?.earnedTotal).toBe(7);
  });

  it('has nothing to give before the first successful load', async () => {
    expect(await createProfileCache(memoryStorage()).load('pilot:guangyou')).toBeNull();
  });

  it('survives a corrupt entry rather than crashing the page', async () => {
    const storage = memoryStorage();
    storage.store.set('qingmu.profile.pilot:guangyou', '{ this is not json');
    expect(await createProfileCache(storage).load('pilot:guangyou')).toBeNull();
  });

  it('keeps working when the device refuses to write', async () => {
    const storage = memoryStorage();
    storage.setItem.mockRejectedValueOnce(new Error('no space'));
    await expect(createProfileCache(storage).save('m', profile('m'))).resolves.toBeUndefined();
  });
});

// Someone else's totals must not end up on this phone, where they would outlive the session that
// was allowed to see them. Both ends check, because the two calls sit far apart in the page.
describe('it only ever holds the signed-in member', () => {
  it('refuses to save a profile that belongs to somebody else', async () => {
    const storage = memoryStorage();
    await createProfileCache(storage).save('pilot:guangyou', profile('member-friend'));
    expect(storage.store.size).toBe(0);
  });

  it('refuses to return a stored profile under a different member', async () => {
    const storage = memoryStorage();
    storage.store.set('qingmu.profile.member-friend', JSON.stringify(profile('pilot:guangyou')));
    expect(await createProfileCache(storage).load('member-friend')).toBeNull();
  });

  it('keeps accounts apart on the same device', async () => {
    const cache = createProfileCache(memoryStorage());
    await cache.save('a', profile('a'));
    expect(await cache.load('b')).toBeNull();
    expect((await cache.load('a'))?.memberId).toBe('a');
  });
});

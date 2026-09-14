import { describe, expect, it, vi } from 'vitest';
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
import { createGamificationPendingStore } from '../../src/services/gamificationPendingStore';

describe('gamification pending store', () => {
  it('round-trips opaque member IDs through a SecureStore-valid key', async () => {
    const values = new Map<string, string>();
    const secureStore = {
      getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null),
      setItemAsync: vi.fn(async (key: string, value: string) => {
        expect(key).toMatch(/^[\w.-]+$/);
        values.set(key, value);
      }),
      deleteItemAsync: vi.fn(async (key: string) => { values.delete(key); }),
    };
    const store = createGamificationPendingStore(secureStore);
    const state = {
      ownerMemberId: 'admin:opaque:一',
      redemptions: [{ operationId: '11111111-1111-4111-8111-111111111111', memberId: 'member:1', rewardId: 'reward-1', expectedRewardRevision: 4 }],
      reversals: [],
    };

    await store.write(state.ownerMemberId, state);

    await expect(store.read(state.ownerMemberId)).resolves.toEqual(state);
    expect(secureStore.setItemAsync.mock.calls[0][0]).not.toContain('%');
  });

  it('fails closed on malformed or unavailable durable storage without mutating it', async () => {
    const malformed = {
      getItemAsync: vi.fn(async () => '{"redemptions":"broken"}'),
      setItemAsync: vi.fn(),
      deleteItemAsync: vi.fn(),
    };
    await expect(createGamificationPendingStore(malformed).read('admin:A')).rejects.toMatchObject({ code: 'PENDING_DATA_INVALID' });
    expect(malformed.setItemAsync).not.toHaveBeenCalled();
    expect(malformed.deleteItemAsync).not.toHaveBeenCalled();

    const unavailable = {
      getItemAsync: vi.fn(async () => { throw new Error('native unavailable'); }),
      setItemAsync: vi.fn(async () => { throw new Error('disk full'); }),
      deleteItemAsync: vi.fn(async () => { throw new Error('locked'); }),
    };
    const store = createGamificationPendingStore(unavailable);
    await expect(store.read('admin:A')).rejects.toMatchObject({ code: 'PENDING_STORAGE_ERROR' });
    await expect(store.write('admin:A', { ownerMemberId: 'admin:A', redemptions: [], reversals: [] })).rejects.toMatchObject({ code: 'PENDING_STORAGE_ERROR' });
    await expect(store.clear('admin:A')).rejects.toMatchObject({ code: 'PENDING_STORAGE_ERROR' });
  });
});

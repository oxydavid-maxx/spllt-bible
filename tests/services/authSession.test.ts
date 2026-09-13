import { describe, expect, it, vi } from 'vitest';
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
import { createAuthSessionStore } from '../../src/services/authSession';

describe('authenticated member session boundary', () => {
  it('uses the verified member id for local state and clears it on logout', () => {
    const store = createAuthSessionStore(null);
    expect(store.get()).toBeNull();

    store.set({ memberId: 'google:subject-1', sessionToken: 'signed-session' });
    expect(store.get()).toEqual({ memberId: 'google:subject-1', sessionToken: 'signed-session' });

    store.clear();
    expect(store.get()).toBeNull();
  });
});

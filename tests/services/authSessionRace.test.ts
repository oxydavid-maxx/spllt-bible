import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { clearAuthSession, getAuthSnapshot, hydrateAuthSnapshot, persistAuthSession } from '../../src/services/authSession';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('mounted auth generation boundary', () => {
  it('does not republish a delayed old hydration after logout', async () => {
    const token = deferred<string | null>();
    const member = deferred<string | null>();
    const secure = {
      getItemAsync: vi.fn((key: string) => key.endsWith('.token') ? token.promise : member.promise),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined),
    };
    const hydration = hydrateAuthSnapshot({ secureStore: secure });
    clearAuthSession();
    token.resolve('old-token');
    member.resolve('member:old');
    await hydration;
    expect(getAuthSnapshot()).toMatchObject({ status: 'signed-out', session: null, profile: null });
  });

  it('keeps the newer account after an old hydration resolves late', async () => {
    const token = deferred<string | null>();
    const member = deferred<string | null>();
    const secure = {
      getItemAsync: vi.fn((key: string) => key.endsWith('.token') ? token.promise : member.promise),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined),
    };
    const hydration = hydrateAuthSnapshot({ secureStore: secure });
    await persistAuthSession({ memberId: 'member:new', sessionToken: 'new-token' }, 3600);
    token.resolve('old-token');
    member.resolve('member:old');
    await hydration;
    expect(getAuthSnapshot()).toMatchObject({ status: 'signed-in', session: { memberId: 'member:new', sessionToken: 'new-token' } });
  });

  it('clears a persistence write that finishes after logout', async () => {
    const deleteMock = vi.mocked(SecureStore.deleteItemAsync);
    deleteMock.mockClear();
    const persisted = persistAuthSession({ memberId: 'member:old', sessionToken: 'old-token' }, 3600);
    clearAuthSession();
    await persisted;
    expect(getAuthSnapshot().status).toBe('signed-out');
    expect(deleteMock).toHaveBeenCalledWith('qingmu.session.token');
  });
});

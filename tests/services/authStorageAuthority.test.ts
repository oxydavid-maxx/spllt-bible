import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { clearAuthSession, hydrateAuthSnapshot, persistAuthSession } from '../../src/services/authSession';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
}

function installStore() {
  const values = new Map<string, string>();
  let delayedSet: { started: ReturnType<typeof deferred>; gate: ReturnType<typeof deferred> } | null = null;
  let delayedDelete: { started: ReturnType<typeof deferred>; gate: ReturnType<typeof deferred> } | null = null;
  vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => values.get(key) ?? null);
  vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
    values.set(key, value);
    if (delayedSet && value === 'synthetic-session-A') {
      delayedSet.started.resolve();
      await delayedSet.gate.promise;
    }
  });
  vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
    const control = delayedDelete;
    if (control) {
      control.started.resolve();
      await control.gate.promise;
    }
    values.delete(key);
  });
  return {
    values,
    getItemAsync: async (key: string) => await SecureStore.getItemAsync(key),
    setItemAsync: async (key: string, value: string) => { await SecureStore.setItemAsync(key, value); },
    deleteItemAsync: async (key: string) => { await SecureStore.deleteItemAsync(key); },
    setDelay: (control: typeof delayedSet) => { delayedSet = control; },
    setDeleteDelay: (control: typeof delayedDelete) => { delayedDelete = control; },
  };
}

function installBoundaryStore() {
  const values = new Map<string, string>();
  const firstWrite = { started: deferred(), gate: deferred(), used: false };
  const firstRead = { started: deferred(), gate: deferred(), used: false };
  vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
    const captured = values.get(key) ?? null;
    if (!firstRead.used) {
      firstRead.used = true;
      firstRead.started.resolve();
      await firstRead.gate.promise;
    }
    return captured;
  });
  vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
    if (!firstWrite.used) {
      firstWrite.used = true;
      firstWrite.started.resolve();
      await firstWrite.gate.promise;
    }
    values.set(key, value);
  });
  vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { values.delete(key); });
  return {
    values,
    getItemAsync: async (key: string) => await SecureStore.getItemAsync(key),
    setItemAsync: async (key: string, value: string) => { await SecureStore.setItemAsync(key, value); },
    deleteItemAsync: async (key: string) => { await SecureStore.deleteItemAsync(key); },
    firstWrite,
    firstRead,
  };
}

describe('auth storage authority', () => {
  afterEach(async () => { clearAuthSession(); for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve)); vi.clearAllMocks(); });

  it('does not let an old persist cleanup delete a newer durable session', async () => {
    const store = installStore();
    const delayed = { started: deferred(), gate: deferred() };
    store.setDelay(delayed);
    const oldPersist = persistAuthSession({ memberId: 'fixture:A', sessionToken: 'synthetic-session-A' });
    await delayed.started.promise;
    const newer = persistAuthSession({ memberId: 'fixture:B', sessionToken: 'synthetic-session-B' });
    await new Promise((resolve) => setImmediate(resolve));
    delayed.gate.resolve();
    await Promise.all([oldPersist, newer]);
    expect(store.values.get('qingmu.session.member')).toBe('fixture:B');
    expect(store.values.get('qingmu.session.member')).toBe('fixture:B');
  });

  it('does not let an old logout delete a newer durable session', async () => {
    const store = installStore();
    await persistAuthSession({ memberId: 'fixture:A', sessionToken: 'synthetic-session-A' });
    const delayed = { started: deferred(), gate: deferred() };
    store.setDeleteDelay(delayed);
    clearAuthSession();
    await delayed.started.promise;
    store.setDeleteDelay(null);
    const newer = persistAuthSession({ memberId: 'fixture:B', sessionToken: 'synthetic-session-B' });
    await new Promise((resolve) => setImmediate(resolve));
    delayed.gate.resolve();
    await newer;
    expect(store.values.get('qingmu.session.member')).toBe('fixture:B');
    await new Promise((resolve) => setImmediate(resolve));
    expect(store.values.get('qingmu.session.member')).toBe('fixture:B');
  });

  it('fences a delayed old persist when the member stays the same but the session changes', async () => {
    const store = installStore();
    const delayed = { started: deferred(), gate: deferred() };
    store.setDelay(delayed);
    const oldPersist = persistAuthSession({ memberId: 'fixture:same', sessionToken: 'synthetic-session-A' });
    await delayed.started.promise;
    const newer = persistAuthSession({ memberId: 'fixture:same', sessionToken: 'synthetic-session-B' });
    await new Promise((resolve) => setImmediate(resolve));
    delayed.gate.resolve();
    await Promise.all([oldPersist, newer]);
    expect(store.values.get('qingmu.session.member')).toBe('fixture:same');
    expect(store.values.get('qingmu.session.token')).toBe('synthetic-session-B');
  });

  it('does not write a stale profile after the auth epoch changes during loading', async () => {
    const store = installStore();
    store.values.set('qingmu.session.token', 'synthetic-session-A');
    store.values.set('qingmu.session.member', 'fixture:A');
    store.values.set('qingmu.session.expiresAt', String(Math.floor(Date.now() / 1000) + 3600));
    const profileStarted = deferred();
    const profileGate = deferred();
    const hydration = hydrateAuthSnapshot({
      secureStore: store,
      loadProfile: async () => { profileStarted.resolve(); return profileGate.promise as any; },
    });
    await profileStarted.promise;
    await persistAuthSession({ memberId: 'fixture:B', sessionToken: 'synthetic-session-B' });
    profileGate.resolve();
    await hydration;
    expect(store.values.get('qingmu.session.profile.v1')).toBeUndefined();
  });

  it('does not let a late old owner pointer commit select the old payload on cold restore', async () => {
    const store = installBoundaryStore();
    const oldPersist = persistAuthSession({ memberId: 'fixture:A', sessionToken: 'synthetic-session-A' });
    await store.firstWrite.started.promise;
    const newer = persistAuthSession({ memberId: 'fixture:B', sessionToken: 'synthetic-session-B' });
    await new Promise((resolve) => setImmediate(resolve));
    store.firstWrite.gate.resolve();
    await Promise.all([oldPersist, newer]);
    store.firstRead.used = true;
    const restored = await hydrateAuthSnapshot({ secureStore: store, loadProfile: async () => null });
    expect(restored.session).toMatchObject({ memberId: 'fixture:B', sessionToken: 'synthetic-session-B' });
  });

  it('does not let stale hydration owner assignment make logout target the old owner', async () => {
    const store = installBoundaryStore();
    store.firstWrite.used = true;
    await persistAuthSession({ memberId: 'fixture:A', sessionToken: 'synthetic-session-A' });
    const oldHydration = hydrateAuthSnapshot({ secureStore: store, loadProfile: async () => null });
    await store.firstRead.started.promise;
    await persistAuthSession({ memberId: 'fixture:B', sessionToken: 'synthetic-session-B' });
    store.firstRead.gate.resolve();
    await oldHydration;
    clearAuthSession();
    await new Promise((resolve) => setImmediate(resolve));
    const restored = await hydrateAuthSnapshot({ secureStore: store, loadProfile: async () => null });
    expect(restored.status).toBe('signed-out');
    expect(restored.session).toBeNull();
  });

  it('keeps generated auth owner sequences aligned with cold storage authority', async () => {
    const actions = fc.array(fc.constantFrom('A', 'B', 'LOGOUT' as const), { minLength: 1, maxLength: 8 });
    await fc.assert(fc.asyncProperty(actions, async (sequence) => {
      const store = installStore();
      clearAuthSession();
      await new Promise((resolve) => setImmediate(resolve));
      let expectedToken: string | null = null;
      for (const action of sequence) {
        if (action === 'LOGOUT') {
          clearAuthSession();
          await new Promise((resolve) => setImmediate(resolve));
          expectedToken = null;
        } else {
          expectedToken = `synthetic-session-${action}`;
          await persistAuthSession({ memberId: `fixture:${action}`, sessionToken: expectedToken });
        }
      }
      const restored = await hydrateAuthSnapshot({ secureStore: store, loadProfile: async () => null });
      expect(restored.session?.sessionToken ?? null).toBe(expectedToken);
      if (!expectedToken) expect(restored.status).toBe('signed-out');
    }), { numRuns: 20, seed: 260909 });
  });

  it('cold restores the owner written by the real module after the pointer boundary', async () => {
    const store = installStore();
    await persistAuthSession({ memberId: 'fixture:cold', sessionToken: 'synthetic-session-cold' });
    vi.resetModules();
    const fresh = await import('../../src/services/authSession');
    const restored = await fresh.hydrateAuthSnapshot({ secureStore: store });
    expect(restored.session).toMatchObject({ memberId: 'fixture:cold', sessionToken: 'synthetic-session-cold' });
  });
});

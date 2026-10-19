import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const local = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'false';
  return { storage: new Map<string, string>(), reads: null as Promise<void> | null };
});
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => { await local.reads; return local.storage.get(key) ?? null; },
  setItemAsync: async (key: string, value: string) => { local.storage.set(key, value); },
  deleteItemAsync: async (key: string) => { local.storage.delete(key); },
}));
vi.mock('react-native', () => ({ View: 'View', Image: 'Image' }));
vi.mock('../../src/ui/brandIcon', () => ({ BRAND_ICON: 1 }));
vi.mock('expo-router', () => {
  const Stack = ({ children }: any) => React.createElement('Stack', {}, children);
  Object.assign(Stack, {
    Protected: ({ guard, children }: any) => guard ? children : null,
    Screen: ({ name }: any) => React.createElement(name === 'sign-in' ? 'SignInScreen' : 'AppRoute', { name }),
  });
  return { Stack };
});
let tree: ReturnType<typeof create> | undefined;
beforeEach(() => { vi.resetModules(); local.storage.clear(); local.reads = null; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-19T00:00:00Z'); });
afterEach(() => { if (tree) act(() => tree!.unmount()); tree = undefined; vi.useRealTimers(); });
describe('cold startup uses only local session authority', () => {
  it.each([false, true])('saved local account=$s: boot screen goes directly to its destination without waiting for profile I/O', async saved => {
    let release!: () => void;
    local.reads = new Promise<void>(resolve => { release = resolve; });
    if (saved) {
      local.storage.set('qingmu.session.token', 'qmd_synthetic-session');
      local.storage.set('qingmu.session.member', 'synthetic-member');
      local.storage.set('qingmu.session.expiresAt', '');
    }
    const auth = await import('../../src/services/authSession');
    const { AppStack, canUseApp } = await import('../../src/ui/AppStack');
    const profile = vi.fn(() => new Promise<null>(() => {}));
    const observed: string[] = [];
    function Gate() {
      const { status } = auth.useAuthSnapshot(); observed.push(status);
      return React.createElement(AppStack, { signedIn: canUseApp(status), hydrating: status === 'hydrating' });
    }
    await act(async () => { tree = create(React.createElement(auth.AuthProvider, { loadProfile: profile, children: React.createElement(Gate) })); });
    expect(tree!.root.findAllByProps({ testID: 'auth-startup' })).toHaveLength(1);
    expect(tree!.root.findAllByType('SignInScreen' as never)).toHaveLength(0);
    expect(tree!.root.findAllByType('AppRoute' as never)).toHaveLength(0);
    await act(async () => { release(); });
    expect(tree!.root.findAllByProps({ testID: 'auth-startup' })).toHaveLength(0);
    expect(tree!.root.findAllByType('SignInScreen' as never)).toHaveLength(saved ? 0 : 1);
    expect(tree!.root.findAllByType('AppRoute' as never).length > 0).toBe(saved);
    expect(profile).toHaveBeenCalledTimes(saved ? 1 : 0);
    expect(observed).not.toContain(saved ? 'signed-out' : 'signed-in');
  });
});

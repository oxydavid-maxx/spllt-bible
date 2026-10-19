import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

const { primitive, cardProps, appleProps, storage } = vi.hoisted(() => ({
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
  storage: new Map<string, string>(),
  cardProps: [] as Array<Record<string, unknown>>,
  appleProps: [] as Array<Record<string, unknown>>,
}));
vi.mock('react-native', () => ({
  Image: primitive('Image'),
  ScrollView: primitive('ScrollView'),
  Text: primitive('Text'),
  View: primitive('View'),
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: primitive('SafeAreaView') }));
vi.mock('../../src/ui/brandIcon', () => ({ BRAND_ICON: 1 }));
vi.mock('../../src/ui/GoogleLoginCard', () => ({
  GoogleLoginCard: (props: Record<string, unknown>) => { cardProps.push(props); return React.createElement('GoogleLoginCard'); },
}));
// AppleLoginCard pulls in the secure-store session module; the screen test only needs to see that it is placed.
vi.mock('../../src/ui/AppleLoginCard', () => ({
  AppleLoginCard: (props: Record<string, unknown>) => { appleProps.push(props); return React.createElement('AppleLoginCard'); },
}));

vi.mock('expo-secure-store', () => ({ getItemAsync: async (key: string) => storage.get(key) ?? null, setItemAsync: async (key: string, value: string) => { storage.set(key, value); }, deleteItemAsync: async (key: string) => { storage.delete(key); } }));

import { act, create } from 'react-test-renderer';
import { SignInScreen } from '../../src/ui/SignInScreen';

describe('the first screen a new member sees', () => {
  it('says what signing in is for and offers Google and Apple sign-in', () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(React.createElement(SignInScreen, { baseUrl: 'https://api.example.test' })); });
    const text = JSON.stringify(tree.toJSON());
    for (const line of ['竹科聖經', '竹科靈糧堂的每日讀經', '跟著教會的進度讀經，讀完按完成', '經文和靈修都可以聽朗讀', '累積積分換獎品，和朋友互相加油', '第一次登入會自動建立帳號']) {
      expect(text).toContain(line);
    }
    expect(tree.root.findAll((node) => String(node.type) === 'GoogleLoginCard')).toHaveLength(1);
    expect(cardProps.at(-1)).toMatchObject({ baseUrl: 'https://api.example.test', variant: 'welcome' });
    // AppleLoginCard renders nothing outside iOS itself; the screen always places it after Google.
    expect(tree.root.findAll((node) => String(node.type) === 'AppleLoginCard')).toHaveLength(1);
    expect(appleProps.at(-1)).toMatchObject({ baseUrl: 'https://api.example.test' });
  });
});

const markerKey = 'qingmu.googleLogin.pending.v1';
beforeEach(() => { storage.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-19T00:00:00Z'); });
afterEach(() => { vi.useRealTimers(); });
describe('interrupted login after a cold start', () => {
  it.each([
    { age: 0, show: true }, { age: 599_999, show: true },
    { age: 600_000, show: false }, { age: 600_001, show: false },
    { age: -1, show: false },
  ])('consumes a marker aged $age ms; show=$show', async ({ age, show }) => {
    storage.set(markerKey, JSON.stringify({ id: 'terminated-attempt', startedAt: Date.now() - age }));
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(React.createElement(SignInScreen, { baseUrl: 'https://synthetic.invalid' })); });
    expect(JSON.stringify(tree.toJSON()).includes('剛才的登入沒有完成，請再按一次。')).toBe(show);
    expect(storage.has(markerKey)).toBe(false);
    act(() => tree.unmount());
  });
  it('clears malformed progress without showing a notice', async () => {
    storage.set(markerKey, 'broken-json');
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(React.createElement(SignInScreen, { baseUrl: 'https://synthetic.invalid' })); });
    expect(JSON.stringify(tree.toJSON())).not.toContain('剛才的登入沒有完成，請再按一次。');
    expect(storage.has(markerKey)).toBe(false);
    act(() => tree.unmount());
  });
  it('dismisses the startup notice when the next Google attempt starts', async () => {
    storage.set(markerKey, JSON.stringify({ id: 'terminated-attempt', startedAt: Date.now() - 1000 }));
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(React.createElement(SignInScreen, { baseUrl: 'https://synthetic.invalid' })); });
    expect(JSON.stringify(tree.toJSON())).toContain('剛才的登入沒有完成，請再按一次。');
    act(() => { (cardProps.at(-1)!.onSignInStart as () => void)(); });
    expect(JSON.stringify(tree.toJSON())).not.toContain('剛才的登入沒有完成，請再按一次。');
    act(() => tree.unmount());
  });
  it('does not repeat the notice on the next mount', async () => {
    storage.set(markerKey, JSON.stringify({ id: 'terminated-attempt', startedAt: Date.now() - 1000 }));
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(React.createElement(SignInScreen, { baseUrl: 'https://synthetic.invalid' })); });
    expect(JSON.stringify(tree.toJSON())).toContain('剛才的登入沒有完成，請再按一次。');
    act(() => tree.unmount());
    await act(async () => { tree = create(React.createElement(SignInScreen, { baseUrl: 'https://synthetic.invalid' })); });
    expect(JSON.stringify(tree.toJSON())).not.toContain('剛才的登入沒有完成，請再按一次。');
    act(() => tree.unmount());
  });
});

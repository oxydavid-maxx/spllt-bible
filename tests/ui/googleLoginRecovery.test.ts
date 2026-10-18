import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import Module from 'node:module';
import { act, create } from 'react-test-renderer';

const doubles = vi.hoisted(() => ({
  platform: { OS: 'android' },
  listeners: new Set<(state: string) => void>(),
  establishSession: vi.fn(), persist: vi.fn(), finish: vi.fn(), sequence: 0,
  primitive: (name: string) => (props: Record<string, unknown>) => require('react').createElement(name, props, props.children as never),
}));
vi.mock('react-native', () => ({
  Platform: doubles.platform, NativeModules: {},
  Pressable: doubles.primitive('Pressable'), Text: doubles.primitive('Text'),
  TextInput: doubles.primitive('TextInput'), View: doubles.primitive('View'),
  StyleSheet: { create: (value: unknown) => value },
  AppState: { currentState: 'active', addEventListener: (_: string, listener: (state: string) => void) => {
    doubles.listeners.add(listener);
    return { remove: () => doubles.listeners.delete(listener) };
  } },
}));
vi.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: vi.fn() }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: () => ({ establishSession: doubles.establishSession }) }));
vi.mock('../../src/services/authSession', () => ({
  beginAuthSessionAttempt: () => ({ epoch: 0, sequence: ++doubles.sequence }),
  finishAuthSessionAttempt: doubles.finish, configureAuthSessionTransport: vi.fn(),
  persistEstablishedAuthSession: doubles.persist,
}));
import { GoogleLoginCard } from '../../src/ui/GoogleLoginCard';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const success = (idToken = 'synthetic-token') => ({ type: 'success', data: { idToken } });
const session = { sessionToken: 'synthetic-session', memberId: 'synthetic-member', expiresInSeconds: null };
let tree: ReturnType<typeof create> | undefined;
let signIn: ReturnType<typeof vi.fn>;
const oldClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const oldFixture = process.env.EXPO_PUBLIC_QINGMU_FIXTURE;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime('2026-10-18T12:00:00Z');
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'synthetic-client';
  process.env.EXPO_PUBLIC_QINGMU_FIXTURE = 'false';
  doubles.sequence = 0; doubles.listeners.clear();
  doubles.establishSession.mockReset().mockResolvedValue(session);
  doubles.persist.mockReset().mockResolvedValue(true); doubles.finish.mockReset();
  signIn = vi.fn();
  const native = {
    GoogleOneTapSignIn: { configure: vi.fn(), checkPlayServices: vi.fn().mockResolvedValue(undefined), signIn,
      createAccount: vi.fn(), presentExplicitSignIn: vi.fn() },
    isSuccessResponse: (value: any) => value?.type === 'success',
    isNoSavedCredentialFoundResponse: () => false,
    isCancelledResponse: (value: any) => value?.type === 'cancelled',
  };
  const originalLoad = (Module as any)._load;
  vi.spyOn(Module as any, '_load').mockImplementation(function (this: unknown, ...args: unknown[]) {
    return args[0] === 'react-native-nitro-google-signin' ? native : originalLoad.apply(this, args);
  });
});
afterEach(() => {
  if (tree) act(() => tree!.unmount()); tree = undefined;
  vi.useRealTimers(); vi.restoreAllMocks();
  if (oldClientId === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  else process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = oldClientId;
  if (oldFixture === undefined) delete process.env.EXPO_PUBLIC_QINGMU_FIXTURE;
  else process.env.EXPO_PUBLIC_QINGMU_FIXTURE = oldFixture;
});
async function render(variant: 'welcome' | 'card' = 'welcome') {
  const onSignedIn = vi.fn();
  await act(async () => { tree = create(React.createElement(GoogleLoginCard, { baseUrl: 'https://synthetic.invalid', variant, onSignedIn })); });
  return onSignedIn;
}
const button = () => tree!.root.find(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '使用Google登入');
const text = () => JSON.stringify(tree!.toJSON());
async function press() { await act(async () => { button().props.onPress(); }); }
async function foreground() { await act(async () => {
  doubles.listeners.forEach(listener => listener('background'));
  doubles.listeners.forEach(listener => listener('active'));
}); }
const retryMessage = '登入沒有完成，請再按一次。';

describe.each(['android', 'ios'])('Google login native wait recovery on %s (real token adapter, fake native module)', platform => {
  beforeEach(() => { doubles.platform.OS = platform; });
  it.each(['welcome', 'card'] as const)('recovers a never-settling native promise after foreground: %s', async variant => {
    signIn.mockReturnValue(new Promise(() => {})); await render(variant); await press();
    expect(button().props.disabled).toBe(true); expect(text()).toContain('正在登入…');
    await foreground(); await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(button().props.disabled).toBe(false); expect(text()).toContain(retryMessage);
    expect(doubles.finish).not.toHaveBeenCalled();
    signIn.mockResolvedValue(success()); await press();
    expect(doubles.persist).toHaveBeenCalledTimes(1);
  });
  it('recovers within 60 seconds even without an AppState event', async () => {
    signIn.mockReturnValue(new Promise(() => {})); await render(); await press();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(button().props.disabled).toBe(false); expect(text()).toContain(retryMessage);
    expect(doubles.finish).not.toHaveBeenCalled();
  });
  it.each(['success', 'cancelled', 'rejected'] as const)('ignores the old native %s while a retry is pending and after it succeeds', async outcome => {
    const old = deferred<unknown>(), next = deferred<unknown>();
    signIn.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const onSignedIn = await render(); await press();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); await press();
    await act(async () => {
      if (outcome === 'rejected') old.reject(new Error('synthetic error'));
      else old.resolve(outcome === 'success' ? success('old') : { type: 'cancelled' });
    });
    expect(button().props.disabled).toBe(true); expect(text()).toContain('正在登入…');
    expect(doubles.establishSession).not.toHaveBeenCalled();
    await act(async () => { next.resolve(success('new')); });
    expect(doubles.establishSession).toHaveBeenCalledExactlyOnceWith('new', { persistentDevice: true, firebaseTestLab: undefined });
    expect(onSignedIn).toHaveBeenCalledExactlyOnceWith(session.sessionToken, session.memberId);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(text()).not.toContain(retryMessage);
  });
  it('does not show an error for a result arriving within 10 seconds after foreground', async () => {
    const pending = deferred<unknown>(); signIn.mockReturnValue(pending.promise);
    const onSignedIn = await render(); await press(); await foreground();
    await act(async () => { await vi.advanceTimersByTimeAsync(9999); });
    expect(button().props.disabled).toBe(true); expect(text()).not.toContain(retryMessage);
    await act(async () => { pending.resolve(success()); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(onSignedIn).toHaveBeenCalledOnce(); expect(text()).not.toContain(retryMessage);
  });
  it('ignores an old success that arrives after the retry has already signed in', async () => {
    const old = deferred<unknown>(); signIn.mockReturnValueOnce(old.promise).mockResolvedValueOnce(success('new'));
    const onSignedIn = await render('card'); await press(); await foreground();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); }); await press();
    await act(async () => { old.resolve(success('old')); });
    expect(doubles.establishSession).toHaveBeenCalledExactlyOnceWith('new', { persistentDevice: true, firebaseTestLab: undefined });
    expect(doubles.persist).toHaveBeenCalledOnce(); expect(onSignedIn).toHaveBeenCalledOnce();
    expect(text()).toContain('已登入，可以保存你的讀經進度。');
  });
  describe.each(['foreground', 'timeout'])('late native results after %s without a second press', recovery => {
    it.each([
      { response: success('late'), message: null },
      { response: { type: 'cancelled' }, message: '你取消了登入。' },
      { response: { type: 'error' }, message: '登入沒有完成，請稍後再試。' },
    ])('still handles $response.type normally', async ({ response, message }) => {
      const pending = deferred<unknown>(); signIn.mockReturnValue(pending.promise);
      const onSignedIn = await render('card'); await press();
      if (recovery === 'foreground') await foreground();
      await act(async () => { await vi.advanceTimersByTimeAsync(recovery === 'foreground' ? 10_000 : 60_000); });
      expect(button().props.disabled).toBe(false); expect(text()).toContain(retryMessage);
      expect(doubles.finish).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); pending.resolve(response); });
      if (message) {
        expect(text()).toContain(message); expect(button().props.disabled).toBe(false);
        expect(onSignedIn).not.toHaveBeenCalled(); expect(doubles.establishSession).not.toHaveBeenCalled();
      } else {
        expect(text()).toContain('已登入，可以保存你的讀經進度。'); expect(onSignedIn).toHaveBeenCalledOnce();
        expect(doubles.establishSession).toHaveBeenCalledExactlyOnceWith('late', { persistentDevice: true, firebaseTestLab: undefined });
      }
      expect(text()).not.toContain(retryMessage);
      expect(doubles.finish).toHaveBeenCalledWith({ epoch: 0, sequence: 1 });
    });
  });
  it('disables retry and clears the timeout message while a late success exchanges its session', async () => {
    const native = deferred<unknown>(), exchange = deferred<typeof session>();
    signIn.mockReturnValue(native.promise); doubles.establishSession.mockReturnValue(exchange.promise);
    const onSignedIn = await render(); await press();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(button().props.disabled).toBe(false);
    await act(async () => { native.resolve(success('late')); });
    expect(button().props.disabled).toBe(true); expect(text()).toContain('正在登入…');
    expect(text()).not.toContain(retryMessage);
    await act(async () => { exchange.resolve(session); }); expect(onSignedIn).toHaveBeenCalledOnce();
  });
  it.each([
    { response: success(), message: null },
    { response: { type: 'cancelled' }, message: '你取消了登入。' },
    { response: { type: 'error' }, message: '登入沒有完成，請稍後再試。' },
  ])('preserves the normal result: $response.type', async ({ response, message }) => {
    signIn.mockResolvedValue(response); const onSignedIn = await render(); await press();
    if (message) { expect(text()).toContain(message); expect(button().props.disabled).toBe(false); expect(onSignedIn).not.toHaveBeenCalled(); }
    else { expect(onSignedIn).toHaveBeenCalledOnce(); expect(button().props.disabled).toBe(true); }
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(text()).not.toContain(retryMessage);
  });
  it('does not interrupt a server exchange when foreground returns or the native deadline passes', async () => {
    const pending = deferred<typeof session>(); doubles.establishSession.mockReturnValue(pending.promise);
    signIn.mockResolvedValue(success()); const onSignedIn = await render(); await press(); await foreground();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(button().props.disabled).toBe(true); expect(text()).toContain('正在登入…');
    await act(async () => { pending.resolve(session); }); expect(onSignedIn).toHaveBeenCalledOnce();
  });
  it('removes the native wait, timer and subscription on unmount and ignores a late success', async () => {
    const pending = deferred<unknown>(); signIn.mockReturnValue(pending.promise);
    const onSignedIn = await render(); await press(); await foreground();
    act(() => tree!.unmount()); tree = undefined;
    await act(async () => { pending.resolve(success()); await vi.advanceTimersByTimeAsync(60_000); });
    expect(doubles.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    expect(doubles.establishSession).not.toHaveBeenCalled(); expect(onSignedIn).not.toHaveBeenCalled();
  });
});

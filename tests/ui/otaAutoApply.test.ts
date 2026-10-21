import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 光佑 (2026-10-21): 「不能 default 更新嗎？對老人家很不友善」. A downloaded OTA update used to wait for a
// full close and reopen, which older members almost never do. Now it is put in place when the app comes back
// after more than 30 minutes away, unless that would interrupt something: narration or playback running,
// a journal or other input not yet saved, or a panel open.
const state = vi.hoisted(() => ({
  status: 'signed-in', allowed: false, channel: 'production', hidden: false,
  check: vi.fn(), fetch: vi.fn(), reload: vi.fn(), override: vi.fn(), capabilities: vi.fn(),
  hiddenListeners: new Set<(hidden: boolean) => void>(),
}));
vi.hoisted(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Switch: 'Switch', StyleSheet: { create: (s: unknown) => s } }));
vi.mock('expo-router', () => ({ useFocusEffect: (fn: () => void) => require('react').useEffect(fn, [fn]) }));
vi.mock('../../src/services/appVisibility', () => ({
  subscribeAppActive: () => () => undefined,
  subscribeAppHidden: (fn: (hidden: boolean) => void) => { state.hiddenListeners.add(fn); return () => { state.hiddenListeners.delete(fn); }; },
  isAppHidden: () => state.hidden,
}));
vi.mock('expo-updates', () => ({
  isEnabled: true, get channel() { return state.channel; }, checkAutomatically: 'ON_ERROR_RECOVERY',
  UpdatesCheckAutomaticallyValue: { NEVER: 'NEVER', ON_ERROR_RECOVERY: 'ON_ERROR_RECOVERY' },
  checkForUpdateAsync: state.check, fetchUpdateAsync: state.fetch, reloadAsync: state.reload, setUpdateRequestHeadersOverride: state.override,
}));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => state.status === 'signed-in' ? { status: 'signed-in', session: { memberId: 'member', sessionToken: 'token' } } : { status: state.status, session: null } }));
vi.mock('../../src/services/gamificationApiClient', () => ({ createGamificationApiClient: () => ({ getCapabilities: state.capabilities }) }));

let ota: typeof import('../../src/ui/admin/OtaUpdates');
let guard: typeof import('../../src/services/autoUpdateGuard');
let tree: TestRenderer.ReactTestRenderer | null = null;
const MINUTE = 60_000;
const START = new Date('2026-10-21T08:00:00+08:00').getTime();

const mount = async () => { await act(async () => { tree = TestRenderer.create(React.createElement(ota.OtaUpdateCheck)); }); };
const settle = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); };
/** Leave the app, let `minutes` pass, come back. */
const away = async (minutes: number) => {
  state.hidden = true; await act(async () => { state.hiddenListeners.forEach((fn) => fn(true)); });
  vi.setSystemTime(Date.now() + minutes * MINUTE);
  state.hidden = false; await act(async () => { state.hiddenListeners.forEach((fn) => fn(false)); });
  await settle();
};

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(START);
  Object.assign(state, { status: 'signed-in', allowed: false, channel: 'production', hidden: false });
  state.hiddenListeners.clear();
  state.check.mockReset().mockResolvedValue({ isAvailable: true });
  state.fetch.mockReset().mockResolvedValue({ isNew: true });
  state.reload.mockReset().mockResolvedValue(undefined);
  state.override.mockReset();
  state.capabilities.mockReset().mockImplementation(async () => ({ canViewAllScores: state.allowed }));
  ota = await import('../../src/ui/admin/OtaUpdates');
  guard = await import('../../src/services/autoUpdateGuard');
});
afterEach(() => { act(() => tree?.unmount()); tree = null; vi.useRealTimers(); });

describe('a downloaded update is put in place on a quiet return', () => {
  it('reloads once into the downloaded update after more than 30 minutes away', async () => {
    await mount(); await settle();
    expect(state.fetch).toHaveBeenCalledOnce();
    expect(state.reload).not.toHaveBeenCalled();
    await away(31);
    expect(state.reload).toHaveBeenCalledOnce();
    expect(state.reload.mock.calls[0][0]).toMatchObject({ reloadScreenOptions: expect.any(Object) });
  });

  it('waits when the member was away for less than 30 minutes', async () => {
    await mount(); await settle();
    await away(29);
    expect(state.reload).not.toHaveBeenCalled();
    await away(29);
    expect(state.reload).not.toHaveBeenCalled();
  });

  it('never reloads before anything has been downloaded', async () => {
    state.check.mockResolvedValue({ isAvailable: false });
    await mount(); await settle();
    await away(45);
    expect(state.reload).not.toHaveBeenCalled();
  });

  it('absorbs a reload the platform refuses', async () => {
    state.reload.mockRejectedValue(new Error('cannot reload'));
    await mount(); await settle();
    await expect(away(31)).resolves.toBeUndefined();
    expect(state.reload).toHaveBeenCalledOnce();
  });
});

describe('it never interrupts', () => {
  it('waits while narration or other playback is running, and goes ahead on a later quiet return', async () => {
    let playing = true;
    guard.addAutoUpdateProbe('朗讀', () => playing);
    await mount(); await settle();
    await away(40);
    expect(state.reload).not.toHaveBeenCalled();
    playing = false;
    await away(31);
    expect(state.reload).toHaveBeenCalledOnce();
  });

  it('waits while a journal entry or other input is not saved yet', async () => {
    const release = guard.holdAutoUpdate('未存的輸入');
    await mount(); await settle();
    await away(60);
    expect(state.reload).not.toHaveBeenCalled();
    release();
    await away(31);
    expect(state.reload).toHaveBeenCalledOnce();
  });

  it('waits while a panel is open', async () => {
    const release = guard.holdAutoUpdate('面板');
    await mount(); await settle();
    await away(60);
    expect(state.reload).not.toHaveBeenCalled();
    release();
    expect(await guard.autoUpdateBlockers()).toEqual([]);
  });

  it('treats an asynchronous playback probe as busy while it says so', async () => {
    guard.addAutoUpdateProbe('朗讀', async () => true);
    await mount(); await settle();
    await away(31);
    expect(state.reload).not.toHaveBeenCalled();
  });

  it('does not reload when the member has left again while it was deciding', async () => {
    let resolveProbe!: (busy: boolean) => void;
    guard.addAutoUpdateProbe('朗讀', () => new Promise<boolean>((resolve) => { resolveProbe = resolve; }));
    await mount(); await settle();
    await away(31);
    state.hidden = true;
    await act(async () => { resolveProbe(false); });
    await settle();
    expect(state.reload).not.toHaveBeenCalled();
  });
});

describe('an app left open for days still finds new updates', () => {
  it('checks again after a long absence when nothing was waiting, and applies it on the next quiet return', async () => {
    state.check.mockResolvedValueOnce({ isAvailable: false });
    await mount(); await settle();
    expect(state.check).toHaveBeenCalledTimes(1);
    await away(31);
    expect(state.check).toHaveBeenCalledTimes(2);
    expect(state.reload).not.toHaveBeenCalled();
    await away(31);
    expect(state.reload).toHaveBeenCalledOnce();
  });

  it('does not check again after a short absence', async () => {
    state.check.mockResolvedValue({ isAvailable: false });
    await mount(); await settle();
    await away(10);
    expect(state.check).toHaveBeenCalledTimes(1);
  });

  it('leaves a preview phone alone until this launch has confirmed its administrator', async () => {
    state.channel = 'preview'; state.capabilities.mockRejectedValue(new Error('offline'));
    await mount(); await settle();
    await away(45);
    expect(state.check).not.toHaveBeenCalled();
    expect(state.reload).not.toHaveBeenCalled();
  });
});

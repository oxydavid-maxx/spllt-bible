import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ allowed: false, status: 'signed-in', memberId: 'member', token: 'token', enabled: true, checksEnabled: true, nativePolicy: 'ON_ERROR_RECOVERY', channel: 'production', check: vi.fn(), fetch: vi.fn(), override: vi.fn(), reload: vi.fn(), capabilities: vi.fn(), foreground: new Set<(revision?: number) => void>() }));
vi.hoisted(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Switch: 'Switch', StyleSheet: { create: (s: unknown) => s } }));
// The account page is a focused screen; useViewerCapabilities (#73) refetches on focus and on return to the foreground.
vi.mock('expo-router', () => ({ useFocusEffect: (fn: () => void) => require('react').useEffect(fn, [fn]) }));
vi.mock('../../src/services/appVisibility', () => ({ subscribeAppActive: (fn: (revision?: number) => void) => { state.foreground.add(fn); return () => state.foreground.delete(fn); }, subscribeAppHidden: () => () => undefined, isAppHidden: () => false }));
vi.mock('expo-constants', () => ({ default: { get expoConfig() { return { extra: { otaCheckEnabled: state.checksEnabled } }; } } }));
vi.mock('expo-updates', () => ({
  get isEnabled() { return state.enabled; }, get channel() { return state.channel; },
  get checkAutomatically() { return state.nativePolicy; }, UpdatesCheckAutomaticallyValue: { NEVER: 'NEVER', ON_ERROR_RECOVERY: 'ON_ERROR_RECOVERY' },
  checkForUpdateAsync: state.check, fetchUpdateAsync: state.fetch,
  setUpdateRequestHeadersOverride: state.override, reloadAsync: state.reload,
}));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => state.status === 'signed-in' ? { status: 'signed-in', session: { memberId: state.memberId, sessionToken: state.token } } : { status: state.status, session: null } }));
vi.mock('../../src/services/gamificationApiClient', () => ({ createGamificationApiClient: () => ({ getCapabilities: state.capabilities }) }));
let ota: typeof import('../../src/ui/admin/OtaUpdates');
let viewer: typeof import('../../src/services/viewerCapabilities');
const checkOtaUpdateInBackground = () => ota.checkOtaUpdateInBackground();

let tree: TestRenderer.ReactTestRenderer | null = null;
const render = async () => { await act(async () => { tree = TestRenderer.create(React.createElement(ota.AdminOtaUpdatesEntry)); }); };
const toggle = () => tree!.root.findByType('Switch' as never);
beforeEach(async () => {
  vi.resetModules();
  state.allowed = false; state.status = 'signed-in'; state.memberId = 'member'; state.token = 'token'; state.channel = 'production'; state.enabled = true; state.checksEnabled = true; state.nativePolicy = 'ON_ERROR_RECOVERY';
  state.check.mockReset().mockResolvedValue({ isAvailable: true }); state.fetch.mockReset().mockResolvedValue({ isNew: true });
  state.override.mockReset(); state.reload.mockReset();
  state.capabilities.mockReset().mockImplementation(async () => ({ canViewAllScores: state.allowed }));
  state.foreground.clear();
  ota = await import('../../src/ui/admin/OtaUpdates');
  viewer = await import('../../src/services/viewerCapabilities');
});
afterEach(() => { act(() => tree?.unmount()); tree = null; });

describe('background OTA checks', () => {
  it('downloads an available update without reloading the reader or audio', async () => {
    await checkOtaUpdateInBackground();
    expect(state.check).toHaveBeenCalledOnce(); expect(state.fetch).toHaveBeenCalledOnce(); expect(state.reload).not.toHaveBeenCalled();
  });
  it('absorbs offline/check/download failures without an error screen or rejected promise', async () => {
    state.check.mockRejectedValueOnce(new Error('offline'));
    await expect(checkOtaUpdateInBackground()).resolves.toBeUndefined();
    expect(state.fetch).not.toHaveBeenCalled();
    state.fetch.mockRejectedValueOnce(new Error('download interrupted'));
    await expect(checkOtaUpdateInBackground()).resolves.toBeUndefined();
    expect(state.reload).not.toHaveBeenCalled();
  });
  it('renders immediately even when the server never answers', async () => {
    state.check.mockReturnValue(new Promise(() => {}));
    await act(async () => { tree = TestRenderer.create(React.createElement(ota.OtaUpdateCheck)); });
    expect(tree!.toJSON()).toBeNull(); expect(state.check).toHaveBeenCalledOnce();
  });
  it('does not download when no update exists and does not call the network in isolated CI', async () => {
    state.check.mockResolvedValueOnce({ isAvailable: false });
    await checkOtaUpdateInBackground(); expect(state.fetch).not.toHaveBeenCalled();
    state.check.mockClear(); state.checksEnabled = false; state.nativePolicy = 'NEVER';
    await checkOtaUpdateInBackground(); expect(state.check).not.toHaveBeenCalled();
  });
  it('uses the installed native policy so CI update metadata cannot suppress a production installation', async () => {
    state.checksEnabled = false; state.nativePolicy = 'ON_ERROR_RECOVERY';
    await checkOtaUpdateInBackground();
    expect(state.check).toHaveBeenCalledOnce();
  });
  it('does not contact EAS when the installed native policy cannot be recognized', async () => {
    state.nativePolicy = 'unknown';
    await checkOtaUpdateInBackground();
    expect(state.check).not.toHaveBeenCalled();
  });
});

describe('administrator OTA channel switch', () => {
  it('is hidden for ordinary members and while capability lookup has not authorized the current session', async () => {
    await render(); expect(tree!.toJSON()).toBeNull();
    state.allowed = true; act(() => tree!.unmount()); await render(); expect(toggle()).toBeDefined();
    state.allowed = false; state.memberId = 'other';
    act(() => { tree!.update(React.createElement(ota.AdminOtaUpdatesEntry)); });
    expect(tree!.toJSON()).toBeNull();
  });
  it('uses only the official header method and never reloads on a switch', async () => {
    state.allowed = true; await render();
    expect(toggle().props.value).toBe(false);
    act(() => toggle().props.onValueChange(true));
    expect(state.override).toHaveBeenCalledWith({ 'expo-channel-name': 'preview' });
    expect(toggle().props.value).toBe(true);
    // Updates.channel is a startup snapshot. Leaving/re-entering the account must retain the new choice.
    act(() => tree!.unmount()); await render();
    expect(toggle().props.value).toBe(true);
    act(() => toggle().props.onValueChange(false));
    expect(state.override).toHaveBeenLastCalledWith({ 'expo-channel-name': 'production' });
    expect(state.reload).not.toHaveBeenCalled(); expect(state.check).not.toHaveBeenCalled();
  });
  it('reflects the persisted native channel at startup and keeps the switch value when the native call fails', async () => {
    state.allowed = true; state.channel = 'preview'; await render();
    expect(toggle().props.value).toBe(true);
    state.override.mockImplementation(() => { throw new Error('native failure'); });
    expect(() => act(() => toggle().props.onValueChange(false))).not.toThrow();
    expect(toggle().props.value).toBe(true);
  });
  it('turns a preview build back to production rather than clearing back to its preview default', async () => {
    state.allowed = true; state.channel = 'preview'; await render();
    act(() => toggle().props.onValueChange(false));
    expect(state.override).toHaveBeenCalledWith({ 'expo-channel-name': 'production' });
    expect(toggle().props.value).toBe(false);
  });
});

// The override is saved on the phone and outlives the session that set it. Only the administrator who
// set it can see the switch, so anyone else holding the phone is returned to production automatically.
describe('preview channel never outlives administrator access', () => {
  const both = () => React.createElement(React.Fragment, null, React.createElement(ota.OtaUpdateCheck), React.createElement(ota.AdminOtaUpdatesEntry));
  const renderRoot = async (element = React.createElement(ota.OtaUpdateCheck)) => { await act(async () => { tree = TestRenderer.create(element); }); };
  const rerender = async (element: React.ReactElement) => { await act(async () => { tree!.update(element); }); };
  const production = { 'expo-channel-name': 'production' };
  const overrideBeforeCheck = () => expect(state.override.mock.invocationCallOrder[0]).toBeLessThan(state.check.mock.invocationCallOrder[0]);

  it('returns a preview phone to production when nobody is signed in, before checking for updates', async () => {
    state.channel = 'preview'; state.status = 'signed-out';
    await renderRoot();
    expect(state.override).toHaveBeenCalledWith(production);
    expect(state.check).toHaveBeenCalledOnce(); overrideBeforeCheck();
    expect(state.capabilities).not.toHaveBeenCalled();
  });
  it('returns a preview phone to production when the signed-in member is not an administrator', async () => {
    state.channel = 'preview'; state.allowed = false;
    await renderRoot();
    expect(state.capabilities).toHaveBeenCalledOnce();
    expect(state.override).toHaveBeenCalledWith(production);
    expect(state.check).toHaveBeenCalledOnce(); overrideBeforeCheck();
  });
  it('keeps preview for a confirmed administrator, and only then checks the preview channel', async () => {
    state.channel = 'preview'; state.allowed = true;
    await renderRoot();
    expect(state.override).not.toHaveBeenCalled();
    expect(state.check).toHaveBeenCalledOnce();
  });
  it('waits while sign-in is restoring or expired, and never checks preview for an unconfirmed member', async () => {
    state.channel = 'preview';
    for (const status of ['hydrating', 'expired']) {
      state.status = status;
      await renderRoot();
      expect(state.override).not.toHaveBeenCalled(); expect(state.check).not.toHaveBeenCalled(); expect(state.capabilities).not.toHaveBeenCalled();
      act(() => tree!.unmount());
    }
    state.status = 'hydrating'; await renderRoot();
    state.status = 'signed-in'; state.allowed = true; await rerender(React.createElement(ota.OtaUpdateCheck));
    expect(state.check).toHaveBeenCalledOnce(); expect(state.override).not.toHaveBeenCalled();
  });
  it('keeps the selection but skips this launch\'s preview check when the role cannot be confirmed', async () => {
    state.channel = 'preview'; state.capabilities.mockRejectedValue(new Error('offline'));
    await renderRoot();
    expect(state.override).not.toHaveBeenCalled(); expect(state.check).not.toHaveBeenCalled();
  });
  it('adds no request on production phones: no capability lookup, the same single startup check', async () => {
    for (const status of ['signed-in', 'signed-out', 'hydrating']) {
      state.status = status; await renderRoot(); act(() => tree!.unmount());
    }
    expect(state.capabilities).not.toHaveBeenCalled(); expect(state.override).not.toHaveBeenCalled();
    expect(state.check).toHaveBeenCalledOnce();
  });
  it('an administrator who turned preview on and then signs out leaves the phone on production', async () => {
    state.allowed = true; await renderRoot(both());
    act(() => toggle().props.onValueChange(true));
    expect(state.override).toHaveBeenLastCalledWith({ 'expo-channel-name': 'preview' });
    state.status = 'signed-out'; await rerender(both());
    expect(state.override).toHaveBeenLastCalledWith(production);
  });
  it('a different member signing in on the phone is checked again and returned to production', async () => {
    state.allowed = true; await renderRoot(both());
    act(() => toggle().props.onValueChange(true));
    state.memberId = 'family-member'; state.token = 'other-token'; state.allowed = false; await rerender(both());
    expect(state.override).toHaveBeenLastCalledWith(production);
    expect(tree!.toJSON()).toBeNull();
  });
  it('the account page returns preview to production when the server says the role was removed', async () => {
    state.channel = 'preview'; state.allowed = false;
    await render();
    expect(tree!.toJSON()).toBeNull();
    expect(state.override).toHaveBeenCalledWith(production);
  });
  it('a refreshed session whose administrator role was removed is returned to production', async () => {
    state.allowed = true; await renderRoot(both());
    act(() => toggle().props.onValueChange(true));
    expect(toggle().props.value).toBe(true);
    // Same member, role removed on the server and noticed by the next lookup in this process.
    state.allowed = false; state.token = 'refreshed-token'; await rerender(both());
    expect(state.override).toHaveBeenLastCalledWith(production);
  });
});

// #73 moved the account page's administrator rows to one shared lookup that re-checks on focus and on return
// to the foreground; the OTA switch is one of those rows, and the startup guard joins the same request.
describe('the OTA switch shares the administrator rows\' capability lookup', () => {
  const Neighbour = () => (viewer.useViewerCapabilities()?.canViewAllScores ? React.createElement('Text', null, 'neighbour') : null);
  const foreground = async () => { await act(async () => { state.foreground.forEach((fn) => fn(1)); }); };
  it('asks the server once for the switch and a neighbouring administrator row', async () => {
    state.allowed = true;
    await act(async () => { tree = TestRenderer.create(React.createElement(React.Fragment, null, React.createElement(ota.AdminOtaUpdatesEntry), React.createElement(Neighbour))); });
    expect(state.capabilities).toHaveBeenCalledOnce();
    expect(toggle()).toBeDefined();
  });
  it('reappears with its neighbours when a failed lookup is retried on return to the foreground', async () => {
    state.allowed = true; state.capabilities.mockRejectedValueOnce(new Error('offline'));
    await render();
    expect(tree!.toJSON()).toBeNull();
    await foreground();
    expect(toggle()).toBeDefined();
  });
  it('hides itself and returns preview to production when the role is removed while the page is open', async () => {
    state.allowed = true; await render();
    act(() => toggle().props.onValueChange(true));
    state.allowed = false; await foreground();
    expect(tree!.toJSON()).toBeNull();
    expect(state.override).toHaveBeenLastCalledWith({ 'expo-channel-name': 'production' });
  });
  it('the startup guard and the account page share one in-flight lookup', async () => {
    state.channel = 'preview'; state.allowed = true;
    await act(async () => { tree = TestRenderer.create(React.createElement(React.Fragment, null, React.createElement(ota.OtaUpdateCheck), React.createElement(ota.AdminOtaUpdatesEntry))); });
    expect(state.capabilities).toHaveBeenCalledOnce();
    expect(state.check).toHaveBeenCalledOnce(); expect(state.override).not.toHaveBeenCalled();
  });
});

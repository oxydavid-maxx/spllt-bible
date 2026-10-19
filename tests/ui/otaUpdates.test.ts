import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ allowed: false, memberId: 'member', token: 'token', enabled: true, checksEnabled: true, nativePolicy: 'ON_ERROR_RECOVERY', channel: 'production', check: vi.fn(), fetch: vi.fn(), override: vi.fn(), reload: vi.fn() }));
vi.hoisted(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Switch: 'Switch', StyleSheet: { create: (s: unknown) => s } }));
vi.mock('expo-constants', () => ({ default: { get expoConfig() { return { extra: { otaCheckEnabled: state.checksEnabled } }; } } }));
vi.mock('expo-updates', () => ({
  get isEnabled() { return state.enabled; }, get channel() { return state.channel; },
  get checkAutomatically() { return state.nativePolicy; }, UpdatesCheckAutomaticallyValue: { NEVER: 'NEVER', ON_ERROR_RECOVERY: 'ON_ERROR_RECOVERY' },
  checkForUpdateAsync: state.check, fetchUpdateAsync: state.fetch,
  setUpdateRequestHeadersOverride: state.override, reloadAsync: state.reload,
}));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => ({ status: 'signed-in', session: { memberId: state.memberId, sessionToken: state.token } }) }));
vi.mock('../../src/services/gamificationApiClient', () => ({ createGamificationApiClient: () => ({ getCapabilities: async () => ({ canViewAllScores: state.allowed }) }) }));
let ota: typeof import('../../src/ui/admin/OtaUpdates');
const checkOtaUpdateInBackground = () => ota.checkOtaUpdateInBackground();

let tree: TestRenderer.ReactTestRenderer | null = null;
const render = async () => { await act(async () => { tree = TestRenderer.create(React.createElement(ota.AdminOtaUpdatesEntry)); }); };
const toggle = () => tree!.root.findByType('Switch' as never);
beforeEach(async () => {
  vi.resetModules();
  state.allowed = false; state.memberId = 'member'; state.token = 'token'; state.channel = 'production'; state.enabled = true; state.checksEnabled = true; state.nativePolicy = 'ON_ERROR_RECOVERY';
  state.check.mockReset().mockResolvedValue({ isAvailable: true }); state.fetch.mockReset().mockResolvedValue({ isNew: true });
  state.override.mockReset(); state.reload.mockReset();
  ota = await import('../../src/ui/admin/OtaUpdates');
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

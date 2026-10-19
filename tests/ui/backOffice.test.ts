import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 後台規則與文件 (維護者 2026-10-17, mock 9): administrators only, behind the device unlock.
const state = vi.hoisted(() => ({ canViewAllScores: false, unlock: true, push: vi.fn(), openBrowser: vi.fn(), foreground: new Set<() => void>(), capabilities: vi.fn() }));
vi.hoisted(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const primitive = vi.hoisted(() => (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children));
vi.mock('../../src/services/appVisibility', () => ({ subscribeAppActive: (fn: () => void) => { state.foreground.add(fn); return () => state.foreground.delete(fn); } }));
vi.mock('react-native', () => ({ Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'), StyleSheet: { create: (s: unknown) => s }, Text: primitive('Text'), View: primitive('View') }));
vi.mock('expo-router', () => ({ router: { push: state.push }, useFocusEffect: (fn: () => void) => require('react').useEffect(fn, [fn]) }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: state.openBrowser }));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => ({ status: 'signed-in', session: { memberId: 'admin', sessionToken: 'tok' } }) }));
vi.mock('../../src/services/gamificationApiClient', () => ({ createGamificationApiClient: () => ({ getCapabilities: state.capabilities }) }));
vi.mock('../../src/services/adminUnlockGuard', () => ({
  createNativeAdminAuthenticator: (prompt: string) => async () => { expect(prompt).toBe('解鎖後台規則與文件'); return state.unlock; },
  createAdminUnlockGuard: (options: { authenticate: () => Promise<boolean> }) => ({ unlock: options.authenticate, clear: () => undefined, state: 'locked' }),
}));
import { BACK_OFFICE_RULES, BackOfficeEntry, BackOfficePage } from '../../src/ui/admin/BackOffice';

let tree: TestRenderer.ReactTestRenderer | null = null;
const texts = () => tree!.root.findAll((node) => String(node.type) === 'Text').map((node) => node.children.join(''));
const byLabel = (label: string) => tree!.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];

beforeEach(() => {
  state.capabilities.mockReset().mockImplementation(async () => ({ canViewAllScores: state.canViewAllScores, canManageRewards: false, canRedeemRewards: false }));
  state.canViewAllScores = false; state.unlock = true; state.push.mockReset(); state.openBrowser.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ links: [{ name: '獎品與兌換試算表', url: 'https://docs.example/sheet' }] }), { status: 200 })));
});
afterEach(() => { act(() => tree?.unmount()); tree = null; vi.unstubAllGlobals(); });

describe('後台規則與文件', () => {
  it('shows the row on 我的帳戶 to an administrator only', async () => {
    await act(async () => { tree = TestRenderer.create(React.createElement(BackOfficeEntry)); });
    expect(tree!.toJSON()).toBeNull();
    act(() => tree!.unmount());
    state.canViewAllScores = true;
    await act(async () => { tree = TestRenderer.create(React.createElement(BackOfficeEntry)); });
    expect(texts()).toEqual(['後台規則與文件', '管理者 ›']);
    byLabel('後台規則與文件').props.onPress();
    expect(state.push).toHaveBeenCalledWith('/back-office');
  });

  it('lists every rule and the private links once the device is unlocked', async () => {
    await act(async () => { tree = TestRenderer.create(React.createElement(BackOfficePage)); });
    expect(texts()).toEqual(expect.arrayContaining([...BACK_OFFICE_RULES.flat(), '獎品與兌換試算表', '開啟 ›']));
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/admin\/documents$/), { headers: { authorization: 'Bearer tok' } });
    byLabel('開啟獎品與兌換試算表').props.onPress();
    expect(state.openBrowser).toHaveBeenCalledWith('https://docs.example/sheet');
  });

  it('shows nothing private without the unlock, and lets it be tried again', async () => {
    state.unlock = false;
    await act(async () => { tree = TestRenderer.create(React.createElement(BackOfficePage)); });
    expect(texts()).toEqual(['需要完成身分驗證才能查看後台規則與文件。', '再解鎖一次']);
    expect(fetch).not.toHaveBeenCalled();
    state.unlock = true;
    await act(async () => { byLabel('再解鎖一次').props.onPress(); });
    expect(texts()).toContain('獎品與兌換試算表');
  });
});


it('revalidates both account administrator entries once per foreground with no idle reads (8)', async () => {
  const { AdminAllScoresEntry } = await import('../../src/ui/AdminAllScoresEntry');
  vi.useFakeTimers();
  await act(async () => { tree = TestRenderer.create(React.createElement(React.Fragment, null, React.createElement(BackOfficeEntry), React.createElement(AdminAllScoresEntry))); });
  const initial = state.capabilities.mock.calls.length;
  state.canViewAllScores = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(86_400_000); });
  expect(state.capabilities).toHaveBeenCalledTimes(initial);
  await act(async () => { state.foreground.forEach(fn => fn()); });
  expect(texts()).toContain('後台規則與文件');
  expect(texts()).toContain('全體 (管理) ›');
  expect(state.capabilities).toHaveBeenCalledTimes(initial + 1);
  state.canViewAllScores = false;
  await act(async () => { state.foreground.forEach(fn => fn()); });
  expect(tree!.toJSON()).toBeNull();
  vi.useRealTimers();
});

it.each([500, 200])('offers retry after documents fail or return empty (%i), with no idle fetch (10)', async status => {
  vi.useFakeTimers();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ links: [] }), { status }));
  await act(async () => { tree = TestRenderer.create(React.createElement(BackOfficePage)); });
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(86_400_000); });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(byLabel('重試讀取文件連結')).toBeDefined();
  await act(async () => { byLabel('重試讀取文件連結').props.onPress(); });
  expect(texts()).toContain('獎品與兌換試算表'); expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => { state.foreground.forEach(fn => fn()); });
  expect(fetch).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});

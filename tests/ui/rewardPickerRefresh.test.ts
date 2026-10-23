import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: (props: any) => props.children, SafeAreaView: (props: any) => props.children }));

const { primitive, api, auth, ApiError, appListeners } = vi.hoisted(() => ({
  primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children),
  api: { getCapabilities: vi.fn(async () => ({ canViewAllScores: true, canManageRewards: true, canRedeemRewards: true })), getProfile: vi.fn(async (memberId: string, scope: string = 'me') => ({ memberId, displayName: memberId === 'self' ? '自己' : '好友', earnedTotal: 4, band: 2, months: [{ month: '2026-09', earnedPoints: 4 }], permissions: { canEditTarget: memberId === 'self', canRedeem: true }, ...(scope !== 'friends' ? { private: { redeemableBalance: 4, targetReward: null } } : {}) })), getPeople: vi.fn(async () => [{ memberId: 'friend', displayName: '好友', earnedTotal: 3 }]), getRewards: vi.fn(async () => [{ rewardId: 'reward-1', name: '飲料', costPoints: 2, active: true, revision: 1 }]), setRewardTarget: vi.fn(async () => undefined), getMyRedemptions: vi.fn(async () => []), removeFriend: vi.fn(async () => undefined) },
  auth: { status: 'signed-in', session: { memberId: 'self', sessionToken: 'token' }, profile: null, profileStatus: 'ready', epoch: 1 },
  ApiError: class extends Error { retryable = true; userMessage = 'error'; },
  appListeners: [] as Array<(state: string) => void>,
}));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));
// The progress tab's completion controller opens the local SQLite repository (expo-sqlite -> the expo
// runtime, which node cannot load); these tests never read it, the same stand-in as the reader tests.
// The completion card's controller is covered by its own tests; here it would add a second focus effect and
// AppState listener that this harness does not model. Same stand-in as progressFriendPush.test.ts.
vi.mock('../../src/services/useCompletionController', () => ({ useCompletionController: (options: { planId: string; taskDate: string }) => ({ record: { memberId: 'self', planId: options.planId, taskDate: options.taskDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' }, pending: false, syncError: false, retryable: false, complete: vi.fn(async () => undefined), requestUndo: vi.fn() }) }));
vi.mock('../../src/ui/CompletionAwardFeedback', () => ({ CompletionAwardFeedback: () => null }));
vi.mock('../../src/storage/mobileDatabase', () => ({ openQingmuRepository: vi.fn(), openQingmuReaderPositionStore: vi.fn(), openQingmuJournalStore: vi.fn() }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: () => ({ getReadingDays: async () => undefined }) }));
vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn((_event: string, listener: (state: string) => void) => { appListeners.push(listener); return { remove: vi.fn() }; }) }, Pressable: primitive('Pressable'), Text: primitive('Text'), TextInput: primitive('TextInput'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Circle: el('Circle'), Polyline: el('Polyline'), Path: el('Path'), Rect: el('Rect'), G: el('G'), Line: el('Line'), Text: el('SvgText') }; });
vi.mock('../../src/services/devotionClient', () => ({ createDevotionClient: () => ({ getDevotionDates: async () => [], setDevotion: async () => undefined, getGroupReading: async () => { throw new Error('not served'); }, getScoreHistory: async () => { throw new Error('not served'); }, getDevotional: async () => null }) }));
vi.mock('expo-router', () => ({ useFocusEffect: (callback: () => (() => void) | void) => { require('react').useEffect(callback, []); } }));
vi.mock('expo-local-authentication', () => ({ authenticateAsync: vi.fn(async () => ({ success: true })) }));
vi.mock('../../src/services/authSession', () => ({ getAuthSnapshot: () => auth, isCurrentAuthSession: () => true, registerAuthLifecycleListener: () => vi.fn(), useAuthSnapshot: () => auth }));
vi.mock('../../src/services/gamificationApiClient', () => ({ GamificationApiError: ApiError, createGamificationApiClient: () => api }));
vi.mock('../../src/ui/gamification/PeopleList', () => ({ PeopleList: (props: any) => React.createElement('PeopleList', props) }));
vi.mock('../../src/ui/gamification/ScoreProfile', () => ({ ScoreProfile: (props: any) => React.createElement('ScoreProfile', props) }));
vi.mock('../../src/ui/gamification/ActionSheet', () => ({ ActionSheet: (props: any) => props.visible ? React.createElement('ActionSheet', props, props.children) : null }));
vi.mock('../../src/ui/gamification/RedemptionList', () => ({ RedemptionList: (props: any) => React.createElement('RedemptionList', props) }));
vi.mock('../../src/ui/gamification/FriendQrPanel', () => ({ FriendQrPanel: (props: any) => React.createElement('FriendQrPanel', props) }));

import { consumeOpenAllScores } from '../../src/services/allScoresRequest';
import ProgressScreen from '../../app/(tabs)/progress';
import { viewCache } from '../../src/services/viewCache';
// The shared store outlives a screen; each test starts without another test's answers (2026-10-23).
beforeEach(() => { viewCache.clear(); });

// 全體 is asked for from 我的帳戶 and heard by every mounted 積分 screen, so each test unmounts its own.
const mountedScreens: TestRenderer.ReactTestRenderer[] = [];
const createScreen = TestRenderer.create;
beforeEach(() => { vi.spyOn(TestRenderer, 'create').mockImplementation(((...args: Parameters<typeof createScreen>) => { const tree = createScreen(...args); mountedScreens.push(tree); return tree; }) as typeof createScreen); });
afterEach(async () => { await act(async () => { for (const tree of mountedScreens.splice(0)) tree.unmount(); }); consumeOpenAllScores(); });


const rewardA = { rewardId: 'reward-a', name: '清單 A 飲料', costPoints: 2, active: true, revision: 1 };
const rewardB = { rewardId: 'reward-b', name: '清單 B 電影票', costPoints: 5, active: true, revision: 2 };
type Rewards = typeof rewardA[];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const openPicker = async (screen: TestRenderer.ReactTestRenderer) => {
  await act(async () => { screen.root.findByType('ScoreProfile' as any).props.onChooseReward(); });
};
const picker = (screen: TestRenderer.ReactTestRenderer) => screen.root.findByType('ActionSheet' as any);
const text = (screen: TestRenderer.ReactTestRenderer) => JSON.stringify(picker(screen).findAllByType('Text' as any).map(node => node.props.children));
async function screenWithRewards(initial: Rewards = [rewardA]) {
  api.getRewards.mockReset().mockResolvedValue(initial);
  let screen!: TestRenderer.ReactTestRenderer;
  await act(async () => { screen = TestRenderer.create(React.createElement(ProgressScreen)); });
  return screen;
}

describe('target reward picker refresh', () => {
  it('shows A on first open, then shows B when reopened without restarting the screen', async () => {
    const screen = await screenWithRewards();
    await openPicker(screen);
    expect(text(screen)).toContain(rewardA.name);
    await act(async () => { picker(screen).props.onClose(); });
    const refreshed = deferred<Rewards>();
    api.getRewards.mockImplementationOnce(() => refreshed.promise);
    await openPicker(screen);
    expect(text(screen)).toContain(rewardA.name);
    await act(async () => { refreshed.resolve([rewardB]); });
    expect(text(screen)).toContain(rewardB.name);
    expect(text(screen)).not.toContain(rewardA.name);
    // One page load and exactly one fresh read for each opening.
    // The shelf, the first opening, the reopening; the other side's list asked ahead (2026-10-23) is not counted.
    expect(api.getRewards.mock.calls.filter((call: unknown[]) => call[0] === undefined)).toHaveLength(3);
  });

  it.each(['NETWORK_ERROR', 'READ_TIMEOUT'])('keeps A visible without an error when refresh fails with %s', async code => {
    const screen = await screenWithRewards();
    await openPicker(screen);
    await act(async () => { picker(screen).props.onClose(); });
    api.getRewards.mockRejectedValueOnce(new ApiError(code));
    await openPicker(screen);
    expect(text(screen)).toContain(rewardA.name);
    expect(screen.root.findAll(node => node.props.accessibilityRole === 'alert')).toHaveLength(0);
  });

  it('immediately shows the already loaded shelf list while the first picker refresh is pending', async () => {
    const screen = await screenWithRewards();
    const refreshed = deferred<Rewards>();
    api.getRewards.mockImplementationOnce(() => refreshed.promise);
    await openPicker(screen);
    expect(text(screen)).toContain(rewardA.name);
    expect(text(screen)).not.toContain('的獎品還沒上架');
    await act(async () => { refreshed.resolve([rewardB]); });
    expect(text(screen)).toContain(rewardB.name);
  });

  // An empty side says the prizes are not up yet and where 同工 add them (維護者 2026-10-20).
  it('replaces an initially empty list with new rewards on the next opening', async () => {
    const screen = await screenWithRewards([]);
    await openPicker(screen);
    expect(text(screen)).toContain('的獎品還沒上架');
    await act(async () => { picker(screen).props.onClose(); });
    api.getRewards.mockResolvedValueOnce([rewardB]);
    await openPicker(screen);
    expect(text(screen)).toContain(rewardB.name);
    expect(text(screen)).not.toContain('的獎品還沒上架');
  });

  it('does not reopen a dismissed picker or let its late response overwrite a newer opening', async () => {
    const screen = await screenWithRewards();
    const old = deferred<Rewards>();
    api.getRewards.mockImplementationOnce(() => old.promise);
    await openPicker(screen);
    await act(async () => { picker(screen).props.onClose(); });
    api.getRewards.mockResolvedValueOnce([rewardB]);
    await openPicker(screen);
    await act(async () => { old.resolve([rewardA]); });
    expect(text(screen)).toContain(rewardB.name);
    await act(async () => { picker(screen).props.onClose(); });
    expect(screen.root.findAllByType('ActionSheet' as any)).toHaveLength(0);
  });

  it('starts a new HTTP read on reopening even while the earlier read is still pending', async () => {
    const screen = await screenWithRewards();
    const { createGamificationApiClient } = await vi.importActual<typeof import('../../src/services/gamificationApiClient')>('../../src/services/gamificationApiClient');
    const old = deferred<Response>();
    const fetchImpl = vi.fn(async (..._args: any[]): Promise<Response> => old.promise).mockImplementationOnce(() => old.promise).mockResolvedValueOnce(new Response(JSON.stringify({ rewards: [rewardB] }), { status: 200 }));
    const client = createGamificationApiClient({ baseUrl: 'https://example.test', token: 'fixture-token', memberId: 'self', fetchImpl });
    const cancelReads = vi.fn(client.cancelReads);
    Object.assign(api, { cancelReads });
    api.getRewards.mockImplementation(() => client.getRewards());
    try {
      await openPicker(screen);
      expect(text(screen)).toContain(rewardA.name);
      await act(async () => { picker(screen).props.onClose(); });
      await openPicker(screen);
      expect(text(screen)).toContain(rewardB.name);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(['https://example.test/api/rewards', 'https://example.test/api/rewards']);
      expect(fetchImpl.mock.calls[1][1]?.headers).toMatchObject({ authorization: 'Bearer fixture-token' });
    } finally {
      await act(async () => { old.resolve(new Response(JSON.stringify({ rewards: [rewardA] }), { status: 200 })); });
      delete (api as typeof api & { cancelReads?: unknown }).cancelReads;
    }
  });
});

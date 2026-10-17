import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: (props: any) => props.children, SafeAreaView: (props: any) => props.children }));

const { primitive, api, auth, appListeners, focusCallbacks, focusCleanupRef, authListeners } = vi.hoisted(() => ({
  primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children),
  api: {
    getCapabilities: vi.fn(async () => ({ canViewAllScores: true, canManageRewards: false, canRedeemRewards: false })),
    getProfile: vi.fn(), getPeople: vi.fn(async () => []), getMyRedemptions: vi.fn(), getAdminRedemptions: vi.fn(),
    getRewards: vi.fn(async () => [{ rewardId: 'goal', name: '電影票', costPoints: 10, active: true, revision: 1 }]),
    getPendingOperations: vi.fn(async () => ({ ownerMemberId: 'self', redemptions: [], reversals: [] })),
  },
  auth: { status: 'signed-in' as 'signed-in' | 'signed-out', session: { memberId: 'self', sessionToken: 'token' } as { memberId: string; sessionToken: string } | null, profile: null, profileStatus: 'ready', epoch: 1 },
  appListeners: [] as Array<(state: string) => void>, focusCallbacks: [] as Array<() => (() => void) | void>, focusCleanupRef: { current: null as (() => void) | null },
  authListeners: [] as Array<(change: { current: { memberId: string; sessionToken: string } | null }) => void>,
}));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));
// The progress tab's completion controller opens the local SQLite repository (expo-sqlite -> the expo
// runtime, which node cannot load); these tests never read it, the same stand-in as the reader tests.
// The completion card's controller is covered by its own tests; here it would add a second focus effect and
// AppState listener that this harness does not model. Same stand-in as progressFriendPush.test.ts.
vi.mock('../../src/services/useCompletionController', () => ({ useCompletionController: (options: { planId: string; taskDate: string }) => ({ record: { memberId: 'self', planId: options.planId, taskDate: options.taskDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' }, pending: false, syncError: false, retryable: false, complete: vi.fn(async () => undefined), requestUndo: vi.fn() }) }));
vi.mock('../../src/ui/CompletionAwardFeedback', () => ({ CompletionAwardFeedback: () => null }));
vi.mock('../../src/storage/mobileDatabase', () => ({ openQingmuRepository: vi.fn(), openQingmuReaderPositionStore: vi.fn(), openQingmuJournalStore: vi.fn() }));
vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn((_event: string, listener: (state: string) => void) => { appListeners.push(listener); return { remove: vi.fn() }; }) }, Pressable: primitive('Pressable'), Text: primitive('Text'), TextInput: primitive('TextInput'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Circle: el('Circle'), Polyline: el('Polyline'), Path: el('Path'), Rect: el('Rect'), G: el('G'), Line: el('Line'), Text: el('SvgText') }; });
const { devotionApi, groupView } = vi.hoisted(() => {
  const groupView = (monthReads: number) => ({ month: '2026-10', today: '2026-10-14', todayReaders: null, yesterdayReaders: null, days: [], monthReads, busiest: null, qualifyingDays: 15, prizes: [], myDaysThisMonth: 0 });
  return { groupView, devotionApi: { getGroupReading: vi.fn(async () => groupView(3)), getDevotionDates: vi.fn(async () => []), setDevotion: vi.fn(async () => undefined), getScoreHistory: vi.fn(async () => { throw new Error('not served'); }), getDevotional: vi.fn(async () => null) } };
});
vi.mock('../../src/services/devotionClient', () => ({ createDevotionClient: () => devotionApi }));
vi.mock('expo-router', () => ({ useFocusEffect: (callback: () => (() => void) | void) => {
  focusCallbacks.push(callback);
  require('react').useEffect(() => {
    const cleanup = callback();
    focusCleanupRef.current = typeof cleanup === 'function' ? cleanup : null;
    return () => {
      if (typeof cleanup === 'function') {
        if (focusCleanupRef.current === cleanup) focusCleanupRef.current = null;
        cleanup();
      }
    };
  }, []);
} }));
vi.mock('expo-local-authentication', () => ({ authenticateAsync: vi.fn(async () => ({ success: true })) }));
vi.mock('../../src/services/authSession', () => ({
  getAuthSnapshot: () => auth,
  isCurrentAuthSession: (session: { memberId: string; sessionToken: string }) => auth.status === 'signed-in' && auth.session?.memberId === session.memberId && auth.session?.sessionToken === session.sessionToken,
  registerAuthLifecycleListener: (listener: (change: { current: { memberId: string; sessionToken: string } | null }) => void) => {
    authListeners.push(listener);
    return () => { const index = authListeners.indexOf(listener); if (index >= 0) authListeners.splice(index, 1); };
  },
  useAuthSnapshot: () => auth,
}));
vi.mock('../../src/services/gamificationApiClient', () => ({ GamificationApiError: class extends Error { userMessage = 'error'; }, createGamificationApiClient: () => api }));
vi.mock('../../src/ui/gamification/PeopleList', () => ({ PeopleList: (props: any) => React.createElement('PeopleList', props) }));
// The real ScoreProfile renders its slots, including `lead`.
vi.mock('../../src/ui/gamification/ScoreProfile', () => ({ ScoreProfile: (props: any) => React.createElement('ScoreProfile', props, props.lead) }));
vi.mock('../../src/ui/gamification/ActionSheet', () => ({ ActionSheet: (props: any) => props.visible ? React.createElement('ActionSheet', props, props.children) : null }));
vi.mock('../../src/ui/gamification/FriendQrPanel', () => ({ FriendQrPanel: (props: any) => React.createElement('FriendQrPanel', props) }));
vi.mock('../../src/ui/gamification/RewardControls', () => ({ RewardControls: (props: any) => React.createElement('RewardControls', props) }));

import { consumeOpenAllScores, requestOpenAllScores } from '../../src/services/allScoresRequest';
import ProgressScreen from '../../app/(tabs)/progress';
import { GroupReadingCard } from '../../src/ui/gamification/GroupReadingCard';

// 全體 is asked for from 我的帳戶 and heard by every mounted 積分 screen, so each test unmounts its own.
const mountedScreens: TestRenderer.ReactTestRenderer[] = [];
const createScreen = TestRenderer.create;
beforeEach(() => { vi.spyOn(TestRenderer, 'create').mockImplementation(((...args: Parameters<typeof createScreen>) => { const tree = createScreen(...args); mountedScreens.push(tree); return tree; }) as typeof createScreen); });
afterEach(async () => { await act(async () => { for (const tree of mountedScreens.splice(0)) tree.unmount(); }); consumeOpenAllScores(); });

describe('progress protected response lifecycle', () => {
  // The screen prefetches the other chart ranges on a timer after its first profile load. These tests
  // count profile reads and never reach that timer on a normal run; faking timers keeps it from
  // firing mid-test on a slow machine (it did under load) instead of relying on the test being quick.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
  afterEach(() => { vi.useRealTimers(); });
  it('does not apply a deferred private profile response after app background clears unlock scope', async () => {
    let resolveProfile!: (value: any) => void;
    api.getProfile.mockImplementationOnce(() => new Promise((resolve) => { resolveProfile = resolve; }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    await act(async () => { appListeners[0]?.('background'); });
    await act(async () => { resolveProfile({ memberId: 'self', displayName: '私人', earnedTotal: 99, band: 1, months: [{ month: '2026-09', earnedPoints: 99 }], private: { redeemableBalance: 99, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } }); });
    expect(renderer.root.findAll((node) => String(node.type) === 'ScoreProfile')).toHaveLength(0);
  });

  it('does not reopen a redemption sheet when its deferred response resolves after background', async () => {
    api.getProfile.mockResolvedValue({ memberId: 'self', displayName: '自己', earnedTotal: 1, band: null, months: [], private: { redeemableBalance: 1, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } });
    let resolveRedemptions!: (value: unknown[]) => void;
    api.getMyRedemptions.mockImplementationOnce(() => new Promise((resolve) => { resolveRedemptions = resolve; }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '開啟積分操作')[0].props.onPress(); });
    const actionSheet = renderer.root.findByType('ActionSheet' as any);
    const recordsAction = actionSheet.props.actions.find((action: any) => action.label === '我的領取紀錄');
    await act(async () => { void recordsAction.onPress(); });
    await act(async () => { [...appListeners].forEach((listener) => listener('background')); });
    await act(async () => { resolveRedemptions([]); });
    expect(renderer.root.findAll((node) => String(node.type) === 'ActionSheet' && node.props.title === '領取紀錄')).toHaveLength(0);
  });

  it('refreshes the signed-in member profile when returning from background', async () => {
    api.getProfile.mockResolvedValue({ memberId: 'self', displayName: '自己', earnedTotal: 1, band: null, months: [], private: { redeemableBalance: 1, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    const initialCalls = api.getProfile.mock.calls.length;
    await act(async () => { [...appListeners].forEach((listener) => listener('background')); [...appListeners].forEach((listener) => listener('active')); });
    await act(async () => { await Promise.resolve(); });
    expect(api.getProfile.mock.calls.length).toBeGreaterThan(initialCalls);
    // The refresh is the plain 3-argument call; range prefetches (4 arguments) may follow it.
    expect(api.getProfile.mock.calls.slice(initialCalls).some((call) => call.length === 3 && call[0] === 'self' && call[1] === 'me' && /^\d{4}-\d{2}$/.test(String(call[2])))).toBe(true);
    expect(renderer.root.findAll((node) => String(node.type) === 'ScoreProfile')).toHaveLength(1);
  });

  it('refreshes the signed-in member profile after blur clears and focus restores the route', async () => {
    api.getProfile.mockResolvedValue({ memberId: 'self', displayName: '自己', earnedTotal: 1, band: null, months: [], private: { redeemableBalance: 1, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    const callback = focusCallbacks[focusCallbacks.length - 1]; const initialCalls = api.getProfile.mock.calls.length;
    await act(async () => { const cleanup = callback?.(); cleanup?.(); callback?.(); await Promise.resolve(); });
    expect(api.getProfile.mock.calls.length).toBeGreaterThan(initialCalls);
    expect(renderer.root.findAll((node) => String(node.type) === 'ScoreProfile')).toHaveLength(1);
  });

  it('does not enter the admin scope when pending recovery finishes after background', async () => {
    api.getProfile.mockResolvedValue({ memberId: 'self', displayName: '自己', earnedTotal: 1, band: null, months: [], private: { redeemableBalance: 1, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } });
    let resolvePending!: (value: any) => void;
    api.getPendingOperations.mockImplementationOnce(() => new Promise((resolve) => { resolvePending = resolve; }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    await act(async () => { requestOpenAllScores(); await Promise.resolve(); });
    await act(async () => { [...appListeners].forEach((listener) => listener('background')); resolvePending({ ownerMemberId: 'self', redemptions: [], reversals: [] }); });
    expect(api.getPeople).not.toHaveBeenCalledWith('all');
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === '全體 (管理)' && node.props.accessibilityState?.selected)).toHaveLength(0);
  });

  it('keeps the same-account profile and secondary blocks stable until refresh fails', async () => {
    const profile = { memberId: 'self', displayName: '自己', earnedTotal: 1, band: null, months: [], private: { redeemableBalance: 1, targetReward: { rewardId: 'goal', name: '電影票', costPoints: 10, active: true, revision: 1 } }, permissions: { canEditTarget: true, canRedeem: false } };
    let resolveRefresh!: (value: unknown) => void; let resolveForeground!: (value: unknown) => void; let rejectRefresh!: (reason: unknown) => void;
    let resolveRewards!: (value: any) => void; let resolveGroup!: (value: any) => void;
    let rejectRewards!: (reason: unknown) => void; let rejectGroup!: (reason: unknown) => void;
    api.getProfile.mockReset().mockResolvedValueOnce(profile).mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; })).mockImplementationOnce(() => new Promise((resolve) => { resolveForeground = resolve; })).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRefresh = reject; }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); await Promise.resolve(); await Promise.resolve(); });
    const expectSecondary = (rewardName: string, groupReads: number) => {
      const score = renderer.root.findByType('ScoreProfile' as any);
      expect(score.props.rewards.map((reward: any) => reward.name)).toContain(rewardName);
      expect(renderer.root.findByType(GroupReadingCard).props.view.monthReads).toBe(groupReads);
    };
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile).toMatchObject({ memberId: 'self', earnedTotal: 1 });
    expectSecondary('電影票', 3);
    const initialCalls = { rewards: api.getRewards.mock.calls.length, group: devotionApi.getGroupReading.mock.calls.length };
    api.getRewards.mockImplementationOnce(() => new Promise((resolve) => { resolveRewards = resolve; }));
    devotionApi.getGroupReading.mockImplementationOnce(() => new Promise((resolve) => { resolveGroup = resolve; }));

    await act(async () => {
      focusCleanupRef.current?.(); focusCleanupRef.current = null;
      const cleanup = focusCallbacks.at(-1)?.();
      focusCleanupRef.current = typeof cleanup === 'function' ? cleanup : null;
      await Promise.resolve();
    });
    expect(api.getProfile).toHaveBeenCalledTimes(2);
    expect(api.getRewards).toHaveBeenCalledTimes(initialCalls.rewards + 1);
    expect(devotionApi.getGroupReading).toHaveBeenCalledTimes(initialCalls.group + 1);
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile).toMatchObject({ memberId: 'self', earnedTotal: 1 });
    expectSecondary('電影票', 3);
    expect(renderer.root.findAll((node) => String(node.type) === 'Text' && node.props.children === '載入中…')).toHaveLength(0);
    expect(renderer.root.findAll((node) => String(node.type) === 'Text' && node.props.children === '目前顯示上次的積分，還沒連上更新')).toHaveLength(0);

    await act(async () => {
      resolveRewards([{ rewardId: 'new-goal', name: '新獎品', costPoints: 12, active: true, revision: 1 }]);
      resolveGroup(groupView(5));
      await Promise.resolve();
    });
    expectSecondary('新獎品', 5);
    await act(async () => { resolveRefresh({ ...profile, earnedTotal: 2, private: { redeemableBalance: 2, targetReward: profile.private.targetReward } }); });
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile.earnedTotal).toBe(2);
    expectSecondary('新獎品', 5);
    expect(renderer.root.findAll((node) => String(node.type) === 'Text' && node.props.children === '目前顯示上次的積分，還沒連上更新')).toHaveLength(0);

    const refreshedCalls = { rewards: api.getRewards.mock.calls.length, group: devotionApi.getGroupReading.mock.calls.length };
    api.getRewards.mockImplementationOnce(() => new Promise((resolve) => { resolveRewards = resolve; }));
    devotionApi.getGroupReading.mockImplementationOnce(() => new Promise((resolve) => { resolveGroup = resolve; }));
    await act(async () => { appListeners.at(-1)?.('background'); await Promise.resolve(); });
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile.earnedTotal).toBe(2);
    expectSecondary('新獎品', 5);
    expect(renderer.root.findByProps({ testID: 'progress-inactive-cover' })).toBeDefined();
    await act(async () => { appListeners.at(-1)?.('active'); await Promise.resolve(); });
    expect(api.getProfile).toHaveBeenCalledTimes(3);
    expect(api.getRewards).toHaveBeenCalledTimes(refreshedCalls.rewards + 1);
    expect(devotionApi.getGroupReading).toHaveBeenCalledTimes(refreshedCalls.group + 1);
    expectSecondary('新獎品', 5);
    expect(renderer.root.findAll((node) => String(node.type) === 'Text' && node.props.children === '目前顯示上次的積分，還沒連上更新')).toHaveLength(0);
    await act(async () => {
      resolveRewards([{ rewardId: 'foreground-goal', name: '前景獎品', costPoints: 15, active: true, revision: 1 }]);
      resolveGroup(groupView(8));
      resolveForeground({ ...profile, earnedTotal: 3, private: { redeemableBalance: 3, targetReward: profile.private.targetReward } });
      await Promise.resolve();
    });
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile.earnedTotal).toBe(3);
    expectSecondary('前景獎品', 8);

    const foregroundCalls = { rewards: api.getRewards.mock.calls.length, group: devotionApi.getGroupReading.mock.calls.length };
    api.getRewards.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRewards = reject; }));
    devotionApi.getGroupReading.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectGroup = reject; }));
    await act(async () => { focusCallbacks.at(-1)?.(); await Promise.resolve(); });
    expect(api.getProfile).toHaveBeenCalledTimes(4);
    expect(api.getRewards).toHaveBeenCalledTimes(foregroundCalls.rewards + 1);
    expect(devotionApi.getGroupReading).toHaveBeenCalledTimes(foregroundCalls.group + 1);
    expectSecondary('前景獎品', 8);
    expect(renderer.root.findAll((node) => String(node.type) === 'Text' && node.props.children === '目前顯示上次的積分，還沒連上更新')).toHaveLength(0);
    await act(async () => { rejectRewards(new Error('offline')); rejectGroup(new Error('offline')); rejectRefresh(new Error('offline')); await Promise.resolve(); });
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile.earnedTotal).toBe(3);
    expectSecondary('前景獎品', 8);
    expect(renderer.root.findAll((node) => String(node.type) === 'Text' && node.props.children === '目前顯示上次的積分，還沒連上更新')).toHaveLength(1);
  });

  it('clears member A on account change and never applies A response after member B signs in', async () => {
    auth.status = 'signed-in'; auth.session = { memberId: 'member-a', sessionToken: 'token-a' };
    let resolveRefreshA!: (value: unknown) => void;
    let resolveRewardsA!: (value: any) => void; let resolveGroupA!: (value: any) => void;
    const profileA = { memberId: 'member-a', displayName: 'A私人資料', earnedTotal: 1, band: null, months: [], private: { redeemableBalance: 1, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } };
    const profileB = { memberId: 'member-b', displayName: 'B私人資料', earnedTotal: 2, band: null, months: [], private: { redeemableBalance: 2, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } };
    api.getProfile.mockReset().mockResolvedValueOnce(profileA).mockImplementationOnce(() => new Promise((resolve) => { resolveRefreshA = resolve; })).mockResolvedValueOnce(profileB);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); await Promise.resolve(); await Promise.resolve(); });
    expect(api.getProfile).toHaveBeenCalledWith('member-a', 'me', expect.any(String));
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile).toMatchObject({ memberId: 'member-a', earnedTotal: 1 });
    const initialSecondaryCalls = { rewards: api.getRewards.mock.calls.length, group: devotionApi.getGroupReading.mock.calls.length };
    api.getRewards.mockImplementationOnce(() => new Promise((resolve) => { resolveRewardsA = resolve; }));
    devotionApi.getGroupReading.mockImplementationOnce(() => new Promise((resolve) => { resolveGroupA = resolve; }));
    await act(async () => {
      focusCleanupRef.current?.(); focusCleanupRef.current = null;
      const cleanup = focusCallbacks.at(-1)?.();
      focusCleanupRef.current = typeof cleanup === 'function' ? cleanup : null;
      await Promise.resolve();
    });
    expect(api.getProfile).toHaveBeenCalledTimes(2);
    expect(api.getRewards).toHaveBeenCalledTimes(initialSecondaryCalls.rewards + 1);
    expect(devotionApi.getGroupReading).toHaveBeenCalledTimes(initialSecondaryCalls.group + 1);

    auth.status = 'signed-out'; auth.session = null;
    await act(async () => { authListeners.at(-1)?.({ current: null }); });
    expect(renderer.root.findAll((node) => String(node.type) === 'ScoreProfile')).toHaveLength(0);
    await act(async () => { renderer.update(React.createElement(ProgressScreen)); });

    auth.status = 'signed-in'; auth.session = { memberId: 'member-b', sessionToken: 'token-b' };
    const rewardB = { rewardId: 'b-goal', name: 'B獎品', costPoints: 4, active: true, revision: 1 };
    api.getRewards.mockResolvedValueOnce([rewardB]);
    devotionApi.getGroupReading.mockResolvedValueOnce(groupView(7));
    await act(async () => { authListeners.at(-1)?.({ current: auth.session }); });
    await act(async () => { renderer.update(React.createElement(ProgressScreen)); });
    await act(async () => { focusCallbacks.at(-1)?.(); await Promise.resolve(); });
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile).toMatchObject({ memberId: 'member-b', earnedTotal: 2 });
    const expectBSecondary = () => {
      const score = renderer.root.findByType('ScoreProfile' as any);
      expect(score.props.rewards.map((reward: any) => reward.name)).toContain('B獎品');
      expect(renderer.root.findByType(GroupReadingCard).props.view.monthReads).toBe(7);
    };
    expectBSecondary();

    await act(async () => { resolveRefreshA({ ...profileA, displayName: 'A舊請求私人資料', earnedTotal: 99, private: { redeemableBalance: 99, targetReward: null } }); });
    await act(async () => {
      resolveRewardsA([{ rewardId: 'a-late', name: 'A舊獎品', costPoints: 1, active: true, revision: 1 }]);
      resolveGroupA(groupView(99));
      await Promise.resolve();
    });
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile).toMatchObject({ memberId: 'member-b', earnedTotal: 2 });
    expect(renderer.root.findAll((node) => String(node.type) === 'ScoreProfile' && node.props.profile.displayName === 'A舊請求私人資料')).toHaveLength(0);
    expectBSecondary();
  });

});

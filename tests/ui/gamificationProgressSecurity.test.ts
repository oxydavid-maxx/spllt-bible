import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const { primitive, api, auth, appListeners, focusCallbacks, focusCleanupRef, authListeners } = vi.hoisted(() => ({
  primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children),
  api: {
    getCapabilities: vi.fn(async () => ({ canViewAllScores: true, canManageRewards: false, canRedeemRewards: false })),
    getProfile: vi.fn(), getPeople: vi.fn(async () => []), getMyRedemptions: vi.fn(), getAdminRedemptions: vi.fn(),
    getRewards: vi.fn(async () => [{ rewardId: 'goal', name: '電影票', costPoints: 10, active: true, revision: 1 }]),
    getNominations: vi.fn(async () => ({ round: { roundId: 'round-1', title: '提案', closesAt: 9999999999999 }, nominations: [] })),
    getCommunityProgress: vi.fn(async () => ({ books: ['約翰福音'], personDays: 3, currentBook: null })),
    getPendingOperations: vi.fn(async () => ({ ownerMemberId: 'self', redemptions: [], reversals: [] })),
  },
  auth: { status: 'signed-in' as 'signed-in' | 'signed-out', session: { memberId: 'self', sessionToken: 'token' } as { memberId: string; sessionToken: string } | null, profile: null, profileStatus: 'ready', epoch: 1 },
  appListeners: [] as Array<(state: string) => void>, focusCallbacks: [] as Array<() => (() => void) | void>, focusCleanupRef: { current: null as (() => void) | null },
  authListeners: [] as Array<(change: { current: { memberId: string; sessionToken: string } | null }) => void>,
}));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));
vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn((_event: string, listener: (state: string) => void) => { appListeners.push(listener); return { remove: vi.fn() }; }) }, Pressable: primitive('Pressable'), Text: primitive('Text'), TextInput: primitive('TextInput'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Circle: el('Circle') }; });
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
  isCurrentAuthSession: (session: { memberId: string; sessionToken: string }) => auth.status === 'signed-in' && auth.session?.memberId === session.memberId && auth.session?.sessionToken === session.sessionToken,
  registerAuthLifecycleListener: (listener: (change: { current: { memberId: string; sessionToken: string } | null }) => void) => {
    authListeners.push(listener);
    return () => { const index = authListeners.indexOf(listener); if (index >= 0) authListeners.splice(index, 1); };
  },
  useAuthSnapshot: () => auth,
}));
vi.mock('../../src/services/gamificationApiClient', () => ({ GamificationApiError: class extends Error { userMessage = 'error'; }, createGamificationApiClient: () => api }));
vi.mock('../../src/ui/gamification/PeopleList', () => ({ PeopleList: (props: any) => React.createElement('PeopleList', props) }));
vi.mock('../../src/ui/gamification/ScoreProfile', () => ({ ScoreProfile: (props: any) => React.createElement('ScoreProfile', props) }));
vi.mock('../../src/ui/gamification/NominationBanner', () => ({ NominationBanner: (props: any) => React.createElement('NominationBanner', props) }));
vi.mock('../../src/ui/gamification/CommunityProgress', () => ({ CommunityProgress: (props: any) => React.createElement('CommunityProgress', props) }));
vi.mock('../../src/ui/gamification/ActionSheet', () => ({ ActionSheet: (props: any) => props.visible ? React.createElement('ActionSheet', props, props.children) : null }));
vi.mock('../../src/ui/gamification/FriendQrPanel', () => ({ FriendQrPanel: (props: any) => React.createElement('FriendQrPanel', props) }));
vi.mock('../../src/ui/gamification/RewardControls', () => ({ RewardControls: (props: any) => React.createElement('RewardControls', props) }));

import ProgressScreen from '../../app/(tabs)/progress';

describe('progress protected response lifecycle', () => {
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
    await act(async () => { appListeners[appListeners.length - 1]?.('background'); });
    await act(async () => { resolveRedemptions([]); });
    expect(renderer.root.findAll((node) => String(node.type) === 'ActionSheet' && node.props.title === '領取紀錄')).toHaveLength(0);
  });

  it('refreshes the signed-in member profile when returning from background', async () => {
    api.getProfile.mockResolvedValue({ memberId: 'self', displayName: '自己', earnedTotal: 1, band: null, months: [], private: { redeemableBalance: 1, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    const initialCalls = api.getProfile.mock.calls.length;
    await act(async () => { appListeners[appListeners.length - 1]?.('background'); appListeners[appListeners.length - 1]?.('active'); });
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
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '全體（管理）')[0].props.onPress(); await Promise.resolve(); });
    await act(async () => { appListeners[appListeners.length - 1]?.('background'); resolvePending({ ownerMemberId: 'self', redemptions: [], reversals: [] }); });
    expect(api.getPeople).not.toHaveBeenCalledWith('all');
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === '全體（管理）' && node.props.accessibilityState?.selected)).toHaveLength(0);
  });

  it('keeps the same-account profile and secondary blocks stable until refresh fails', async () => {
    const profile = { memberId: 'self', displayName: '自己', earnedTotal: 1, band: null, months: [], private: { redeemableBalance: 1, targetReward: { rewardId: 'goal', name: '電影票', costPoints: 10, active: true, revision: 1 } }, permissions: { canEditTarget: true, canRedeem: false } };
    let resolveRefresh!: (value: unknown) => void; let rejectRefresh!: (reason: unknown) => void;
    api.getProfile.mockReset().mockResolvedValueOnce(profile).mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; })).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRefresh = reject; }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); await Promise.resolve(); await Promise.resolve(); });
    const expectSecondaryPresence = () => {
      const score = renderer.root.findByType('ScoreProfile' as any);
      expect(score.props.rewards).toHaveLength(1);
      expect(score.props.community).toBeDefined();
      expect(renderer.root.findAll((node) => String(node.type) === 'NominationBanner')).toHaveLength(1);
    };
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile).toMatchObject({ memberId: 'self', earnedTotal: 1 });
    expectSecondaryPresence();

    await act(async () => {
      focusCleanupRef.current?.(); focusCleanupRef.current = null;
      const cleanup = focusCallbacks.at(-1)?.();
      focusCleanupRef.current = typeof cleanup === 'function' ? cleanup : null;
      await Promise.resolve();
    });
    expect(api.getProfile).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile).toMatchObject({ memberId: 'self', earnedTotal: 1 });
    expectSecondaryPresence();
    expect(renderer.root.findAll((node) => String(node.type) === 'Text' && node.props.children === '載入中…')).toHaveLength(0);
    expect(renderer.root.findAll((node) => String(node.type) === 'Text' && node.props.children === '目前顯示上次的積分，還沒連上更新')).toHaveLength(0);

    await act(async () => { resolveRefresh({ ...profile, earnedTotal: 2, private: { redeemableBalance: 2, targetReward: profile.private.targetReward } }); });
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile.earnedTotal).toBe(2);
    expectSecondaryPresence();
    expect(renderer.root.findAll((node) => String(node.type) === 'Text' && node.props.children === '目前顯示上次的積分，還沒連上更新')).toHaveLength(0);

    await act(async () => { focusCallbacks.at(-1)?.(); await Promise.resolve(); });
    expectSecondaryPresence();
    expect(renderer.root.findAll((node) => String(node.type) === 'Text' && node.props.children === '目前顯示上次的積分，還沒連上更新')).toHaveLength(0);
    await act(async () => { rejectRefresh(new Error('offline')); await Promise.resolve(); });
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile.earnedTotal).toBe(2);
    expectSecondaryPresence();
    expect(renderer.root.findAll((node) => String(node.type) === 'Text' && node.props.children === '目前顯示上次的積分，還沒連上更新')).toHaveLength(1);
  });

  it('clears member A on account change and never applies A response after member B signs in', async () => {
    auth.status = 'signed-in'; auth.session = { memberId: 'member-a', sessionToken: 'token-a' };
    let resolveRefreshA!: (value: unknown) => void;
    const profileA = { memberId: 'member-a', displayName: 'A私人資料', earnedTotal: 1, band: null, months: [], private: { redeemableBalance: 1, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } };
    const profileB = { memberId: 'member-b', displayName: 'B私人資料', earnedTotal: 2, band: null, months: [], private: { redeemableBalance: 2, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } };
    api.getProfile.mockReset().mockResolvedValueOnce(profileA).mockImplementationOnce(() => new Promise((resolve) => { resolveRefreshA = resolve; })).mockResolvedValueOnce(profileB);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    expect(api.getProfile).toHaveBeenCalledWith('member-a', 'me', expect.any(String));
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile).toMatchObject({ memberId: 'member-a', earnedTotal: 1 });
    await act(async () => { focusCallbacks.at(-1)?.(); await Promise.resolve(); });
    expect(api.getProfile).toHaveBeenCalledTimes(2);

    auth.status = 'signed-out'; auth.session = null;
    await act(async () => { authListeners.at(-1)?.({ current: null }); });
    expect(renderer.root.findAll((node) => String(node.type) === 'ScoreProfile')).toHaveLength(0);
    await act(async () => { renderer.update(React.createElement(ProgressScreen)); });

    auth.status = 'signed-in'; auth.session = { memberId: 'member-b', sessionToken: 'token-b' };
    await act(async () => { authListeners.at(-1)?.({ current: auth.session }); });
    await act(async () => { renderer.update(React.createElement(ProgressScreen)); });
    await act(async () => { focusCallbacks.at(-1)?.(); await Promise.resolve(); });
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile).toMatchObject({ memberId: 'member-b', earnedTotal: 2 });

    await act(async () => { resolveRefreshA({ ...profileA, displayName: 'A舊請求私人資料', earnedTotal: 99, private: { redeemableBalance: 99, targetReward: null } }); });
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile).toMatchObject({ memberId: 'member-b', earnedTotal: 2 });
    expect(renderer.root.findAll((node) => String(node.type) === 'ScoreProfile' && node.props.profile.displayName === 'A舊請求私人資料')).toHaveLength(0);
  });

});

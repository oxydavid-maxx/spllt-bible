import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const { primitive, api, auth, ApiError, appListeners } = vi.hoisted(() => ({
  primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children),
  api: { getCapabilities: vi.fn(async () => ({ canViewAllScores: true, canManageRewards: true, canRedeemRewards: true })), getProfile: vi.fn(async (memberId: string, scope: string = 'me') => ({ memberId, displayName: memberId === 'self' ? '自己' : '好友', earnedTotal: 4, band: 2, months: [{ month: '2026-09', earnedPoints: 4 }], permissions: { canEditTarget: memberId === 'self', canRedeem: true }, ...(scope !== 'friends' ? { private: { redeemableBalance: 4, targetReward: null } } : {}) })), getPeople: vi.fn(async () => [{ memberId: 'friend', displayName: '好友', earnedTotal: 3 }]), getRewards: vi.fn(async () => [{ rewardId: 'reward-1', name: '飲料', costPoints: 2, active: true, revision: 1 }]), getMyRedemptions: vi.fn(async () => []), getAdminRedemptions: vi.fn(async () => [{ redemptionId: 'r1', memberId: 'friend', rewardId: 'reward-1', rewardName: '飲料', costPoints: 2, status: 'COMPLETED', confirmedAt: 10 }]), getPendingOperations: vi.fn(async (): Promise<any> => ({ ownerMemberId: 'self', redemptions: [], reversals: [] })), retryPendingRedemption: vi.fn(async () => ({})), retryPendingReversal: vi.fn(async () => undefined), removeFriend: vi.fn(async () => undefined), redeem: vi.fn(async () => ({})), reverseRedemption: vi.fn(async () => undefined) },
  auth: { status: 'signed-in', session: { memberId: 'self', sessionToken: 'token' }, profile: null, profileStatus: 'ready', epoch: 1 },
  ApiError: class extends Error { retryable = true; userMessage = 'error'; },
  appListeners: [] as Array<(state: string) => void>,
}));
vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn((_event: string, listener: (state: string) => void) => { appListeners.push(listener); return { remove: vi.fn() }; }) }, Pressable: primitive('Pressable'), Text: primitive('Text'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Circle: el('Circle') }; });
vi.mock('expo-router', () => ({ useFocusEffect: (callback: () => (() => void) | void) => { require('react').useEffect(callback, []); } }));
vi.mock('expo-local-authentication', () => ({ authenticateAsync: vi.fn(async () => ({ success: true })) }));
vi.mock('../../src/services/authSession', () => ({ isCurrentAuthSession: () => true, registerAuthLifecycleListener: () => vi.fn(), useAuthSnapshot: () => auth }));
vi.mock('../../src/services/gamificationApiClient', () => ({ GamificationApiError: ApiError, createGamificationApiClient: () => api }));
vi.mock('../../src/ui/gamification/PeopleList', () => ({ PeopleList: (props: any) => React.createElement('PeopleList', props) }));
vi.mock('../../src/ui/gamification/ScoreProfile', () => ({ ScoreProfile: (props: any) => React.createElement('ScoreProfile', props) }));
vi.mock('../../src/ui/gamification/ActionSheet', () => ({ ActionSheet: (props: any) => props.visible ? React.createElement('ActionSheet', props, props.children) : null }));
vi.mock('../../src/ui/gamification/RedemptionList', () => ({ RedemptionList: (props: any) => React.createElement('RedemptionList', props) }));
vi.mock('../../src/ui/gamification/FriendQrPanel', () => ({ FriendQrPanel: (props: any) => React.createElement('FriendQrPanel', props) }));
vi.mock('../../src/ui/gamification/RewardControls', () => ({ RewardControls: (props: any) => React.createElement('RewardControls', props) }));

import ProgressScreen from '../../app/(tabs)/progress';

describe('progress gamification route', () => {
  it('loads own profile, then uses the same people/profile surface for friends', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    expect(api.getCapabilities).toHaveBeenCalledTimes(1);
    expect(api.getProfile).toHaveBeenCalledWith('self', 'me', expect.stringMatching(/^\d{4}-\d{2}$/));
    const friends = renderer.root.findAll((node) => node.props.accessibilityLabel === '好友')[0];
    await act(async () => { friends.props.onPress(); });
    expect(api.getPeople).toHaveBeenCalledWith('friends');
    expect(renderer.root.findByType('PeopleList' as any).props.showRank).toBe(false);
    const person = renderer.root.findByType('PeopleList' as any).props.people[0];
    await act(async () => { renderer.root.findByType('PeopleList' as any).props.onSelect(person); });
    expect(api.getProfile).toHaveBeenCalledWith('friend', 'friends', expect.stringMatching(/^\d{4}-\d{2}$/));
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile.private).toBeUndefined();
  });

  it('reloads the selected profile with the requested chart period through the same scope', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '好友')[0].props.onPress(); });
    const list = renderer.root.findByType('PeopleList' as any);
    await act(async () => { list.props.onSelect(list.props.people[0]); });
    const profile = renderer.root.findByType('ScoreProfile' as any);
    await act(async () => { profile.props.onChartChange({ range: 'year', anchor: '2025' }); });
    expect(api.getProfile).toHaveBeenLastCalledWith('friend', 'friends', expect.stringMatching(/^\d{4}-\d{2}$/), { range: 'year', anchor: '2025' });
  });

  it('keeps only the latest chart response after rapid range changes', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '好友')[0].props.onPress(); });
    const list = renderer.root.findByType('PeopleList' as any);
    await act(async () => { list.props.onSelect(list.props.people[0]); });
    type ProfileResponse = Awaited<ReturnType<typeof api.getProfile>>;
    let resolveFirst!: (value: ProfileResponse) => void;
    let resolveSecond!: (value: ProfileResponse) => void;
    const chartProfile = (range: string, anchor: string) => ({ memberId: 'friend', displayName: '好友', earnedTotal: 4, band: 2, months: [], chart: { range, anchor, periodStart: '2026-01-01', periodEnd: '2026-12-31', earnedPoints: 4, buckets: [], previousAnchor: null, nextAnchor: null }, permissions: { canEditTarget: false, canRedeem: false } });
    api.getProfile.mockImplementationOnce(() => new Promise<ProfileResponse>((resolve) => { resolveFirst = (value) => resolve(value); }));
    api.getProfile.mockImplementationOnce(() => new Promise<ProfileResponse>((resolve) => { resolveSecond = (value) => resolve(value); }));
    const profile = renderer.root.findByType('ScoreProfile' as any);
    await act(async () => { profile.props.onChartChange({ range: 'month', anchor: '2026-08' }); });
    await act(async () => { profile.props.onChartChange({ range: 'year', anchor: '2025' }); });
    await act(async () => { resolveSecond(chartProfile('year', '2025')); await Promise.resolve(); });
    await act(async () => { resolveFirst(chartProfile('month', '2026-08')); await Promise.resolve(); });
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile.chart).toMatchObject({ range: 'year', anchor: '2025' });
  });

  it('makes redemption records and friend removal reachable through the shared action sheet', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    const menu = () => renderer.root.findAll((node) => node.props.accessibilityLabel === '開啟積分操作')[0];
    await act(async () => { menu().props.onPress(); });
    const recordAction = renderer.root.findByType('ActionSheet' as any).props.actions.find((action: any) => action.label === '我的領取紀錄');
    await act(async () => { await recordAction.onPress(); });
    expect(api.getMyRedemptions).toHaveBeenCalledTimes(1);
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '好友')[0].props.onPress(); });
    const list = renderer.root.findByType('PeopleList' as any);
    await act(async () => { list.props.onSelect(list.props.people[0]); });
    await act(async () => { menu().props.onPress(); });
    const removeAction = renderer.root.findByType('ActionSheet' as any).props.actions.find((action: any) => action.label === '移除好友');
    await act(async () => { await removeAction.onPress(); });
    expect(api.removeFriend).toHaveBeenCalledWith('friend');
  });

  it('requires admin unlock before the all scope and reaches redeem/reverse actions', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    const all = renderer.root.findAll((node) => node.props.accessibilityLabel === '全體（管理）')[0];
    await act(async () => { all.props.onPress(); });
    expect(api.getPeople).toHaveBeenCalledWith('all');
    const list = renderer.root.findByType('PeopleList' as any);
    await act(async () => { list.props.onSelect(list.props.people[0]); });
    await act(async () => { renderer.root.findByType('ScoreProfile' as any).props.onOpenActions(); });
    const controls = renderer.root.findByType('RewardControls' as any);
    await act(async () => { controls.props.onRedeem('reward-1'); });
    expect(api.redeem).toHaveBeenCalledWith({ memberId: 'friend', rewardId: 'reward-1', expectedRewardRevision: 1 });
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '開啟積分操作')[0].props.onPress(); });
    const recordsAction = renderer.root.findByType('ActionSheet' as any).props.actions.find((action: any) => action.label === '查看領取紀錄');
    await act(async () => { await recordsAction.onPress(); });
    const redemptionList = renderer.root.findByType('RedemptionList' as any);
    await act(async () => { redemptionList.props.onReverse('r1', '現場更正'); });
    expect(api.reverseRedemption).toHaveBeenCalledWith('r1', '現場更正');
  });

  it('opens the claimed friend profile immediately from the scanner callback', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '開啟積分操作')[0].props.onPress(); });
    const scanAction = renderer.root.findByType('ActionSheet' as any).props.actions.find((action: any) => action.label === '掃描好友 QR');
    await act(async () => { scanAction.onPress(); });
    await act(async () => { renderer.root.findByType('FriendQrPanel' as any).props.onClaimed('friend'); });
    expect(api.getProfile).toHaveBeenCalledWith('friend', 'friends', expect.stringMatching(/^\d{4}-\d{2}$/));
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile.private).toBeUndefined();
  });

  it('keeps the same redemption operation available from the visible retry action after timeout', async () => {
    api.redeem.mockRejectedValueOnce(new ApiError('timeout')).mockResolvedValueOnce({});
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '全體（管理）')[0].props.onPress(); });
    const list = renderer.root.findByType('PeopleList' as any);
    await act(async () => { list.props.onSelect(list.props.people[0]); });
    await act(async () => { renderer.root.findByType('ScoreProfile' as any).props.onOpenActions(); });
    await act(async () => { renderer.root.findByType('RewardControls' as any).props.onRedeem('reward-1'); });
    const retry = renderer.root.findByProps({ accessibilityLabel: '重試尚未確認兌換' });
    await act(async () => { retry.props.onPress(); });
    expect(api.redeem).toHaveBeenCalledTimes(2);
    const redeemCalls = api.redeem.mock.calls as unknown as Array<[unknown]>;
    expect(redeemCalls[0][0]).toEqual(redeemCalls[1][0]);
  });

  it('reopens saved pending operations after admin unlock and retries the original stored request', async () => {
    api.getPendingOperations.mockResolvedValueOnce({
      ownerMemberId: 'self',
      redemptions: [{ operationId: '11111111-1111-4111-8111-111111111111', memberId: 'friend', rewardId: 'reward-original', expectedRewardRevision: 7 }],
      reversals: [{ operationId: '22222222-2222-4222-8222-222222222222', redemptionId: 'r-old', reason: '原始理由' }],
    });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '全體（管理）')[0].props.onPress(); });
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '開啟積分操作')[0].props.onPress(); });
    const pendingAction = renderer.root.findByType('ActionSheet' as any).props.actions.find((action: any) => action.label === '尚未確認操作 (2)');
    await act(async () => { pendingAction.onPress(); });
    const retryRedemption = renderer.root.findByProps({ accessibilityLabel: '重試尚未確認兌換 reward-original' });
    const retryReversal = renderer.root.findByProps({ accessibilityLabel: '重試尚未確認撤銷 r-old' });
    await act(async () => { retryRedemption.props.onPress(); retryReversal.props.onPress(); });
    expect(api.retryPendingRedemption).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(api.retryPendingReversal).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
  });

  it('clears pending recovery on background and reloads it only after a fresh admin unlock', async () => {
    api.getPendingOperations.mockResolvedValue({ ownerMemberId: 'self', redemptions: [{ operationId: '11111111-1111-4111-8111-111111111111', memberId: 'friend', rewardId: 'reward-1', expectedRewardRevision: 1 }], reversals: [] });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    const openMenu = async () => { await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '開啟積分操作')[0].props.onPress(); }); };
    await openMenu();
    expect(renderer.root.findByType('ActionSheet' as any).props.actions.some((action: any) => action.label.startsWith('尚未確認操作'))).toBe(false);
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '全體（管理）')[0].props.onPress(); });
    await openMenu();
    expect(renderer.root.findByType('ActionSheet' as any).props.actions.some((action: any) => action.label === '尚未確認操作 (1)')).toBe(true);

    await act(async () => { appListeners[appListeners.length - 1]?.('background'); appListeners[appListeners.length - 1]?.('active'); await Promise.resolve(); });
    await openMenu();
    expect(renderer.root.findByType('ActionSheet' as any).props.actions.some((action: any) => action.label.startsWith('尚未確認操作'))).toBe(false);
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '全體（管理）')[0].props.onPress(); });
    await openMenu();
    expect(renderer.root.findByType('ActionSheet' as any).props.actions.some((action: any) => action.label === '尚未確認操作 (1)')).toBe(true);
    expect(api.getPendingOperations).toHaveBeenCalledTimes(2);
  });

  it('ignores a late profile response from the first person after a rapid second selection', async () => {
    let resolveFirst!: (value: unknown) => void; let resolveSecond!: (value: unknown) => void;
    api.getPeople.mockResolvedValueOnce([{ memberId: 'first', displayName: '第一位', earnedTotal: 1 }, { memberId: 'second', displayName: '第二位', earnedTotal: 2 }]);
    (api.getProfile as any).mockImplementation((memberId: string, scope: string = 'me') => memberId === 'self' ? Promise.resolve({ memberId, displayName: '自己', earnedTotal: 1, band: null, months: [], ...(scope !== 'friends' ? { private: { redeemableBalance: 1, targetReward: null } } : {}), permissions: { canEditTarget: false, canRedeem: false } }) : new Promise((resolve) => { if (memberId === 'first') resolveFirst = resolve as any; else resolveSecond = resolve as any; }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '好友')[0].props.onPress(); });
    const list = renderer.root.findByType('PeopleList' as any);
    await act(async () => { list.props.onSelect(list.props.people[0]); list.props.onSelect(list.props.people[1]); });
    await act(async () => { resolveSecond({ memberId: 'second', displayName: '第二位', earnedTotal: 2, band: null, months: [], permissions: { canEditTarget: false, canRedeem: false } }); });
    await act(async () => { resolveFirst({ memberId: 'first', displayName: '第一位', earnedTotal: 1, band: null, months: [], permissions: { canEditTarget: false, canRedeem: false } }); });
    expect(renderer.root.findByType('ScoreProfile' as any).props.profile.displayName).toBe('第二位');
  });

  it('opens my redemption records from a friends scope by targeting the signed-in member', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '好友')[0].props.onPress(); });
    const list = renderer.root.findByType('PeopleList' as any);
    await act(async () => { list.props.onSelect(list.props.people[0]); });
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '開啟積分操作')[0].props.onPress(); });
    const action = renderer.root.findByType('ActionSheet' as any).props.actions.find((item: any) => item.label === '我的領取紀錄');
    await act(async () => { await action.onPress(); });
    expect(api.getMyRedemptions).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByType('ActionSheet' as any).props.title).toBe('領取紀錄');
  });

  it('does not resurrect a redemption retry after a late timeout resolves while locked', async () => {
    (api.getProfile as any).mockImplementation(async (memberId: string) => ({ memberId, displayName: memberId === 'self' ? '自己' : '好友', earnedTotal: 4, band: 2, months: [{ month: '2026-09', earnedPoints: 4 }], permissions: { canEditTarget: false, canRedeem: true }, private: { redeemableBalance: 4, targetReward: null } }));
    let rejectRedeem!: (error: unknown) => void;
    api.redeem.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRedeem = reject; }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '全體（管理）')[0].props.onPress(); });
    const list = renderer.root.findByType('PeopleList' as any);
    await act(async () => { list.props.onSelect(list.props.people[0]); });
    await act(async () => { renderer.root.findByType('ScoreProfile' as any).props.onOpenActions(); });
    await act(async () => { renderer.root.findByType('RewardControls' as any).props.onRedeem('reward-1'); });
    await act(async () => { appListeners[appListeners.length - 1]?.('background'); rejectRedeem(new ApiError('timeout')); });
    await act(async () => { appListeners[appListeners.length - 1]?.('active'); await Promise.resolve(); });
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '開啟積分操作')[0].props.onPress(); });
    const recordAction = renderer.root.findByType('ActionSheet' as any).props.actions.find((action: any) => action.label === '我的領取紀錄');
    await act(async () => { await recordAction.onPress(); });
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === '重試尚未確認兌換')).toHaveLength(0);
  });
});

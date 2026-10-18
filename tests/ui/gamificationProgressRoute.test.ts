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
vi.mock('../../src/ui/gamification/RewardControls', () => ({ RewardControls: (props: any) => React.createElement('RewardControls', props) }));

import { consumeOpenAllScores, requestOpenAllScores } from '../../src/services/allScoresRequest';
import ProgressScreen from '../../app/(tabs)/progress';

// 全體 is asked for from 我的帳戶 and heard by every mounted 積分 screen, so each test unmounts its own.
const mountedScreens: TestRenderer.ReactTestRenderer[] = [];
const createScreen = TestRenderer.create;
beforeEach(() => { vi.spyOn(TestRenderer, 'create').mockImplementation(((...args: Parameters<typeof createScreen>) => { const tree = createScreen(...args); mountedScreens.push(tree); return tree; }) as typeof createScreen); });
afterEach(async () => { await act(async () => { for (const tree of mountedScreens.splice(0)) tree.unmount(); }); consumeOpenAllScores(); });

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

  it('opens the existing target picker from the profile callback and carries its selected reward through setTarget', async () => {
    const current = { rewardId: 'reward-1', name: '飲料', costPoints: 2, active: true, revision: 1 };
    const alternative = { rewardId: 'reward-2', name: '電影票', costPoints: 5, active: true, revision: 1 };
    api.getProfile.mockResolvedValueOnce({ memberId: 'self', displayName: '自己', earnedTotal: 4, band: 2, months: [], private: { redeemableBalance: 3, targetReward: current }, permissions: { canEditTarget: true, canRedeem: false } } as any);
    api.getRewards.mockResolvedValueOnce([current, alternative]).mockResolvedValueOnce([current, alternative]);
    api.setRewardTarget.mockClear();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    const profile = renderer.root.findByType('ScoreProfile' as any);
    expect(profile.props.profile.private.targetReward.rewardId).toBe('reward-1');
    await act(async () => { profile.props.onChooseReward(); await Promise.resolve(); await Promise.resolve(); });
    expect(renderer.root.findByType('ActionSheet' as any).props.title).toBe('選擇目標獎品');
    const controls = renderer.root.findByType('RewardControls' as any);
    expect(controls.props.selectedRewardId).toBe('reward-1');
    expect(controls.props.rewards).toEqual([current, alternative]);
    await act(async () => { controls.props.onSelect('reward-2'); await Promise.resolve(); await Promise.resolve(); });
    expect(api.setRewardTarget).toHaveBeenCalledWith('reward-2');
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

  // Prizes and redemptions are kept in the Google Sheet (維護者 2026-10-17): 全體 shows scores and nothing to redeem.
  it('requires admin unlock before the all scope, and offers no redeem, record or prize management there', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
    await act(async () => { requestOpenAllScores(); });
    expect(api.getPeople).toHaveBeenCalledWith('all');
    const list = renderer.root.findByType('PeopleList' as any);
    await act(async () => { list.props.onSelect(list.props.people[0]); });
    expect(renderer.root.findByType('ScoreProfile' as any).props.onOpenActions).toBeUndefined();
    await act(async () => { renderer.root.findAll((node) => node.props.accessibilityLabel === '開啟積分操作')[0].props.onPress(); });
    const labels = renderer.root.findByType('ActionSheet' as any).props.actions.map((action: any) => action.label);
    expect(labels).toEqual(['我的好友 QR', '掃描好友 QR', '我的領取紀錄']);
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
});

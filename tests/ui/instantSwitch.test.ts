import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: (props: any) => props.children, SafeAreaView: (props: any) => props.children }));

// 光佑 2026-10-23:「在積分頁，如果點選『全教會』或『青少』看積分的時候，速度很慢……速度要完全無感非常的快。」
// Every switch on the 積分 page shows what was asked ahead at once and never sends the same question twice in a visit;
// another member never sees what was kept for the one before.
const { primitive, api, auth, devotionApi, hold } = vi.hoisted(() => {
  const hold = { group: false };
  const movie = { rewardId: 'sheet-youth-1', name: '電影票', costPoints: 75, active: true, revision: 1 };
  const group = (memberId: string, month: string, scope: 'youth' | 'main') => ({ scope, month, today: '2026-10-23', todayReaders: memberId === 'self' ? 7 : 2, yesterdayReaders: 4, days: [], monthReads: scope === 'main' ? 54 : 52, busiest: null, qualifyingDays: 15, prizes: [], myDaysThisMonth: 3 });
  const auth = { status: 'signed-in', session: { memberId: 'self', sessionToken: 'token' }, profile: null, profileStatus: 'ready', epoch: 1 };
  return {
    hold,
    primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children),
    auth,
    api: {
      getCapabilities: vi.fn(async () => ({ canViewAllScores: false, canManageRewards: false, canRedeemRewards: false })),
      getProfile: vi.fn(async (memberId: string) => ({ memberId, displayName: '自己', earnedTotal: 4, band: null, months: [], private: { redeemableBalance: 4, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } })),
      getPeople: vi.fn(async () => [{ memberId: 'friend-1', displayName: '好友一', earnedTotal: 3 }]),
      getMyRedemptions: vi.fn(async () => [{ redemptionId: 'r1', rewardName: '電影票', costPoints: 75, redeemedAt: '2026-10-01T00:00:00Z' }]),
      setRewardTarget: vi.fn(async () => undefined),
      getRewards: vi.fn(async (asked?: 'youth' | 'main') => (asked ?? 'main') === 'youth' ? [movie] : []),
    },
    devotionApi: {
      getCongregation: vi.fn(async () => 'main' as const),
      setCongregation: vi.fn(async (value: 'youth' | 'main') => value),
      getGroupReading: vi.fn((month: string, asked?: 'youth' | 'main') => hold.group ? new Promise<never>(() => undefined) : Promise.resolve(group(auth.session.memberId, month, asked ?? 'main'))),
      getDevotionDates: vi.fn(async () => []), setDevotion: vi.fn(async () => undefined),
      getScoreHistory: vi.fn(async () => { throw new Error('not served'); }), getDevotional: vi.fn(async () => null),
    },
  };
});
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));
vi.mock('../../src/services/useCompletionController', () => ({ useCompletionController: (options: { planId: string; taskDate: string }) => ({ record: { memberId: 'self', planId: options.planId, taskDate: options.taskDate, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' }, pending: false, syncError: false, retryable: false, complete: vi.fn(async () => undefined), requestUndo: vi.fn() }) }));
vi.mock('../../src/ui/CompletionAwardFeedback', () => ({ CompletionAwardFeedback: () => null }));
vi.mock('../../src/storage/mobileDatabase', () => ({ openQingmuRepository: vi.fn(), openQingmuReaderPositionStore: vi.fn(), openQingmuJournalStore: vi.fn() }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: () => ({ getReadingDays: async () => undefined }) }));
vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) }, Pressable: primitive('Pressable'), Text: primitive('Text'), TextInput: primitive('TextInput'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Circle: el('Circle'), Polyline: el('Polyline'), Path: el('Path'), Rect: el('Rect'), G: el('G'), Line: el('Line'), Text: el('SvgText') }; });
vi.mock('../../src/services/devotionClient', () => ({ createDevotionClient: () => devotionApi }));
vi.mock('expo-router', () => ({ useFocusEffect: (callback: () => (() => void) | void) => { require('react').useEffect(callback, []); } }));
vi.mock('expo-local-authentication', () => ({ authenticateAsync: vi.fn(async () => ({ success: true })) }));
vi.mock('../../src/services/authSession', () => ({ getAuthSnapshot: () => auth, isCurrentAuthSession: (session: any) => session?.memberId === auth.session.memberId && session?.sessionToken === auth.session.sessionToken, registerAuthLifecycleListener: () => vi.fn(), useAuthSnapshot: () => auth }));
vi.mock('../../src/services/gamificationApiClient', () => ({ GamificationApiError: class extends Error { userMessage = 'error'; }, createGamificationApiClient: () => api }));
vi.mock('../../src/ui/gamification/PeopleList', () => ({ PeopleList: (props: any) => React.createElement('PeopleList', props) }));
vi.mock('../../src/ui/gamification/ScoreProfile', () => ({ ScoreProfile: (props: any) => React.createElement('ScoreProfile', props, props.lead) }));
vi.mock('../../src/ui/gamification/ActionSheet', () => ({ ActionSheet: (props: any) => props.visible ? React.createElement('ActionSheet', props, props.children, ...(props.actions ?? []).map((action: any) => React.createElement('Pressable', { key: action.label, accessibilityLabel: action.label, disabled: action.disabled, onPress: action.onPress }))) : null }));
vi.mock('../../src/ui/gamification/FriendQrPanel', () => ({ FriendQrPanel: (props: any) => React.createElement('FriendQrPanel', props) }));
// Counts how often the rest of the page draws: the day card at its top stands for it.
const renders = vi.hoisted(() => ({ dayCard: 0 }));
vi.mock('../../src/ui/gamification/SelectedDayCard', async () => {
  const actual = await vi.importActual<typeof import('../../src/ui/gamification/SelectedDayCard')>('../../src/ui/gamification/SelectedDayCard');
  return { ...actual, SelectedDayCard: (props: any) => { renders.dayCard += 1; return React.createElement(actual.SelectedDayCard, props); } };
});

import ProgressScreen from '../../app/(tabs)/progress';
import { resetCongregationStore } from '../../src/ui/congregation/congregationStore';
import { viewCache } from '../../src/services/viewCache';
import { taipeiDate } from '../../src/domain/gamificationV1';
import { shiftMonth } from '../../src/ui/gamification/readingCalendarModel';
import { GroupReadingCard } from '../../src/ui/gamification/GroupReadingCard';
import { requestOpenAllScores } from '../../src/services/allScoresRequest';

const mounted: TestRenderer.ReactTestRenderer[] = [];
afterEach(async () => { await act(async () => { for (const tree of mounted.splice(0)) tree.unmount(); }); });
beforeEach(() => {
  resetCongregationStore(); viewCache.clear(); hold.group = false;
  auth.session = { memberId: 'self', sessionToken: 'token' }; auth.epoch = 1;
  for (const fn of [...Object.values(api), ...Object.values(devotionApi)]) fn.mockClear();
});

const settle = async () => { for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); }); };
async function screen() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(React.createElement(ProgressScreen)); mounted.push(tree); });
  await settle();
  return tree;
}
const textOf = (node: TestRenderer.ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(textOf).join('');
const texts = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => String(node.type) === 'Text' && String(node.parent?.type) !== 'Text').map(textOf);
const pressables = (tree: TestRenderer.ReactTestRenderer, label: string, role?: string) => tree.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label && (role === undefined || node.props.accessibilityRole === role));
// A tap, then only the work React does for it: no network answer is awaited before looking at the screen.
const tap = async (node: TestRenderer.ReactTestInstance) => { await act(async () => { if (!node.props.disabled) node.props.onPress(); }); };
const groupCalls = (side: 'youth' | 'main' | undefined, month = taipeiDate().slice(0, 7)) => devotionApi.getGroupReading.mock.calls.filter(([asked, askedSide]) => asked === month && askedSide === side).length;
const groupCard = (tree: TestRenderer.ReactTestRenderer) => tree.root.findByType(GroupReadingCard);

describe('積分頁: switches show what was asked ahead, at once', () => {
  it('切到另一邊不再發第二次相同請求: 青少 is asked once, when the page opens, and every switch shows it at once', async () => {
    const tree = await screen();
    expect(groupCalls('youth')).toBe(1);
    hold.group = true; // From here on, an answer from the backend never comes.
    await tap(pressables(tree, '青少', 'tab')[0]);
    expect(texts(tree)).toContain('青少一起讀經');
    await tap(pressables(tree, '全教會', 'tab')[0]);
    expect(texts(tree)).toContain('全教會一起讀經');
    await tap(pressables(tree, '青少', 'tab')[0]);
    expect(texts(tree)).toContain('青少一起讀經');
    expect(groupCalls('youth')).toBe(1);
  });

  it('a change of month shows the month asked for ahead, and the way back asks nothing', async () => {
    const tree = await screen();
    const month = taipeiDate().slice(0, 7);
    const previous = shiftMonth(month, -1);
    expect(groupCalls(undefined, previous)).toBe(1);
    hold.group = true;
    await tap(pressables(tree, '上個月')[0]);
    expect(texts(tree)).toContain(`${Number(previous.slice(5, 7))} 月`);
    await tap(pressables(tree, '下個月')[0]);
    expect(texts(tree)).toContain(`${Number(month.slice(5, 7))} 月`);
    expect(groupCalls(undefined, previous)).toBe(1);
    expect(groupCalls(undefined, month)).toBe(1);
  });

  it('a tap on 全教會｜青少 or on a month redraws the 團體 card only, never the rest of the page', async () => {
    const tree = await screen();
    const drawn = renders.dayCard;
    await tap(pressables(tree, '青少', 'tab')[0]);
    expect(texts(tree)).toContain('青少一起讀經');
    await tap(pressables(tree, '上個月')[0]);
    await tap(pressables(tree, '全教會', 'tab')[0]);
    expect(texts(tree)).toContain('全教會一起讀經');
    expect(renders.dayCard).toBe(drawn);
  });

  it('團體 keeps its side and month across 自己｜好友, as it did when the page held them', async () => {
    const tree = await screen();
    const month = taipeiDate().slice(0, 7);
    await tap(pressables(tree, '青少', 'tab')[0]);
    await tap(pressables(tree, '上個月')[0]);
    await tap(pressables(tree, '好友', 'tab')[0]);
    await tap(pressables(tree, '自己', 'tab')[0]);
    await settle();
    expect(groupCard(tree).props.view).toMatchObject({ scope: 'youth', month: shiftMonth(month, -1) });
  });

  it('主堂獎品｜青少獎品: the other side is asked once and shown at once', async () => {
    const tree = await screen();
    await act(async () => { tree.root.findByType('ScoreProfile' as any).props.onChooseReward(); });
    await settle();
    await tap(pressables(tree, '青少獎品', 'tab')[0]);
    expect(texts(tree)).toContain('電影票');
    await tap(pressables(tree, '主堂獎品', 'tab')[0]);
    await tap(pressables(tree, '青少獎品', 'tab')[0]);
    expect(texts(tree)).toContain('電影票');
    expect(api.getRewards.mock.calls.filter(([side]) => side === 'youth')).toHaveLength(1);
  });

  it('自己｜好友 and 我的領取紀錄 open at once from what the page asked ahead', async () => {
    const tree = await screen();
    expect(api.getPeople).toHaveBeenCalledTimes(1);
    await tap(pressables(tree, '好友', 'tab')[0]);
    expect(tree.root.findByType('PeopleList' as any).props.people).toHaveLength(1);
    await tap(pressables(tree, '自己', 'tab')[0]);
    await tap(pressables(tree, '好友', 'tab')[0]);
    expect(tree.root.findByType('PeopleList' as any).props.people).toHaveLength(1);
    expect(api.getPeople).toHaveBeenCalledTimes(1);
    await tap(pressables(tree, '自己', 'tab')[0]);
    await settle();
    await tap(pressables(tree, '開啟積分操作')[0]);
    await tap(pressables(tree, '我的領取紀錄')[0]);
    expect(tree.root.findAll((node) => String(node.type) === 'ActionSheet' && node.props.title === '領取紀錄')).toHaveLength(1);
    expect(api.getMyRedemptions).toHaveBeenCalledTimes(1);
  });

  it('自己 shows the own page from this visit at once, and asks for it again behind it', async () => {
    const tree = await screen();
    await tap(pressables(tree, '好友', 'tab')[0]);
    const profile = api.getProfile.getMockImplementation()!;
    try {
      api.getProfile.mockImplementation(() => new Promise<never>(() => undefined)); // From here on the backend never answers.
      await tap(pressables(tree, '自己', 'tab')[0]);
      expect(tree.root.findAll((node) => String(node.type) === 'ScoreProfile')).toHaveLength(1);
      expect(texts(tree)).not.toContain('正在載入你的積分。');
      expect(texts(tree)).not.toContain('載入中…');
      expect(api.getProfile).toHaveBeenLastCalledWith('self', 'me', expect.any(String));
    } finally { api.getProfile.mockImplementation(profile); }
  });
});

describe('積分頁 全體 (管理): asked right after the unlock', () => {
  it('opens every name at once from the points asked ahead after the unlock', async () => {
    const people = api.getPeople.getMockImplementation()!;
    const profile = api.getProfile.getMockImplementation()!;
    try {
      auth.epoch = 77; // A fresh capabilities read (they are kept per member, session and epoch).
      api.getCapabilities.mockResolvedValueOnce({ canViewAllScores: true, canManageRewards: false, canRedeemRewards: false });
      api.getPeople.mockImplementation(async (scope?: string) => scope === 'all' ? [{ memberId: 'm1', displayName: '甲', earnedTotal: 9 }, { memberId: 'm2', displayName: '乙', earnedTotal: 5 }] : [{ memberId: 'friend-1', displayName: '好友一', earnedTotal: 3 }]);
      const tree = await screen();
      await act(async () => { requestOpenAllScores(); await Promise.resolve(); });
      await settle();
      expect(tree.root.findByType('PeopleList' as any).props.people).toHaveLength(2);
      expect((api.getProfile.mock.calls as unknown[][]).filter((call) => call[1] === 'all').map((call) => call[0])).toEqual(['m1', 'm2']);
      api.getProfile.mockImplementation(() => new Promise<never>(() => undefined)); // From here on, no answer comes.
      await act(async () => { tree.root.findByType('PeopleList' as any).props.onSelect({ memberId: 'm2', displayName: '乙', earnedTotal: 5 }); });
      expect(tree.root.findAll((node) => String(node.type) === 'ScoreProfile' && node.props.profile?.memberId === 'm2')).toHaveLength(1);
      expect(texts(tree)).not.toContain('載入中…');
    } finally {
      api.getPeople.mockImplementation(people);
      api.getProfile.mockImplementation(profile);
    }
  });
});

describe('積分頁: another member never sees what was kept', () => {
  it('換帳號後看不到前一個人的暫存: after a switch of account the group card waits for the new member\'s own numbers', async () => {
    const tree = await screen();
    expect(groupCard(tree).props.view.todayReaders).toBe(7);
    hold.group = true;
    auth.session = { memberId: 'someone-else', sessionToken: 'token-2' }; auth.epoch = 2;
    await act(async () => { tree.update(React.createElement(ProgressScreen)); });
    await settle();
    expect(tree.root.findAll((node) => node.type === GroupReadingCard && node.props.view.todayReaders === 7)).toHaveLength(0);
  });
});

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: (props: any) => props.children, SafeAreaView: (props: any) => props.children }));

// The 積分 page wired to where I meet (維護者 2026-10-20, mock v3 ②–⑤): one line says where I count with its own
// 改, the group card and the prize picker look at either side, and after a change the page shows the new side
// and no longer offers a prize from the side I left as my target.
const { primitive, api, auth, devotionApi, side } = vi.hoisted(() => {
  const side = { current: 'main' as 'youth' | 'main' };
  const movie = { rewardId: 'sheet-youth-1', name: '電影票', costPoints: 75, active: true, revision: 1 };
  const group = (scope: 'youth' | 'main') => ({ scope, month: '2026-10', today: '2026-10-20', todayReaders: 2, yesterdayReaders: 4, days: [], monthReads: scope === 'main' ? 54 : 52, busiest: null, qualifyingDays: 15, prizes: [], myDaysThisMonth: 3 });
  return {
    side,
    primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children),
    auth: { status: 'signed-in', session: { memberId: 'self', sessionToken: 'token' }, profile: null, profileStatus: 'ready', epoch: 1 },
    api: {
      getCapabilities: vi.fn(async () => ({ canViewAllScores: false, canManageRewards: false, canRedeemRewards: false })),
      // The server shows a target only on the member's own side (server/routes.ts).
      getProfile: vi.fn(async (memberId: string) => ({ memberId, displayName: '自己', earnedTotal: 4, band: null, months: [], private: { redeemableBalance: 4, targetReward: side.current === 'youth' ? movie : null }, permissions: { canEditTarget: true, canRedeem: false } })),
      getPeople: vi.fn(async () => []), getMyRedemptions: vi.fn(async () => []), setRewardTarget: vi.fn(async () => undefined),
      getRewards: vi.fn(async (asked?: 'youth' | 'main') => (asked ?? side.current) === 'youth' ? [movie] : []),
    },
    devotionApi: {
      getCongregation: vi.fn(async () => side.current),
      setCongregation: vi.fn(async (value: 'youth' | 'main') => { side.current = value; return value; }),
      getGroupReading: vi.fn(async (_month: string, asked?: 'youth' | 'main') => group(asked ?? side.current)),
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
vi.mock('../../src/services/authSession', () => ({ getAuthSnapshot: () => auth, isCurrentAuthSession: () => true, registerAuthLifecycleListener: () => vi.fn(), useAuthSnapshot: () => auth }));
vi.mock('../../src/services/gamificationApiClient', () => ({ GamificationApiError: class extends Error { userMessage = 'error'; }, createGamificationApiClient: () => api }));
vi.mock('../../src/ui/gamification/PeopleList', () => ({ PeopleList: (props: any) => React.createElement('PeopleList', props) }));
vi.mock('../../src/ui/gamification/ScoreProfile', () => ({ ScoreProfile: (props: any) => React.createElement('ScoreProfile', props, props.lead) }));
vi.mock('../../src/ui/gamification/ActionSheet', () => ({ ActionSheet: (props: any) => props.visible ? React.createElement('ActionSheet', props, props.children, ...(props.actions ?? []).map((action: any) => React.createElement('Pressable', { key: action.label, accessibilityLabel: action.label, disabled: action.disabled, onPress: action.onPress }))) : null }));
vi.mock('../../src/ui/gamification/FriendQrPanel', () => ({ FriendQrPanel: (props: any) => React.createElement('FriendQrPanel', props) }));

import ProgressScreen from '../../app/(tabs)/progress';
import { viewCache } from '../../src/services/viewCache';
// The shared store outlives a screen; each test starts without another test's answers (2026-10-23).
beforeEach(() => { viewCache.clear(); });
import { resetCongregationStore } from '../../src/ui/congregation/congregationStore';

const mounted: TestRenderer.ReactTestRenderer[] = [];
afterEach(async () => { await act(async () => { for (const tree of mounted.splice(0)) tree.unmount(); }); });
beforeEach(() => {
  resetCongregationStore(); side.current = 'main';
  for (const fn of [...Object.values(api), ...Object.values(devotionApi)]) fn.mockClear();
});

async function screen() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(React.createElement(ProgressScreen)); mounted.push(tree); });
  await act(async () => { await Promise.resolve(); });
  return tree;
}
const textOf = (node: TestRenderer.ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(textOf).join('');
const texts = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => String(node.type) === 'Text' && String(node.parent?.type) !== 'Text').map(textOf);
const pressable = (tree: TestRenderer.ReactTestRenderer, label: string, role?: string) => tree.root.find((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label && (role === undefined || node.props.accessibilityRole === role));
const press = async (node: TestRenderer.ReactTestInstance) => { await act(async () => { if (!node.props.disabled) await node.props.onPress(); }); await act(async () => { await Promise.resolve(); }); };

describe('積分頁: where I meet', () => {
  it('puts one line under 團體 that says where I count, with its own 改', async () => {
    const tree = await screen();
    const lines = texts(tree);
    expect(lines).toContain('我在主堂聚會 (不是青少)');
    expect(lines.indexOf('團體')).toBeLessThan(lines.indexOf('我在主堂聚會 (不是青少)'));
    expect(lines.indexOf('我在主堂聚會 (不是青少)')).toBeLessThan(lines.indexOf('全教會一起讀經'));
    expect(textOf(pressable(tree, '改我在哪裡聚會'))).toBe('改');
  });

  it('opens the group card on my own side and lets me look at the other one', async () => {
    const tree = await screen();
    // The own side is asked without naming it; the other side is asked by name, ahead of the tap (2026-10-23).
    expect(devotionApi.getGroupReading.mock.calls.some((call) => call.length === 1)).toBe(true);
    expect(devotionApi.getGroupReading.mock.calls.some((call) => call[1] === 'youth')).toBe(true);
    await press(pressable(tree, '青少', 'tab'));
    expect(texts(tree)).toEqual(expect.arrayContaining(['青少一起讀經', '我在主堂聚會 (不是青少)，這裡只是看看青少。']));
    await press(pressable(tree, '全教會', 'tab'));
    expect(texts(tree)).toContain('全教會一起讀經');
    expect(texts(tree).join('')).not.toContain('只是看看');
    expect(devotionApi.setCongregation).not.toHaveBeenCalled();
  });

  it('opens the prize picker on my own side and shows the other side without letting me pick it', async () => {
    const tree = await screen();
    await act(async () => { tree.root.findByType('ScoreProfile' as any).props.onChooseReward(); });
    expect(pressable(tree, '主堂獎品', 'tab').props.accessibilityState).toMatchObject({ selected: true });
    expect(texts(tree)).toContain('主堂的獎品還沒上架。同工在試算表「主堂獎品」分頁加上後，這裡就會出現。');
    await press(pressable(tree, '青少獎品', 'tab'));
    expect(api.getRewards).toHaveBeenCalledWith('youth');
    expect(texts(tree)).toEqual(expect.arrayContaining(['電影票', '我在主堂聚會 (不是青少)，青少的獎品看得到、不能選。']));
    expect(tree.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'radio')).toHaveLength(0);
  });

  it('after 改, shows the new side and no longer treats a prize from the side I left as my target', async () => {
    side.current = 'youth';
    const tree = await screen();
    expect(tree.root.findByType('ScoreProfile' as any).props.profile.private.targetReward?.name).toBe('電影票');
    const profileReads = api.getProfile.mock.calls.length;
    await press(pressable(tree, '改我在哪裡聚會'));
    await press(pressable(tree, '主堂，社青、家長、長輩'));
    await press(pressable(tree, '改成：我在主堂聚會 (不是青少)'));
    expect(devotionApi.setCongregation).toHaveBeenCalledWith('main');
    expect(texts(tree)).toContain('我在主堂聚會 (不是青少)');
    expect(api.getProfile.mock.calls.length).toBeGreaterThan(profileReads);
    expect(tree.root.findByType('ScoreProfile' as any).props.profile.private.targetReward).toBeNull();
    expect(texts(tree)).toContain('全教會一起讀經');
  });
});

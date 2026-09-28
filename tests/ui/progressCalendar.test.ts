import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { primitive, api, auth, readingDays, completion } = vi.hoisted(() => ({
  primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children),
  api: {
    getCapabilities: vi.fn(async () => ({ canViewAllScores: false, canManageRewards: false, canRedeemRewards: false })),
    getProfile: vi.fn(async (memberId: string, scope: string = 'me', _month?: string, query?: { range: string }) => ({
      memberId, displayName: memberId === 'self' ? '光佑' : '小明', earnedTotal: 11, band: null, months: [],
      chart: { range: query?.range ?? 'month', anchor: null, periodStart: '2026-09-01', periodEnd: '2026-09-30', earnedPoints: 11, openingEarnedPoints: 0, previousAnchor: null, nextAnchor: null, buckets: [{ key: '2026-09-01', startDate: '2026-09-01', endDate: '2026-09-01', earnedPoints: 1, cumulativeEarnedPoints: 1 }] },
      permissions: { canEditTarget: memberId === 'self', canRedeem: false },
      ...(scope === 'me' ? { private: { redeemableBalance: 11, targetReward: null } } : {}),
    })),
    getPeople: vi.fn(async () => [{ memberId: 'friend', displayName: '小明', earnedTotal: 3 }]),
    getRewards: vi.fn(async () => []),
    getNominations: vi.fn(async () => ({ round: { roundId: 'r1', title: '9 月獎品', closesAt: Date.parse('2026-10-06T00:00:00Z'), phase: 'VOTING' }, nominations: [], votesLeft: 3, votesPerMember: 3 })),
    getCommunityProgress: vi.fn(async () => ({ books: ['提多書'], personDays: null, currentBook: null })),
  },
  auth: { status: 'signed-in', session: { memberId: 'self', sessionToken: 'token' }, profile: null, profileStatus: 'ready', epoch: 1 },
  readingDays: vi.fn(),
  completion: { options: [] as Array<{ planId: string; taskDate: string; canComplete: boolean; onConfirmed?: (event: unknown) => void }>, complete: vi.fn(), requestUndo: vi.fn() },
}));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) }, Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'), Text: primitive('Text'), TextInput: primitive('TextInput'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Circle: el('Circle'), Polyline: el('Polyline') }; });
vi.mock('expo-router', () => ({ useFocusEffect: (callback: () => (() => void) | void) => { require('react').useEffect(callback, []); } }));
vi.mock('expo-local-authentication', () => ({ authenticateAsync: vi.fn(async () => ({ success: true })) }));
vi.mock('../../src/services/authSession', () => ({ getAuthSnapshot: () => auth, isCurrentAuthSession: () => true, registerAuthLifecycleListener: () => vi.fn(), useAuthSnapshot: () => auth }));
vi.mock('../../src/services/gamificationApiClient', () => ({ GamificationApiError: class extends Error {}, createGamificationApiClient: () => api }));
vi.mock('../../src/services/apiClient', () => ({ createApiClient: () => ({ getReadingDays: readingDays }) }));
vi.mock('../../src/ui/CompletionAwardFeedback', () => ({ CompletionAwardFeedback: () => null }));
vi.mock('../../src/ui/gamification/ActionSheet', () => ({ ActionSheet: (props: any) => props.visible ? React.createElement('ActionSheet', props, props.children) : null }));
vi.mock('../../src/ui/gamification/PeopleList', () => ({ PeopleList: (props: any) => React.createElement('PeopleList', props) }));
vi.mock('../../src/ui/gamification/FriendQrPanel', () => ({ FriendQrPanel: (props: any) => React.createElement('FriendQrPanel', props) }));
// The shared completion hook, reduced to what the page gives it and what it hands back: a record per
// day that flips the moment complete() is pressed, exactly as the real one does before its sync.
vi.mock('../../src/services/useCompletionController', () => ({
  useCompletionController: (options: { planId: string; taskDate: string; canComplete: boolean; onConfirmed?: (event: unknown) => void }) => {
    const React = require('react');
    const [done, setDone] = React.useState(new Set<string>());
    completion.options.push(options);
    const status = done.has(options.taskDate) ? 'COMPLETED' : 'UNREPORTED';
    return {
      record: { memberId: 'self', planId: options.planId, taskDate: options.taskDate, status, revision: status === 'COMPLETED' ? 1 : 0, syncStatus: status === 'COMPLETED' ? 'PENDING_SAVE' : 'CONFIRMED' },
      pending: false, syncError: false, retryable: false,
      complete: async () => { completion.complete(options.taskDate); setDone((current: Set<string>) => new Set([...current, options.taskDate])); },
      requestUndo: () => completion.requestUndo(options.taskDate),
    };
  },
}));

import ProgressScreen from '../../app/(tabs)/progress';

const DONE = new Set(['2026-09-11', '2026-09-12', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-26']);
function serverDays(from: string, to: string) {
  const days = [];
  for (let cursor = new Date(`${from}T12:00:00Z`); cursor.toISOString().slice(0, 10) <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const taskDate = cursor.toISOString().slice(0, 10);
    if (cursor.getUTCDay() === 0) continue;
    const age = Math.round((Date.parse('2026-09-27T12:00:00Z') - cursor.getTime()) / 86_400_000);
    days.push({ taskDate, planId: `church-${taskDate.slice(0, 7)}`, references: taskDate === '2026-09-25' ? ['TIT.1', 'TIT.2', 'PSA.101'] : ['PSA.1'], sourceRevision: 1, sourceDigest: 'd', status: DONE.has(taskDate) ? 'COMPLETED' : 'UNREPORTED', revision: DONE.has(taskDate) ? 1 : 0, canComplete: age >= 0 && age < 7 });
  }
  return { today: '2026-09-27', timezone: 'Asia/Taipei', days };
}

let renderer: TestRenderer.ReactTestRenderer | null = null;
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-27T04:00:00.000Z')); });
afterAll(() => { vi.useRealTimers(); });
afterEach(() => { act(() => { renderer?.unmount(); }); renderer = null; completion.options.length = 0; });

async function mount() {
  readingDays.mockImplementation(async (from: string, to: string) => serverDays(from, to));
  await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen)); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return renderer!;
}
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...([] as unknown[]).concat(style as unknown[]).filter(Boolean));
const cell = (date: string) => renderer!.root.findAll((node) => (node.type as unknown) === 'Pressable' && String(node.props.accessibilityLabel ?? '').startsWith(`${date} `))[0];
const texts = () => renderer!.root.findAll((node) => (node.type as unknown) === 'Text').map((node) => node.children.join(''));
// The completion button, not a calendar cell (whose label starts with its date).
const isCompletionButton = (node: TestRenderer.ReactTestInstance) => (node.type as unknown) === 'Pressable' && node.props?.accessibilityRole === 'button' && /讀經/.test(String(node.props.accessibilityLabel ?? '')) && !/^\d{4}-/.test(String(node.props.accessibilityLabel));
const buttons = () => renderer!.root.findAll(isCompletionButton);
const lastOptions = () => completion.options[completion.options.length - 1];

describe('the 積分 page opens on its calendar', () => {
  it('scrolls as one page: calendar, prize banner, reward goal, trend, community — with no button above it', async () => {
    await mount();
    const scroll = renderer!.root.findByType('ScrollView' as never);
    const order = (scroll.children as TestRenderer.ReactTestInstance[]).map((child) => (child.type as { name?: string }).name ?? String(child.type));
    expect(order.slice(0, 5)).toEqual(['ReadingCalendarCard', 'NominationBanner', 'RewardGoalCard', 'ScoreProfileChart', 'CommunityProgress']);
    // The only completion button on the page is the calendar's.
    expect(buttons()).toHaveLength(1);
    expect(scroll.findAll(isCompletionButton)).toHaveLength(1);
    expect(texts()).not.toContain('今天沒有可完成的讀經');
  });

  it('selects the most recent unfinished day when today (a Sunday) has no reading, and completes that day', async () => {
    await mount();
    expect(texts()).toEqual(expect.arrayContaining(['9/25（五）', '多1、多2、詩101']));
    expect(cell('2026-09-25').props.accessibilityState).toEqual({ selected: true });
    expect(lastOptions()).toMatchObject({ taskDate: '2026-09-25', planId: 'church-2026-09', canComplete: true });
    const [button] = buttons();
    expect(button.props.accessibilityLabel).toBe('我已完成讀經');
    await act(async () => { button.props.onPress(); await Promise.resolve(); });
    expect(completion.complete).toHaveBeenCalledWith('2026-09-25');
    // The day turns green at once, before any refetch.
    expect(flat(cell('2026-09-25').props.style).backgroundColor).toBe('#1A5544');
    expect(buttons()[0].props.accessibilityLabel).toBe('這天讀經已完成');
  });

  it('says in one line why an old, a rest or a future day has no button', async () => {
    await mount();
    for (const [date, line] of [['2026-09-10', '9/10（四）已超過 7 天，不能補登'], ['2026-09-20', '9/20（日）這天沒有讀經'], ['2026-09-29', '9/29（二）還沒到，當天再來打卡']]) {
      await act(async () => { cell(date).props.onPress(); });
      expect(texts()).toContain(line);
      expect(buttons()).toHaveLength(0);
    }
  });

  it('offers the undo on a finished day, through the same controller', async () => {
    await mount();
    await act(async () => { cell('2026-09-26').props.onPress(); });
    expect(lastOptions()).toMatchObject({ taskDate: '2026-09-26' });
    const [button] = buttons();
    expect(button.props.accessibilityLabel).toBe('這天讀經已完成');
  });

  it('paints a day confirmed elsewhere on the page the moment its sync event lands', async () => {
    await mount();
    expect(flat(cell('2026-09-24').props.style).backgroundColor).not.toBe('#1A5544');
    await act(async () => { lastOptions().onConfirmed?.({ memberId: 'self', planId: 'church-2026-09', taskDate: '2026-09-24', operationId: 'op-24', status: 'COMPLETED' }); });
    expect(flat(cell('2026-09-24').props.style).backgroundColor).toBe('#1A5544');
  });

  it('keeps its own days when the trend card moves to 年', async () => {
    await mount();
    await act(async () => { renderer!.root.findByProps({ accessibilityLabel: '年' }).props.onPress(); await Promise.resolve(); });
    // The page also prefetches the other ranges on a timer after its first load: on a slow machine the
    // year chart is either fetched by the tap or already cached by that prefetch. Either way it was read.
    expect(api.getProfile.mock.calls).toContainEqual(['self', 'me', expect.any(String), { range: 'year' }]);
    expect(flat(cell('2026-09-26').props.style).backgroundColor).toBe('#1A5544');
    expect(renderer!.root.findAll((node) => (node.type as unknown) === 'Pressable' && /^2026-09-\d{2} /.test(String(node.props.accessibilityLabel ?? '')))).toHaveLength(30);
    // And the own trend card has no 走勢/日曆 toggle.
    expect(renderer!.root.findAll((node) => node.props.accessibilityLabel === '日曆')).toHaveLength(0);
  });

  it('pages by month through the reading-days schedule, not before the plan began', async () => {
    await mount();
    expect(renderer!.root.findByProps({ accessibilityLabel: '上個月' }).props.disabled).toBe(true);
    await act(async () => { renderer!.root.findByProps({ accessibilityLabel: '下個月' }).props.onPress(); await Promise.resolve(); await Promise.resolve(); });
    expect(readingDays).toHaveBeenLastCalledWith('2026-10-01', '2026-10-31');
    expect(texts()).toContain('2026年10月');
    // The selected day and its button stay where they were.
    expect(buttons()[0].props.accessibilityLabel).toBe('我已完成讀經');
    await act(async () => { renderer!.root.findByProps({ accessibilityLabel: '上個月' }).props.onPress(); await Promise.resolve(); await Promise.resolve(); });
    expect(texts()).toContain('2026年9月');
  });

  it('shows friends’ pages without the calendar, and with their toggle', async () => {
    await mount();
    await act(async () => { renderer!.root.findAll((node) => node.props.accessibilityLabel === '好友')[0].props.onPress(); });
    const list = renderer!.root.findByType('PeopleList' as never);
    await act(async () => { list.props.onSelect(list.props.people[0]); await Promise.resolve(); });
    expect(renderer!.root.findAll((node) => (node.type as { name?: string }).name === 'ReadingCalendarCard')).toHaveLength(0);
    expect(renderer!.root.findAll((node) => node.props.accessibilityLabel === '日曆').length).toBeGreaterThan(0);
    expect(buttons()).toHaveLength(0);
  });
});

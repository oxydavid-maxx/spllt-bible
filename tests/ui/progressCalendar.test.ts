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
  },
  auth: { status: 'signed-in', session: { memberId: 'self', sessionToken: 'token' }, profile: null, profileStatus: 'ready', epoch: 1 },
  readingDays: vi.fn(),
  completion: { options: [] as Array<{ planId: string; taskDate: string; canComplete: boolean; onConfirmed?: (event: unknown) => void }>, complete: vi.fn(), requestUndo: vi.fn() },
}));
const navigation = vi.hoisted(() => ({ replace: vi.fn(), listeners: new Set<(state: string) => void>() }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: vi.fn((_: string, fn: (state: string) => void) => { navigation.listeners.add(fn); return { remove: () => navigation.listeners.delete(fn) }; }) }, Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'), Text: primitive('Text'), TextInput: primitive('TextInput'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Circle: el('Circle'), Polyline: el('Polyline'), Path: el('Path'), Rect: el('Rect'), G: el('G'), Line: el('Line'), Text: el('SvgText') }; });
// 團體 and the history chart are served only by a newer backend: absent by default, as on the old one.
const devotionApi = vi.hoisted(() => ({
  getDevotionDates: vi.fn(async (): Promise<string[]> => []),
  setDevotion: vi.fn(async (): Promise<void> => undefined),
  getGroupReading: vi.fn(async (): Promise<unknown> => { throw new Error('not served'); }),
  getScoreHistory: vi.fn(async (): Promise<unknown> => { throw new Error('not served'); }),
  getDevotional: vi.fn(async () => null),
}));
vi.mock('../../src/services/devotionClient', () => ({ createDevotionClient: () => devotionApi }));
vi.mock('expo-router', () => ({ router: navigation, useFocusEffect: (callback: () => (() => void) | void) => { require('react').useEffect(callback, []); } }));
vi.mock('../../src/ui/ReadingPlanSheet', () => ({ ReadingPlanSheet: (props: any) => props.visible ? require('react').createElement('ReadingPlanSheet', props) : null }));
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
      getCompletionRecord: (planId: string, taskDate: string) => done.has(taskDate) ? { memberId: 'self', planId, taskDate, status: 'COMPLETED', revision: 1, syncStatus: 'PENDING_SAVE' } : undefined,
      pending: false, syncError: false, retryable: false,
      complete: async () => { completion.complete(options.taskDate); setDone((current: Set<string>) => new Set([...current, options.taskDate])); },
      requestUndo: () => completion.requestUndo(options.taskDate),
    };
  },
}));

const cardExport = vi.hoisted(() => ({ load: vi.fn(async (_memberId: string, _plan: unknown) => [{ date: '2026-09-25', rows: ['多01章', '詩101'], completed: true, devoted: true }]), share: vi.fn(async (_html: string, _owns?: () => boolean) => undefined) }));
vi.mock('../../src/services/readingCardSnapshot', () => ({ loadReadingCardSnapshot: cardExport.load }));
vi.mock('../../src/ui/readingCardShare', () => ({ shareReadingCard: cardExport.share }));
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

// The page's one scroller, as the native ScrollView would hand it to a ref.
const pageScroll = { scrollTo: vi.fn() };
async function mount() {
  readingDays.mockImplementation(async (from: string, to: string) => serverDays(from, to));
  await act(async () => { renderer = TestRenderer.create(React.createElement(ProgressScreen), { createNodeMock: (element) => element.type === 'ScrollView' ? pageScroll : null }); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return renderer!;
}
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...([] as unknown[]).concat(style as unknown[]).filter(Boolean));
const cell = (date: string) => renderer!.root.findAll((node) => (node.type as unknown) === 'Pressable' && String(node.props.accessibilityLabel ?? '').startsWith(`${date} `))[0];
const texts = () => renderer!.root.findAll((node) => (node.type as unknown) === 'Text').map((node) => node.children.join(''));
// The completion button, not a calendar cell (whose label starts with its date).
const isCompletionButton = (node: TestRenderer.ReactTestInstance) => (node.type as unknown) === 'Pressable' && node.props?.accessibilityRole === 'button' && /讀經/.test(String(node.props.accessibilityLabel ?? '')) && node.props.accessibilityLabel !== '匯出讀經卡' && !/^\d{4}-/.test(String(node.props.accessibilityLabel));
const buttons = () => renderer!.root.findAll(isCompletionButton);
const lastOptions = () => completion.options[completion.options.length - 1];
const byName = (name: string) => renderer!.root.findAll((node) => (node.type as { name?: string }).name === name);
const scrollOrder = () => (renderer!.root.findByType('ScrollView' as never).children as TestRenderer.ReactTestInstance[]).map((child) => (child.type as { name?: string }).name ?? String(child.type));

describe('the 積分 page opens on its calendar', () => {
  it('opens the shared plan from any calendar day and switches to the chosen reading date', async () => {
    await mount();
    await act(async () => cell('2026-09-29').props.onPress());
    act(() => renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '整份計畫')[0].props.onPress());
    const sheet = renderer!.root.findByType('ReadingPlanSheet' as never);
    act(() => { sheet.props.onClose(); sheet.props.onSelectDate('2026-10-15'); });
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith('/reader');
    expect((await import('../../src/ui/readingSession')).getReadingSessionSnapshot().selectedDate).toBe('2026-10-15');
    expect(renderer!.root.findAllByType('ReadingPlanSheet' as never)).toHaveLength(0);
  });
  it('scrolls as one page: the day card, then 團體, then 個人 with the calendar, reward goal and chart (維護者 2026-10-19)', async () => {
    devotionApi.getGroupReading.mockResolvedValueOnce({ month: '2026-09', today: '2026-09-27', todayReaders: null, yesterdayReaders: 4, days: [], monthReads: 40, busiest: null, qualifyingDays: 15, prizes: [], myDaysThisMonth: 3 });
    devotionApi.getScoreHistory.mockResolvedValueOnce({ from: '2026-09-01', today: '2026-09-27', points: [0, 1, 2], devotions: [0, 0, 1], months: [{ month: '2026-09', points: 2, devotionDays: 1 }] });
    await mount();
    const scroll = renderer!.root.findByType('ScrollView' as never);
    const order = scrollOrder();
    expect(order.slice(0, 7)).toEqual(['SelectedDayCard', 'SectionHeader', 'GroupReadingCard', 'SectionHeader', 'ReadingCalendarCard', 'RewardGoalCard', 'ScoreHistoryCard']);
    expect(scroll.children.filter((child) => typeof child !== 'string' && (child.type as { name?: string }).name === 'SectionHeader').map((child) => (child as TestRenderer.ReactTestInstance).props.title)).toEqual(['團體', '個人']);
    // 一起走過 is gone, and 全體 is not a tab any more: only 自己 and 好友.
    expect(order).not.toContain('CommunityProgress');
    const tabs = renderer!.root.findAll((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'tab').map((node) => node.props.accessibilityLabel);
    expect(tabs).toEqual(['自己', '好友', '總積分', '每月']);
    // The only completion button on the page is the day card's.
    expect(buttons()).toHaveLength(1);
    expect(scroll.findAll(isCompletionButton)).toHaveLength(1);
    expect(byName('SelectedDayCard')[0].findAll(isCompletionButton)).toHaveLength(1);
    expect(texts()).not.toContain('今天沒有可完成的讀經');
  });

  it('selects the most recent unfinished day when today (a Sunday) has no reading, and completes that day', async () => {
    await mount();
    expect(texts()).toEqual(expect.arrayContaining(['9/25 (五)', '多1、多2、詩101']));
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
    for (const [date, line] of [['2026-09-10', '9/10 (四) 已超過 7 天，不能補登'], ['2026-09-20', '9/20 (日) 這天沒有讀經'], ['2026-09-29', '9/29 (二) 還沒到，當天再來打卡']]) {
      await act(async () => { cell(date).props.onPress(); });
      expect(texts()).toContain(line);
      expect(buttons()).toHaveLength(0);
      if (date !== '2026-09-20') expect(texts()).toContain('詩1');
      else expect(texts()).not.toContain('詩1');
    }
  });

  it('shows only the no-reading explanation for a future Sunday, with no completion action or passages', async () => {
    await mount();
    await act(async () => { renderer!.root.findByProps({ accessibilityLabel: '下個月' }).props.onPress(); await Promise.resolve(); });
    await act(async () => cell('2026-10-04').props.onPress());
    expect(texts()).toContain('10/4 (日) 這天沒有讀經');
    expect(texts()).not.toContain('詩1');
    expect(texts().join('')).not.toContain('10/4 (日) 還沒到');
    expect(buttons()).toHaveLength(0);
  });

  it('marks 靈修 with the gold button: the cell gets its mark, the reading completion is untouched, a failure puts it back', async () => {
    // The server's 靈修 days, kept by the same calls the page makes.
    const served = new Set(['2026-09-24']);
    devotionApi.getDevotionDates.mockImplementation(async () => [...served]);
    devotionApi.setDevotion.mockImplementation(async (...args: unknown[]) => { const [date, done] = args as [string, boolean]; if (done) served.add(date); else served.delete(date); });
    await mount();
    expect(cell('2026-09-24').props.accessibilityLabel).toContain('也讀了靈修');
    expect(cell('2026-09-24').findAll((node) => (node.type as unknown) === 'Text' && node.children.join('') === '靈修')).toHaveLength(1);
    const gold = () => renderer!.root.findAll((node) => (node.type as unknown) === 'Pressable' && /靈修/.test(String(node.props.accessibilityLabel ?? '')) && !/^\d{4}-/.test(String(node.props.accessibilityLabel)))[0];
    expect(gold().props.accessibilityLabel).toBe('我已讀了靈修');
    await act(async () => { gold().props.onPress(); await Promise.resolve(); });
    expect(devotionApi.setDevotion).toHaveBeenCalledWith('2026-09-25', true);
    expect(completion.complete).not.toHaveBeenCalledWith('2026-09-25');
    expect(cell('2026-09-25').props.accessibilityLabel).toContain('也讀了靈修');
    expect(gold().props.accessibilityLabel).toBe('這天靈修已完成');
    devotionApi.setDevotion.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { gold().props.onPress(); await Promise.resolve(); await Promise.resolve(); });
    expect(devotionApi.setDevotion).toHaveBeenLastCalledWith('2026-09-25', false);
    expect(cell('2026-09-25').props.accessibilityLabel).toContain('也讀了靈修');
    expect(served.has('2026-09-25')).toBe(true);
    devotionApi.getDevotionDates.mockImplementation(async () => []);
    devotionApi.setDevotion.mockImplementation(async () => undefined);
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

  it('opens export from the own calendar and shares the selected period without another API read', async () => {
    await mount();
    const before = readingDays.mock.calls.length;
    act(() => renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '匯出讀經卡')[0].props.onPress());
    expect(texts()).toContain('本月 (9 月)');
    expect(texts()).toContain('本季 (7–9 月)');
    await act(async () => renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '本月 (9 月)')[0].props.onPress());
    expect(cardExport.load).toHaveBeenCalledWith('self', expect.any(Object));
    expect(cardExport.share).toHaveBeenCalledWith(expect.stringContaining('paper one'), expect.stringMatching(/^讀經卡-.+-202609\.pdf$/), expect.any(Function));
    expect(readingDays.mock.calls.length).toBe(before);
    expect(texts()).not.toContain('本月 (9 月)');
    act(() => renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '匯出讀經卡')[0].props.onPress());
    await act(async () => renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '本季 (7–9 月)')[0].props.onPress());
    expect(cardExport.share).toHaveBeenLastCalledWith(expect.stringContaining('paper quarter'), expect.stringMatching(/^讀經卡-.+-2026第三季\.pdf$/), expect.any(Function));
  });

  it('preserves a local completion snapshot for a different day instead of overwriting it with the older screen schedule', async () => {
    await mount();
    act(() => cell('2026-09-26').props.onPress());
    act(() => renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '匯出讀經卡')[0].props.onPress());
    await act(async () => renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '本月 (9 月)')[0].props.onPress());
    const html = cardExport.share.mock.calls.at(-1)![0];
    const cellHtml = /data-date="2026-09-25"(.*?)<\/td>/.exec(html)![1];
    expect(cellHtml).toContain('class="box">✔');
  });

  it('prevents duplicate exports and keeps failures retryable', async () => {
    await mount();
    act(() => renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '匯出讀經卡')[0].props.onPress());
    let reject!: (reason: Error) => void;
    cardExport.load.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const press = renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '本月 (9 月)')[0].props.onPress;
    await act(async () => { press(); press(); });
    expect(cardExport.load).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '本季 (7–9 月)')[0].props.disabled).toBe(true);
    await act(async () => { reject(new Error('產生失敗，請重試。')); });
    expect(texts()).toContain('產生失敗，請重試。');
    expect(renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '本月 (9 月)')[0].props.disabled).toBe(false);
    expect(cardExport.share).not.toHaveBeenCalled();
    await act(async () => renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '本月 (9 月)')[0].props.onPress());
    expect(cardExport.share).toHaveBeenCalledOnce();
  });

  it('does not share a pending snapshot after its sheet closes or the account changes', async () => {
    await mount();
    act(() => renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '匯出讀經卡')[0].props.onPress());
    let resolve!: (days: Array<{ date: string; rows: string[]; completed: boolean; devoted: boolean }>) => void;
    cardExport.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await act(async () => renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '本月 (9 月)')[0].props.onPress());
    const sheet = renderer!.root.findAll(node => String(node.type) === 'ActionSheet' && node.props.title === '匯出讀經卡')[0];
    act(() => sheet.props.onClose());
    await act(async () => resolve([{ date: '2026-09-25', rows: ['門'], completed: true, devoted: false }]));
    expect(cardExport.share).not.toHaveBeenCalled();
    act(() => renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '匯出讀經卡')[0].props.onPress());
    cardExport.load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await act(async () => renderer!.root.findAll(node => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '本月 (9 月)')[0].props.onPress());
    const oldEpoch = auth.epoch; auth.epoch += 1;
    await act(async () => resolve([{ date: '2026-09-25', rows: ['門'], completed: true, devoted: false }]));
    expect(cardExport.share).not.toHaveBeenCalled();
    auth.epoch = oldEpoch;
  });
});

// 維護者 2026-10-19: the day's two buttons sit at the very top, above 團體, and follow the day picked
// in the calendar below; a picked day other than today says 補登 and offers 回到今天.
describe('the day card at the top of 自己', () => {
  const at = (iso: string) => vi.setSystemTime(new Date(iso));
  afterEach(() => { at('2026-09-27T04:00:00.000Z'); });
  const card = () => byName('SelectedDayCard')[0];
  const calendar = () => byName('ReadingCalendarCard')[0];
  const textsOf = (node: TestRenderer.ReactTestInstance) => node.findAll((child) => (child.type as unknown) === 'Text').map((child) => child.children.join(''));
  const pressable = (node: TestRenderer.ReactTestInstance, label: string) => node.findAll((child) => (child.type as unknown) === 'Pressable' && child.props.accessibilityLabel === label);
  // The 靈修 and the 讀經 button, not a calendar cell or a footer link.
  const dayButtons = (node: TestRenderer.ReactTestInstance) => node.findAll((child) => (child.type as unknown) === 'Pressable' && /讀經|靈修/.test(String(child.props.accessibilityLabel ?? '')) && child.props.accessibilityLabel !== '匯出讀經卡' && !/^\d{4}-/.test(String(child.props.accessibilityLabel))).map((child) => child.props.accessibilityLabel);
  const nextMonth = async () => { await act(async () => { renderer!.root.findByProps({ accessibilityLabel: '下個月' }).props.onPress(); await Promise.resolve(); await Promise.resolve(); }); };

  it('comes straight before the calendar when the backend serves no 團體', async () => {
    await mount();
    expect(scrollOrder().slice(0, 3)).toEqual(['SelectedDayCard', 'ReadingCalendarCard', 'RewardGoalCard']);
  });

  it('on today says 今天· with the date and passages, has both buttons, and neither 補登 nor 回到今天', async () => {
    at('2026-09-25T04:00:00.000Z');
    await mount();
    expect(textsOf(card())).toEqual(expect.arrayContaining(['今天·9/25 (五)', '多1、多2、詩101']));
    expect(dayButtons(card())).toEqual(['完成今日靈修', '完成今日讀經']);
    expect(textsOf(card())).not.toContain('補登');
    expect(pressable(card(), '回到今天')).toHaveLength(0);
  });

  it('follows a day tapped in the calendar: 補登 before its date, its buttons, one scroll back to the top, and 回到今天 brings today back', async () => {
    at('2026-09-25T04:00:00.000Z');
    await mount();
    pageScroll.scrollTo.mockClear();
    await act(async () => { cell('2026-09-24').props.onPress(); });
    const shown = textsOf(card());
    expect(shown).toEqual(expect.arrayContaining(['補登', '9/24 (四)', '詩1', '回到今天 ›']));
    expect(shown.indexOf('補登')).toBeLessThan(shown.indexOf('9/24 (四)'));
    expect(shown.join('')).not.toContain('今天·');
    expect(dayButtons(card())).toEqual(['我已讀了靈修', '我已完成讀經']);
    expect(lastOptions()).toMatchObject({ taskDate: '2026-09-24' });
    expect(pageScroll.scrollTo).toHaveBeenCalledExactlyOnceWith({ y: 0, animated: true });
    await act(async () => { pressable(card(), '回到今天')[0].props.onPress(); });
    expect(textsOf(card())).toContain('今天·9/25 (五)');
    expect(textsOf(card())).not.toContain('補登');
    expect(pressable(card(), '回到今天')).toHaveLength(0);
    expect(cell('2026-09-25').props.accessibilityState).toEqual({ selected: true });
    expect(lastOptions()).toMatchObject({ taskDate: '2026-09-25' });
  });

  it('brings the calendar back to this month with 回到今天', async () => {
    at('2026-09-25T04:00:00.000Z');
    await mount();
    await nextMonth();
    await act(async () => { cell('2026-10-02').props.onPress(); });
    expect(texts()).toContain('2026年10月');
    await act(async () => { pressable(card(), '回到今天')[0].props.onPress(); await Promise.resolve(); await Promise.resolve(); });
    expect(texts()).toContain('2026年9月');
    expect(textsOf(card())).toContain('今天·9/25 (五)');
  });

  it('gives an old or a future day one line and no buttons', async () => {
    await mount();
    for (const [date, line] of [['2026-09-10', '9/10 (四) 已超過 7 天，不能補登'], ['2026-09-29', '9/29 (二) 還沒到，當天再來打卡']]) {
      await act(async () => { cell(date).props.onPress(); });
      expect(textsOf(card())).toContain(line);
      expect(dayButtons(card())).toEqual([]);
      // Nothing to backfill on such a day, so no 補登 either; 回到今天 still leads back.
      expect(textsOf(card())).not.toContain('補登');
      expect(pressable(card(), '回到今天')).toHaveLength(1);
    }
  });

  it('leaves the calendar card without the selected day or its buttons, keeping 匯出讀經卡 and 整份計畫', async () => {
    await mount();
    expect(dayButtons(calendar())).toEqual([]);
    expect(textsOf(calendar())).not.toContain('9/25 (五)');
    expect(textsOf(calendar())).not.toContain('多1、多2、詩101');
    expect(pressable(calendar(), '匯出讀經卡')).toHaveLength(1);
    expect(pressable(calendar(), '整份計畫')).toHaveLength(1);
    // The day the page opened on (9/25, today 9/27 having no reading) is at the top instead.
    expect(textsOf(card())).toEqual(expect.arrayContaining(['補登', '9/25 (五)', '多1、多2、詩101']));
  });

  it('moves to the new today after Taipei midnight, before the schedule answers, unless a day was picked', async () => {
    const foreground = async () => {
      await act(async () => { navigation.listeners.forEach(fn => fn('background')); });
      await act(async () => { navigation.listeners.forEach(fn => fn('active')); });
    };
    at('2026-09-25T15:59:00.000Z');
    await mount();
    expect(textsOf(card())).toContain('今天·9/25 (五)');
    // The refetch after midnight never answers (offline): the card must not wait for it.
    readingDays.mockImplementation(() => new Promise(() => undefined));
    at('2026-09-25T16:01:00.000Z');
    await foreground();
    expect(textsOf(card())).toContain('今天·9/26 (六)');
    expect(textsOf(card())).not.toContain('補登');
    expect(lastOptions()).toMatchObject({ taskDate: '2026-09-26' });
    // A day the member picked stays picked across midnight.
    await act(async () => { cell('2026-09-24').props.onPress(); });
    at('2026-09-26T16:01:00.000Z');
    await foreground();
    expect(textsOf(card())).toEqual(expect.arrayContaining(['補登', '9/24 (四)']));
  });
});

it('updates the rendered calendar today and group today after Taipei midnight, with one read per foreground (5)', async () => {
  const { GroupReadingCard } = await import('../../src/ui/gamification/GroupReadingCard');
  const { ReadingCalendarCard } = await import('../../src/ui/gamification/ReadingCalendarCard');
  vi.setSystemTime(new Date('2026-09-27T15:59:00Z'));
  const groupView = () => ({ month: '2026-09', today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()), todayReaders: 7, yesterdayReaders: 4, days: [], monthReads: 40, busiest: null, qualifyingDays: 15, prizes: [], myDaysThisMonth: 3 });
  devotionApi.getGroupReading.mockImplementation(async () => groupView());
  await mount(); const reads = devotionApi.getGroupReading.mock.calls.length; const days = readingDays.mock.calls.length;
  vi.setSystemTime(new Date('2026-09-27T16:01:00Z'));
  expect(devotionApi.getGroupReading).toHaveBeenCalledTimes(reads);
  await act(async () => { navigation.listeners.forEach(fn => fn('background')); });
  await act(async () => { navigation.listeners.forEach(fn => fn('active')); });
  expect(renderer!.root.findByType(ReadingCalendarCard).props.today).toBe('2026-09-28');
  expect(renderer!.root.findByType(GroupReadingCard).props.view.today).toBe('2026-09-28');
  expect(devotionApi.getGroupReading).toHaveBeenCalledTimes(reads + 1);
  expect(readingDays).toHaveBeenCalledTimes(days + 1);
  await act(async () => { navigation.listeners.forEach(fn => fn('active')); });
  expect(devotionApi.getGroupReading).toHaveBeenCalledTimes(reads + 1);
  expect(readingDays).toHaveBeenCalledTimes(days + 1);
  devotionApi.getGroupReading.mockReset().mockRejectedValue(new Error('not served'));
  vi.setSystemTime(new Date('2026-09-27T04:00:00Z'));
});

it('revalidates progress administrator capability on visible foreground and ignores idle time (8)', async () => {
  const { requestOpenAllScores } = await import('../../src/services/allScoresRequest');
  api.getCapabilities.mockResolvedValue({ canViewAllScores: false, canManageRewards: false, canRedeemRewards: false });
  await mount(); const reads = api.getCapabilities.mock.calls.length;
  vi.useFakeTimers(); await act(async () => { await vi.advanceTimersByTimeAsync(600_000); }); expect(api.getCapabilities).toHaveBeenCalledTimes(reads);
  api.getCapabilities.mockResolvedValue({ canViewAllScores: true, canManageRewards: false, canRedeemRewards: false });
  await act(async () => { navigation.listeners.forEach(fn => fn('background')); });
  await act(async () => { navigation.listeners.forEach(fn => fn('active')); });
  expect(api.getCapabilities).toHaveBeenCalledTimes(reads + 1);
  await act(async () => { requestOpenAllScores(); });
  expect(api.getPeople).toHaveBeenLastCalledWith('all');
  expect(texts()).toContain('全體 (管理)');
  api.getCapabilities.mockResolvedValue({ canViewAllScores: false, canManageRewards: false, canRedeemRewards: false });
  await act(async () => { navigation.listeners.forEach(fn => fn('background')); });
  await act(async () => { navigation.listeners.forEach(fn => fn('active')); });
  await act(async () => { requestOpenAllScores(); });
  expect(texts()).toContain('此功能僅限管理者。');
  vi.useRealTimers(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-27T04:00:00Z'));
});


it('keeps a pending completion visible on another calendar day while refreshing the server month (2)', async () => {
  await mount(); await act(async () => { cell('2026-09-25').props.onPress(); });
  await act(async () => { buttons()[0].props.onPress(); });
  expect(cell('2026-09-25').props.accessibilityLabel).toContain('已完成');
  await act(async () => { cell('2026-09-24').props.onPress(); });
  expect(cell('2026-09-25').props.accessibilityLabel).toContain('已完成');
  await act(async () => { navigation.listeners.forEach(fn => fn('background')); });
  await act(async () => { navigation.listeners.forEach(fn => fn('active')); });
  expect(cell('2026-09-25').props.accessibilityLabel).toContain('已完成');
});

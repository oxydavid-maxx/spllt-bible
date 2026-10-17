import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The 積分 page as decided on 2026-10-14: 團體 (group reading and prizes), the two day buttons, the
// one 總積分/每月 chart with the 靈修 dashed line, and 全體 (管理) moved to 我的帳戶.
const { primitive, nav, auth, gamification } = vi.hoisted(() => ({
  primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children),
  nav: { navigate: vi.fn() },
  auth: { status: 'signed-in', session: { memberId: 'self', sessionToken: 'token' }, profile: null, profileStatus: 'ready', epoch: 1 },
  gamification: { getCapabilities: vi.fn(async () => ({ canViewAllScores: false, canManageRewards: false, canRedeemRewards: false })) },
}));
vi.mock('react-native', () => ({ Pressable: primitive('Pressable'), Text: primitive('Text'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));
vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Circle: el('Circle'), Polyline: el('Polyline'), Path: el('Path'), Rect: el('Rect'), G: el('G'), Line: el('Line'), Text: el('SvgText') }; });
vi.mock('expo-router', () => ({ router: nav }));
vi.mock('../../src/services/authSession', () => ({ useAuthSnapshot: () => auth }));
vi.mock('../../src/services/gamificationApiClient', () => ({ createGamificationApiClient: () => gamification }));

import type { GroupReading, ScoreHistory } from '../../src/services/devotionClient';
import { GroupReadingCard } from '../../src/ui/gamification/GroupReadingCard';
import { monthSummary, myPrizeLine, readersLevel } from '../../src/ui/gamification/groupReadingModel';
import { ScoreHistoryCard } from '../../src/ui/gamification/ScoreHistoryCard';
import { monthBars, totalChart } from '../../src/ui/gamification/scoreHistoryModel';
import { buildDevotionButtonModel, DevotionTodayButton } from '../../src/ui/gamification/DevotionTodayButton';
import { AdminAllScoresEntry } from '../../src/ui/AdminAllScoresEntry';
import { consumeOpenAllScores } from '../../src/services/allScoresRequest';

const originalConsoleError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const message = String(args[0] ?? '');
    if (message.includes('react-test-renderer is deprecated') || message.includes('testing environment is not configured to support act')) return;
    originalConsoleError(...args);
  };
});
afterAll(() => { console.error = originalConsoleError; });

function render(element: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(element); });
  return tree;
}
// A line's whole words, nested bold runs included.
const textOf = (node: TestRenderer.ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(textOf).join('');
const texts = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => (node.type as unknown) === 'Text').map(textOf);

const group: GroupReading = {
  month: '2026-10', today: '2026-10-14', todayReaders: 7, yesterdayReaders: 15,
  days: [{ date: '2026-10-01', readers: 12 }, { date: '2026-10-02', readers: null }, { date: '2026-10-12', readers: 19 }, { date: '2026-10-13', readers: 15 }, { date: '2026-10-14', readers: 7 }],
  monthReads: 184, busiest: { date: '2026-10-12', readers: 19 }, qualifyingDays: 15,
  prizes: [
    { id: 'beanbag', name: '新的懶骨頭 (摩脫教室)', icon: 'beanbag', members: 15, months: 2, qualifiedThisMonth: 3, achievedMonths: 0 },
    { id: 'sofa', name: '新沙發', icon: 'sofa', members: 20, months: 4, qualifiedThisMonth: 3, achievedMonths: 0 },
  ],
  myDaysThisMonth: 6,
};

describe('團體: the group reading card', () => {
  it('shows today and yesterday, a number only on days with two or more readers, and the month in one line', () => {
    const tree = render(React.createElement(GroupReadingCard, { view: group }));
    const all = texts(tree);
    expect(all).toEqual(expect.arrayContaining(['青少一起讀經', '10 月', '今天 (還在進行)', '昨天', '不到 2 人的日子不顯示人數', '10 月到今天一起讀了 184 人次，最多的一天 19 人 (10/12)']));
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === '2026-10-02 不到 2 人')).not.toHaveLength(0);
    // The day with fewer than two readers carries its date only, no count.
    const few = tree.root.find((node) => (node.type as unknown) === 'View' && node.props.accessibilityLabel === '2026-10-02 不到 2 人');
    expect(few.findAll((node) => (node.type as unknown) === 'Text').map((node) => node.children.join(''))).toEqual(['2']);
    expect(tree.root.findAll((node) => (node.type as unknown) === 'View' && node.props.accessibilityLabel === '2026-10-12 19 人')).toHaveLength(1);
  });

  it('lists the prizes with the member’s own line under the first one, and nothing after them (2026-10-17)', () => {
    const all = texts(render(React.createElement(GroupReadingCard, { view: group })));
    expect(all).toEqual(expect.arrayContaining(['團體獎', '新的懶骨頭 (摩脫教室)', '0/2 個月', '15 人都讀滿一個月 (當月讀經 15 天)，累積 2 個月', '新沙發', '20 人都讀滿一個月，累積 4 個月', '你這個月讀了 6 天，再 9 天就算你一份']));
    expect(all).not.toContain('下一個獎品，由你決定');
    expect(all.filter((line) => line.includes('算你一份'))).toHaveLength(1);
    expect(all.join('')).not.toMatch(/靈修|\[|\]/);
  });

  it('pages months only where the screen allows', () => {
    const previous = vi.fn();
    const tree = render(React.createElement(GroupReadingCard, { view: group, onPreviousMonth: previous }));
    const back = tree.root.find((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === '上個月');
    const forward = tree.root.find((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === '下個月');
    expect(forward.props.disabled).toBe(true);
    act(() => back.props.onPress());
    expect(previous).toHaveBeenCalledOnce();
  });

  it('shades by the month’s busiest day and words the member’s line', () => {
    expect([readersLevel(null, 19), readersLevel(19, 19), readersLevel(9, 19), readersLevel(5, 19)]).toEqual([0, 3, 2, 1]);
    expect(myPrizeLine(15, 15)).toBe('你這個月已讀滿 15 天，算你一份');
    expect(monthSummary({ ...group, month: '2026-09', busiest: null, monthReads: 30 })).toMatchObject({ lead: '9 月一起讀了 ', middle: ' 人次', tail: '' });
    expect(monthSummary({ ...group, monthReads: 0 })).toBeNull();
  });
});

const history: ScoreHistory = {
  from: '2026-09-01', today: '2026-10-14',
  points: Array.from({ length: 44 }, (_, index) => Math.floor(index / 2)),
  devotions: Array.from({ length: 44 }, (_, index) => Math.floor(index / 4)),
  months: [{ month: '2026-09', points: 15, devotionDays: 7 }, { month: '2026-10', points: 6, devotionDays: 4 }],
};

describe('the 積分 chart: 總積分 and 每月, with 靈修 as a gold dashed line', () => {
  it('draws the running total from the first day, with a month tick away from both ends', () => {
    const chart = totalChart(history)!;
    expect(chart).toMatchObject({ pointsTotal: 21, devotionsTotal: 10, top: 22 });
    expect(chart.monthTicks.map((tick) => tick.label)).toEqual(['10/1']);
    expect(chart.points.split(' ')).toHaveLength(44);
    expect(totalChart({ ...history, from: null })).toBeNull();
  });

  it('keeps the last four months, and puts the 靈修 number on the bar when it fits inside', () => {
    const bars = monthBars({ ...history, months: [1, 2, 3, 4, 5].map((month) => ({ month: `2026-0${month}`, points: 10, devotionDays: month === 5 ? 0 : 5 })) });
    expect(bars.map((bar) => bar.month)).toEqual(['2026-02', '2026-03', '2026-04', '2026-05']);
    expect(bars[0].devotion).toMatchObject({ days: 5, onBar: true });
    expect(bars[3].devotion).toBeNull();
    expect(monthBars({ ...history, months: [{ month: '2026-10', points: 2, devotionDays: 9 }] })[0].devotion?.onBar).toBe(false);
  });

  it('labels 靈修 with a number only, never as points, and the 每月 number is not bold', () => {
    const tree = render(React.createElement(ScoreHistoryCard, { history }));
    const total = texts(tree);
    expect(total).toEqual(expect.arrayContaining(['從第一天到今天', '21 分', '讀經積分 21 分', '靈修 10']));
    expect(total.join('')).not.toMatch(/不算分|靈修 \d+ 天/);
    act(() => tree.root.find((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === '每月').props.onPress());
    const numbers = tree.root.findAll((node) => (node.type as unknown) === 'SvgText' && ['7', '4'].includes(node.children.join('')));
    expect(numbers).toHaveLength(2);
    for (const number of numbers) expect(number.props.fontWeight).toBeUndefined();
    expect(texts(tree)).toEqual(expect.arrayContaining(['每個月得到的積分', '本月 6 分']));
    expect(tree.root.findAll((node) => (node.type as unknown) === 'SvgText').map((node) => node.children.join(''))).toEqual(expect.arrayContaining(['9 月', '10 月 (到今天)']));
  });
});

describe('the green 靈修 button beside 完成今日讀經', () => {
  it('speaks about today or the picked day, and is still inside the completion window only', () => {
    expect(buildDevotionButtonModel({ date: '2026-10-14', today: '2026-10-14', completed: false, pending: false, canMark: true })).toEqual({ label: '完成今日靈修', disabled: false });
    expect(buildDevotionButtonModel({ date: '2026-10-14', today: '2026-10-14', completed: true, pending: false, canMark: true }).label).toBe('今日靈修已完成');
    expect(buildDevotionButtonModel({ date: '2026-10-12', today: '2026-10-14', completed: false, pending: false, canMark: true }).label).toBe('我已讀了靈修');
    expect(buildDevotionButtonModel({ date: '2026-10-01', today: '2026-10-14', completed: false, pending: false, canMark: false }).disabled).toBe(true);
    const onToggle = vi.fn();
    const tree = render(React.createElement(DevotionTodayButton, { date: '2026-10-14', today: '2026-10-14', completed: true, pending: false, canMark: true, onToggle }));
    act(() => tree.root.find((node) => (node.type as unknown) === 'Pressable').props.onPress());
    expect(onToggle).toHaveBeenCalledWith(false);
    // Mock G/J: the completed leaf grows a second leaf.
    expect(tree.root.findAll((node) => (node.type as unknown) === 'Path')).toHaveLength(4);
  });
});

describe('全體 (管理) at the bottom of 我的帳戶', () => {
  it('stays hidden for a member and opens the guarded 全體 scope for an admin', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => { tree = TestRenderer.create(React.createElement(AdminAllScoresEntry)); });
    expect(tree.toJSON()).toBeNull();
    gamification.getCapabilities.mockResolvedValueOnce({ canViewAllScores: true, canManageRewards: false, canRedeemRewards: false });
    await act(async () => { tree = TestRenderer.create(React.createElement(AdminAllScoresEntry)); });
    const entry = tree.root.find((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === '全體 (管理)');
    expect(texts(tree)).toEqual(['全體 (管理) ›']);
    act(() => entry.props.onPress());
    expect(nav.navigate).toHaveBeenCalledWith('/progress');
    expect(consumeOpenAllScores()).toBe(true);
  });
});

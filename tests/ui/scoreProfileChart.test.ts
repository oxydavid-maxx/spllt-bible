import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const { primitive } = vi.hoisted(() => ({ primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children) }));
vi.mock('react-native', () => ({ Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'), Text: primitive('Text'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));

vi.mock('react-native-svg', () => { const el = (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children); return { default: el('Svg'), Circle: el('Circle') }; });
import { ScoreProfile } from '../../src/ui/gamification/ScoreProfile';
import { chartQueryForRange } from '../../src/ui/gamification/ScoreProfileChart';

const TODAY = '2026-09-10';
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...([] as unknown[]).concat(style as unknown[]).filter(Boolean));
const texts = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => String(node.props.children)).join(' ');
const cells = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAll((node) => String(node.type) === 'Pressable' && typeof node.props.accessibilityLabel === 'string' && /^\d{4}-\d{2}-\d{2} /.test(node.props.accessibilityLabel));

const chart = {
  range: 'week' as const,
  anchor: '2026-09-07',
  periodStart: '2026-09-07',
  periodEnd: '2026-09-13',
  earnedPoints: 4,
  previousAnchor: '2026-08-31',
  nextAnchor: '2026-09-14',
  buckets: [
    { key: '2026-09-07', startDate: '2026-09-07', endDate: '2026-09-07', earnedPoints: 0 },
    { key: '2026-09-08', startDate: '2026-09-08', endDate: '2026-09-08', earnedPoints: 1 },
    { key: '2026-09-09', startDate: '2026-09-09', endDate: '2026-09-09', earnedPoints: 0 },
    { key: '2026-09-10', startDate: '2026-09-10', endDate: '2026-09-10', earnedPoints: 3 },
    { key: '2026-09-11', startDate: '2026-09-11', endDate: '2026-09-11', earnedPoints: 0 },
    { key: '2026-09-12', startDate: '2026-09-12', endDate: '2026-09-12', earnedPoints: 0 },
    { key: '2026-09-13', startDate: '2026-09-13', endDate: '2026-09-13', earnedPoints: 0 },
  ],
};

function profile() {
  return { memberId: 'member-chart', displayName: '小明', earnedTotal: 4, band: null, months: [{ month: '2026-09', earnedPoints: 4 }], chart, permissions: { canEditTarget: false, canRedeem: false } };
}

function render(props: Record<string, unknown>) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(ScoreProfile, { today: TODAY, ...props } as never)); });
  return renderer;
}

describe('score profile reading calendar', () => {
  it('renders range controls, period navigation, one accessible cell per day, and counts read days', () => {
    const onChartChange = vi.fn();
    const renderer = render({ profile: profile(), onChartChange });

    for (const label of ['週', '月', '年', '全部']) expect(renderer.root.findByProps({ children: label })).toBeDefined();
    expect(renderer.root.findByProps({ accessibilityLabel: '上一個積分期間' }).props.style.minHeight).toBeGreaterThanOrEqual(48);
    expect(renderer.root.findByProps({ accessibilityLabel: '下一個積分期間' }).props.style.minHeight).toBeGreaterThanOrEqual(48);
    expect(texts(renderer)).toContain('讀經日曆');
    expect(texts(renderer)).toContain('本期 2 天');
    expect(texts(renderer)).not.toContain('本期 4 分');

    const dayCells = cells(renderer);
    expect(dayCells).toHaveLength(7);
    const read = dayCells.find((node) => node.props.accessibilityLabel.startsWith('2026-09-08'))!;
    const missed = dayCells.find((node) => node.props.accessibilityLabel.startsWith('2026-09-09'))!;
    const future = dayCells.find((node) => node.props.accessibilityLabel.startsWith('2026-09-12'))!;
    const today = dayCells.find((node) => node.props.accessibilityLabel.startsWith('2026-09-10'))!;
    expect(read.props.accessibilityLabel).toContain('已讀');
    expect(missed.props.accessibilityLabel).toContain('未讀');
    expect(future.props.accessibilityLabel).toContain('未到');
    expect(today.props.accessibilityLabel).toContain('今天');
    expect(flat(read.props.style).backgroundColor).toBe('#1A5544');
    expect(flat(missed.props.style).backgroundColor).toBe('#F4F7F2');
    expect(flat(future.props.style).borderStyle).toBe('dashed');
    expect(flat(today.props.style).borderColor).toBe('#123B30');
    expect(dayCells.every((node) => flat(node.props.style).height === 32)).toBe(true);

    // Defaults to today and states the outcome in words; no data slider remains.
    expect(texts(renderer)).toContain('選取：9月10日（今天）　已讀 ✓');
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === '上一個資料柱')).toHaveLength(0);
    act(() => { missed.props.onPress(); });
    expect(texts(renderer)).toContain('選取：9月9日　未讀');

    act(() => { renderer.root.findAll((node) => String(node.type) === 'Pressable').find((node) => node.props.accessibilityLabel === '月')?.props.onPress(); });
    expect(onChartChange).toHaveBeenCalledWith({ range: 'month' });
  });

  it('lays a month out Monday-first with leading blanks and weekday headers', () => {
    const monthBuckets = Array.from({ length: 30 }, (_, index) => { const day = String(index + 1).padStart(2, '0'); return { key: `2026-09-${day}`, startDate: `2026-09-${day}`, endDate: `2026-09-${day}`, earnedPoints: index === 9 ? 1 : 0 }; });
    const monthChart = { ...chart, range: 'month' as const, anchor: '2026-09', periodStart: '2026-09-01', periodEnd: '2026-09-30', buckets: monthBuckets, earnedPoints: 1 };
    const renderer = render({ profile: { ...profile(), chart: monthChart } });
    for (const header of ['一', '二', '三', '四', '五', '六', '日']) expect(renderer.root.findAll((node) => String(node.type) === 'Text' && node.props.children === header)).toHaveLength(1);
    // 2026-09-01 is a Tuesday: exactly one blank before it.
    expect(renderer.root.findAll((node) => String(node.type) === 'View' && flat(node.props.style).height === 32 && !node.props.accessibilityLabel)).toHaveLength(1);
    expect(cells(renderer)).toHaveLength(30);
    // 14–20 Sep 2026 is Monday–Sunday: a fully read row deepens together and is counted as one 完整週.
    const perfectBuckets = monthBuckets.map((bucket) => (bucket.key >= '2026-09-14' && bucket.key <= '2026-09-20') || bucket.key === '2026-09-10' ? { ...bucket, earnedPoints: 1 } : bucket);
    const perfectRenderer = render({ profile: { ...profile(), chart: { ...monthChart, buckets: perfectBuckets, earnedPoints: 8 } }, today: '2026-09-25' });
    expect(texts(perfectRenderer)).toContain('本期 8 天 · 完整週 1');
    expect(cells(perfectRenderer).filter((node) => flat(node.props.style).backgroundColor === '#123B30')).toHaveLength(7);
    expect(flat(cells(perfectRenderer).find((node) => node.props.accessibilityLabel.startsWith('2026-09-10'))!.props.style).backgroundColor).toBe('#1A5544');
    // Every header, blank and day sits in a 1/7-wide slot so seven always fit on one row (device regression: 日 wrapped).
    const slots = renderer.root.findAll((node) => String(node.type) === 'View' && flat(node.props.style).width === '14.2857%');
    expect(slots).toHaveLength(7 + 1 + 30);
    expect(renderer.root.findAll((node) => typeof flat(node.props.style).columnGap === 'number')).toHaveLength(0);
    expect(texts(renderer)).toContain('2026年9月');
    expect(texts(renderer)).toContain('本期 1 天');
  });

  it('does not render private balance for a friend profile', () => {
    const renderer = render({ profile: { ...profile(), private: undefined } });
    expect(texts(renderer)).not.toContain('可兌換積分');
  });

  it('puts the reward goal on top of the member page, hides the balance until something was spent, and keeps it off friend pages', () => {
    const same = render({ profile: { ...profile(), private: { redeemableBalance: 4, targetReward: null }, permissions: { canEditTarget: true, canRedeem: false } }, onChooseReward: () => undefined });
    expect(texts(same)).not.toContain('可兌換');
    expect(texts(same)).toContain('選一個目標獎品');
    expect(same.root.findByProps({ accessibilityLabel: '選擇獎品' })).toBeDefined();
    const spent = render({ profile: { ...profile(), private: { redeemableBalance: 1, targetReward: null } } });
    expect(texts(spent)).toContain('可兌換 1 分 · 已兌換 3 分');
    const withTarget = render({ profile: { ...profile(), earnedTotal: 72, private: { redeemableBalance: 72, targetReward: { rewardId: 'r1', name: '冰淇淋', costPoints: 120, active: true, revision: 1 } } } });
    const goal = withTarget.root.findByProps({ accessibilityLabel: '目標獎品' });
    expect(texts(withTarget)).toContain('冰淇淋');
    expect(withTarget.root.findByProps({ accessibilityRole: 'progressbar' }).props.accessibilityValue.text).toBe('72/120 分');
    expect(texts(withTarget)).not.toContain('還差');
    // Goal card renders before the total hero.
    const all = withTarget.root.findAll((node) => node.props?.accessibilityLabel === '目標獎品' || (String(node.type) === 'Text' && node.props.children === '總積分'));
    expect(all[0]).toBe(goal);
  });

  it('renders the reward shelf for the member and lets a tap choose the target', () => {
    const onChooseTarget = vi.fn();
    const rewards = [{ rewardId: 'r1', name: '冰淇淋', costPoints: 120, active: true, revision: 1 }, { rewardId: 'r2', name: '貼紙', costPoints: 3, active: true, revision: 1 }, { rewardId: 'old', name: '下架', costPoints: 1, active: false, revision: 2 }];
    const renderer = render({ profile: { ...profile(), private: { redeemableBalance: 4, targetReward: rewards[0] }, permissions: { canEditTarget: true, canRedeem: false } }, rewards, onChooseTarget });
    expect(renderer.root.findAll((node) => String(node.type) === 'Pressable' && typeof node.props?.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith('設為目標：'))).toHaveLength(1);
    expect(texts(renderer)).not.toContain('下架');
    const sticker = renderer.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === '設為目標：貼紙 3 分')[0];
    expect(texts(renderer)).toContain('可兌換');
    act(() => { sticker.props.onPress(); });
    expect(onChooseTarget).toHaveBeenCalledWith('r2');
    // Friends never see a shelf.
    const friend = render({ profile: { ...profile(), private: undefined }, rewards });
    expect(friend.root.findAll((node) => node.props?.accessibilityLabel === '獎品架')).toHaveLength(0);
  });

  it('explains the missing band instead of printing a dash', () => {
    expect(texts(render({ profile: profile() }))).toContain('滿 10 人開始分梯隊');
    expect(texts(render({ profile: profile() }))).not.toContain('梯隊 —');
    expect(texts(render({ profile: { ...profile(), band: 2 } }))).toContain('第 2 梯隊');
  });

  it('keeps old six-month responses honest until chart data is available', () => {
    const renderer = render({ profile: { memberId: 'member-chart', displayName: '小明', earnedTotal: 3, band: null, months: [{ month: '2026-08', earnedPoints: 1 }, { month: '2026-09', earnedPoints: 2 }], permissions: { canEditTarget: false, canRedeem: false } } });
    const text = texts(renderer);
    expect(text).toContain('近六個月');
    expect(text).toContain('本期 3 天');
    expect(text).toContain('8月');
    expect(text).toContain('9月');
    expect(text).not.toContain('NaN');
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === '週')).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === '上一個積分期間')).toHaveLength(0);
  });

  it('lets the server choose the current period when changing range', () => {
    const boundaryChart = { ...chart, periodStart: '2025-12-29', periodEnd: '2026-01-04' };
    expect([chartQueryForRange(boundaryChart, 'month'), chartQueryForRange(boundaryChart, 'year')]).toEqual([{ range: 'month' }, { range: 'year' }]);
  });

  it('renders yearly buckets as month cells with day counts and selects the current month', () => {
    const yearChart = { ...chart, range: 'year' as const, anchor: '2026', periodStart: '2026-01-01', periodEnd: '2026-12-31', buckets: [{ key: '2026-08', startDate: '2026-08-01', endDate: '2026-08-31', earnedPoints: 16 }, { key: '2026-09', startDate: '2026-09-01', endDate: '2026-09-30', earnedPoints: 5 }], earnedPoints: 21 };
    const renderer = render({ profile: { ...profile(), chart: yearChart } });
    const text = texts(renderer);
    expect(text).toContain('2026年');
    expect(text).toContain('本期 21 天');
    expect(text).toContain('選取：2026年9月，5 天');
    expect(text).not.toContain('2026-09年');
    // Each month cell carries a proportional bar: 16 of 31 days ≈ 52%.
    const bars = renderer.root.findAll((node) => String(node.type) === 'View' && node.props?.testID === 'count-bar');
    expect(bars).toHaveLength(2);
    expect(flat((bars[0].children[0] as TestRenderer.ReactTestInstance).props.style).width).toBe('52%');
    const strong = renderer.root.findByProps({ accessibilityLabel: '2026年8月 16 天' });
    expect(flat(strong.props.style).backgroundColor).toBe('#1A5544');
    expect(renderer.root.findByProps({ accessibilityLabel: '2026年9月 5 天' }).props.style.some((style: unknown) => style && typeof style === 'object' && (style as { minHeight?: number }).minHeight === 48)).toBe(true);
  });
});

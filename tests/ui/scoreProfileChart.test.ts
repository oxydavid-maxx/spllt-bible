import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const { primitive } = vi.hoisted(() => ({ primitive: (name: string) => (props: { children?: unknown }) => require('react').createElement(name, props, props.children) }));
vi.mock('react-native', () => ({ Pressable: primitive('Pressable'), ScrollView: primitive('ScrollView'), Text: primitive('Text'), View: primitive('View'), StyleSheet: { create: (value: unknown) => value } }));

import { ScoreProfile } from '../../src/ui/gamification/ScoreProfile';
import { chartQueryForRange } from '../../src/ui/gamification/ScoreProfileChart';

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

describe('score profile chart', () => {
  it('renders conventional range controls, period navigation, integer axis, and accessible daily bars', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    const onChartChange = vi.fn();
    act(() => { renderer = TestRenderer.create(React.createElement(ScoreProfile, { profile: profile(), onChartChange })); });

    for (const label of ['週', '月', '年', '全部']) expect(renderer.root.findByProps({ children: label })).toBeDefined();
    expect(renderer.root.findByProps({ accessibilityLabel: '上一個積分期間' }).props.style.minHeight).toBeGreaterThanOrEqual(48);
    expect(renderer.root.findByProps({ accessibilityLabel: '下一個積分期間' }).props.style.minHeight).toBeGreaterThanOrEqual(48);
    expect(renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => String(node.props.children)).join(' ')).toContain('本期 4 分');

    const bars = renderer.root.findAll((node) => String(node.type) === 'View' && typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.includes('2026-09-08'));
    expect(bars).toHaveLength(1);
    expect(bars[0].props.accessibilityLabel).toContain('1 分');
    expect(renderer.root.findAll((node) => String(node.type) === 'Pressable' && typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.includes('2026-09-08'))).toHaveLength(0);
    expect(renderer.root.findByProps({ accessibilityLabel: '上一個資料柱' }).props.style.minHeight).toBeGreaterThanOrEqual(48);
    expect(renderer.root.findByProps({ accessibilityLabel: '下一個資料柱' }).props.style.minHeight).toBeGreaterThanOrEqual(48);
    expect(renderer.root.findAll((node) => Array.isArray(node.props.style) && node.props.style.some((style: unknown) => style && typeof style === 'object' && 'backgroundColor' in style && (style as { backgroundColor?: string }).backgroundColor === '#1A5544')).length).toBeGreaterThan(0);
    expect(renderer.root.findAll((node) => Array.isArray(node.props.style) && node.props.style.some((style: unknown) => style && typeof style === 'object' && 'backgroundColor' in style && (style as { backgroundColor?: string }).backgroundColor === '#F4F7F2')).length).toBe(0);

    for (let index = 0; index < 5; index += 1) act(() => { renderer.root.findByProps({ accessibilityLabel: '上一個資料柱' }).props.onPress(); });
    expect(renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => String(node.props.children)).join(' ')).toContain('選取：9月8日，1 分');
    expect(renderer.root.findByProps({ accessibilityRole: 'adjustable' }).props.accessibilityValue.text).toContain('9月8日');

    act(() => { renderer.root.findAll((node) => String(node.type) === 'Pressable').find((node) => node.props.accessibilityLabel === '月')?.props.onPress(); });
    expect(onChartChange).toHaveBeenCalledWith({ range: 'month', anchor: '2026-09' });
  });

  it('does not render private balance for a friend profile', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(ScoreProfile, { profile: { ...profile(), private: undefined } })); });
    const text = renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => String(node.props.children)).join(' ');
    expect(text).not.toContain('可兌換積分');
  });

  it('keeps old six-month responses honest until chart data is available', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(ScoreProfile, { profile: { memberId: 'member-chart', displayName: '小明', earnedTotal: 3, band: null, months: [{ month: '2026-08', earnedPoints: 1 }, { month: '2026-09', earnedPoints: 2 }], permissions: { canEditTarget: false, canRedeem: false } } })); });
    const text = renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => String(node.props.children)).join(' ');
    expect(text).toContain('近六個月');
    expect(text).toContain('本期 3 分');
    expect(text).toContain('8月');
    expect(text).toContain('9月');
    expect(text).not.toContain('NaN');
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === '週')).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === '上一個積分期間')).toHaveLength(0);
  });

  it('keeps a week boundary when moving to month or year', () => {
    const boundaryChart = { ...chart, periodStart: '2025-12-29', periodEnd: '2026-01-04' };
    expect(chartQueryForRange(boundaryChart, 'month')).toEqual({ range: 'month', anchor: '2025-12' });
    expect(chartQueryForRange(boundaryChart, 'year')).toEqual({ range: 'year', anchor: '2025' });
  });

  it('labels yearly buckets as year and month', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    const yearChart = { ...chart, range: 'year' as const, anchor: '2026', periodStart: '2026-01-01', periodEnd: '2026-12-31', buckets: [{ key: '2026-09', startDate: '2026-09-01', endDate: '2026-09-30', earnedPoints: 5 }] };
    act(() => { renderer = TestRenderer.create(React.createElement(ScoreProfile, { profile: { ...profile(), chart: yearChart } })); });
    const text = renderer.root.findAll((node) => String(node.type) === 'Text').map((node) => String(node.props.children)).join(' ');
    expect(text).toContain('2026年9月');
    expect(text).not.toContain('2026-09年');
  });

  it('places y-axis guides on the same value scale as the bars', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    const scaledChart = { ...chart, buckets: chart.buckets.map((bucket, index) => ({ ...bucket, earnedPoints: index === 1 ? 5 : index === 3 ? 3 : 0 })), earnedPoints: 8 };
    act(() => { renderer = TestRenderer.create(React.createElement(ScoreProfile, { profile: { ...profile(), chart: scaledChart } })); });
    const middleTick = renderer.root.findAll((node) => String(node.type) === 'Text').find((node) => node.props.children === 3);
    expect(middleTick?.props.style[1].top).toBe(40);
    const gridLine = renderer.root.findAll((node) => String(node.type) === 'View').find((node) => Array.isArray(node.props.style) && node.props.style.some((style: unknown) => style && typeof style === 'object' && (style as { borderTopColor?: string }).borderTopColor === '#C6D5C9') && node.props.style.some((style: unknown) => style && typeof style === 'object' && (style as { top?: number }).top === 48));
    expect(gridLine).toBeDefined();
    const tallestBar = renderer.root.findAll((node) => String(node.type) === 'View').find((node) => Array.isArray(node.props.style) && node.props.style.some((style: unknown) => style && typeof style === 'object' && (style as { height?: number }).height === 120));
    expect(tallestBar).toBeDefined();
  });
});

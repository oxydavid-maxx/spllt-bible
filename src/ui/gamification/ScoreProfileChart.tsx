import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MonthPoints, ScoreChart, ScoreChartBucket, ScoreChartQuery, ScoreChartRange } from '../../services/gamificationApiClient';
import { taipeiDate } from '../../domain/gamificationV1';
import { theme } from '../Theme';

// Reading calendar. One point per day means a bar chart degenerates into 0/1 hairlines; a
// calendar shows at a glance which days were read, which were missed, and what is still ahead.
// 週 = one row, 月 = month grid (Monday first), 年 = 12 month cells, 全部 = one cell per year.

const RANGE_OPTIONS: Array<{ range: ScoreChartRange; label: string }> = [
  { range: 'week', label: '週' },
  { range: 'month', label: '月' },
  { range: 'year', label: '年' },
  { range: 'all', label: '全部' },
];
const WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日'];
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export interface ScoreProfileChartProps {
  chart?: ScoreChart;
  fallbackMonths: MonthPoints[];
  onChartChange?: (query: ScoreChartQuery) => void;
  /** Taipei calendar date used to mark "today"; injectable for tests. */
  today?: string;
}

export function chartQueryForRange(_chart: ScoreChart, range: ScoreChartRange): ScoreChartQuery {
  return { range };
}

function daysInMonth(month: string): number {
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value, 0, 12)).getUTCDate();
}

function fallbackChart(months: MonthPoints[]): ScoreChart {
  if (months.length === 0) return { range: 'month', anchor: null, periodStart: null, periodEnd: null, earnedPoints: 0, buckets: [], previousAnchor: null, nextAnchor: null };
  const firstMonth = months[0].month;
  const lastMonth = months.at(-1)?.month ?? firstMonth;
  const buckets = months.map((month) => ({ key: month.month, startDate: `${month.month}-01`, endDate: `${month.month}-${daysInMonth(month.month).toString().padStart(2, '0')}`, earnedPoints: month.earnedPoints }));
  return {
    range: 'month',
    anchor: lastMonth,
    periodStart: `${firstMonth}-01`,
    periodEnd: `${lastMonth}-${daysInMonth(lastMonth).toString().padStart(2, '0')}`,
    earnedPoints: months.reduce((total, month) => total + month.earnedPoints, 0),
    buckets,
    previousAnchor: null,
    nextAnchor: null,
  };
}

function dateLabel(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

function shortDateLabel(value: string): string {
  const [, month, day] = value.split('-').map(Number);
  return `${month}月${day}日`;
}

function yearMonthLabel(value: string): string {
  const [year, month] = value.split('-');
  return `${year}年${Number(month)}月`;
}

function isDayKey(key: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(key); }
function isMonthKey(key: string): boolean { return /^\d{4}-\d{2}$/.test(key); }

function periodLabel(chart: ScoreChart): string {
  if (chart.range === 'all') return '全部紀錄';
  if (!chart.periodStart || !chart.periodEnd) return '讀經紀錄';
  if (chart.range === 'month') return yearMonthLabel(chart.periodStart.slice(0, 7));
  if (chart.range === 'year') return `${chart.periodStart.slice(0, 4)}年`;
  return chart.periodStart.slice(0, 4) === chart.periodEnd.slice(0, 4)
    ? `${shortDateLabel(chart.periodStart)}–${shortDateLabel(chart.periodEnd)}`
    : `${shortDateLabel(chart.periodStart)}–${dateLabel(chart.periodEnd)}`;
}

function bucketPeriodLabel(bucket: ScoreChartBucket): string {
  if (isDayKey(bucket.key)) return shortDateLabel(bucket.key);
  if (isMonthKey(bucket.key)) return yearMonthLabel(bucket.key);
  return `${bucket.key}年`;
}

/** Screen-reader label: keeps the ISO key so the day is unambiguous, then the plain outcome. */
function bucketAccessibilityLabel(bucket: ScoreChartBucket, today: string): string {
  if (isDayKey(bucket.key)) {
    const state = bucket.key > today ? '未到' : bucket.earnedPoints > 0 ? '已讀' : '未讀';
    return `${bucket.key} ${bucket.earnedPoints} 分 ${state}${bucket.key === today ? ' 今天' : ''}`;
  }
  return `${bucketPeriodLabel(bucket)} ${bucket.earnedPoints} 天`;
}

function selectedLabel(bucket: ScoreChartBucket, today: string): string {
  if (isDayKey(bucket.key)) {
    const state = bucket.key > today ? '未到' : bucket.earnedPoints > 0 ? '已讀 ✓' : '未讀';
    return `選取：${shortDateLabel(bucket.key)}${bucket.key === today ? '（今天）' : ''}　${state}`;
  }
  return `選取：${bucketPeriodLabel(bucket)}，${bucket.earnedPoints} 天`;
}

/** Days read in the period. Daily buckets count days; coarser buckets carry a day count as points (1 point/day). */
function readDays(chart: ScoreChart): number {
  return chart.buckets.every((bucket) => isDayKey(bucket.key))
    ? chart.buckets.filter((bucket) => bucket.earnedPoints > 0).length
    : chart.buckets.reduce((total, bucket) => total + bucket.earnedPoints, 0);
}

function cellState(bucket: ScoreChartBucket, today: string): 'read' | 'missed' | 'future' | 'count' {
  if (!isDayKey(bucket.key)) return 'count';
  if (bucket.key > today) return 'future';
  return bucket.earnedPoints > 0 ? 'read' : 'missed';
}

/** Monday-first column index (0–6) for an ISO date. */
function mondayIndex(date: string): number {
  return (new Date(`${date}T12:00:00.000Z`).getUTCDay() + 6) % 7;
}

function DayCell({ bucket, today, selected, onSelect }: { bucket: ScoreChartBucket; today: string; selected: boolean; onSelect: (key: string) => void }) {
  const state = cellState(bucket, today);
  const isToday = bucket.key === today;
  return <View style={styles.slot}><Pressable
    accessibilityRole="button"
    accessibilityLabel={bucketAccessibilityLabel(bucket, today)}
    accessibilityState={{ selected }}
    onPress={() => onSelect(bucket.key)}
    style={[styles.cell, state === 'read' && styles.cellRead, state === 'missed' && styles.cellMissed, state === 'future' && styles.cellFuture, isToday && styles.cellToday, selected && !isToday && styles.cellSelected]}
  >
    <Text style={[styles.cellText, state === 'read' && styles.cellTextRead, state === 'future' && styles.cellTextFuture]}>{Number(bucket.key.slice(8, 10))}</Text>
  </Pressable></View>;
}

function CountCell({ bucket, label, selected, onSelect, today }: { bucket: ScoreChartBucket; label: string; selected: boolean; onSelect: (key: string) => void; today: string }) {
  const strong = bucket.earnedPoints >= 15;
  return <View style={styles.countSlot}><Pressable
    accessibilityRole="button"
    accessibilityLabel={bucketAccessibilityLabel(bucket, today)}
    accessibilityState={{ selected }}
    onPress={() => onSelect(bucket.key)}
    style={[styles.countCell, bucket.earnedPoints > 0 && styles.countCellSome, strong && styles.countCellStrong, selected && styles.cellSelected]}
  >
    <Text style={[styles.countLabel, strong && styles.cellTextRead]}>{label}</Text>
    <Text style={[styles.countValue, strong && styles.cellTextRead]}>{bucket.earnedPoints} 天</Text>
  </Pressable></View>;
}

export function ScoreProfileChart({ chart: suppliedChart, fallbackMonths, onChartChange, today: suppliedToday }: ScoreProfileChartProps) {
  const chart = suppliedChart ?? fallbackChart(fallbackMonths);
  const isLegacyFallback = suppliedChart === undefined;
  const today = suppliedToday ?? taipeiDate(new Date());
  const defaultKey = () => chart.buckets.find((bucket) => bucket.key === today)?.key ?? chart.buckets.find((bucket) => bucket.key === today.slice(0, 7))?.key ?? chart.buckets.find((bucket) => bucket.key === today.slice(0, 4))?.key ?? chart.buckets.at(-1)?.key ?? null;
  const [selectedKey, setSelectedKey] = useState<string | null>(defaultKey);
  useEffect(() => { setSelectedKey(defaultKey()); }, [chart.range, chart.anchor, chart.periodStart, chart.periodEnd, chart.buckets.length, today]);
  const selectedBucket = chart.buckets.find((bucket) => bucket.key === selectedKey) ?? null;
  const dailyBuckets = chart.buckets.length > 0 && chart.buckets.every((bucket) => isDayKey(bucket.key));
  const leadingBlanks = dailyBuckets && chart.range === 'month' && chart.buckets[0] ? mondayIndex(chart.buckets[0].key) : 0;

  return <View style={styles.card}>
    <View style={styles.headingRow}>
      <Text style={styles.cardTitle}>{isLegacyFallback ? '近六個月' : '讀經日曆'}</Text>
      <Text accessibilityLabel={`本期 ${readDays(chart)} 天`} style={styles.periodTotal}>{`本期 ${readDays(chart)} 天`}</Text>
    </View>
    {!isLegacyFallback ? <View accessibilityRole="tablist" style={styles.rangeSelector}>
      {RANGE_OPTIONS.map((option) => <Pressable key={option.range} accessibilityRole="tab" accessibilityLabel={option.label} accessibilityState={{ selected: chart.range === option.range }} onPress={() => onChartChange?.(chartQueryForRange(chart, option.range))} style={[styles.rangeOption, chart.range === option.range && styles.rangeOptionActive]}><Text style={[styles.rangeText, chart.range === option.range && styles.rangeTextActive]}>{option.label}</Text></Pressable>)}
    </View> : null}
    {isLegacyFallback ? <Text style={styles.legacyPeriod}>近六個月</Text> : <View style={styles.periodNav}>
      <Pressable accessibilityRole="button" accessibilityLabel="上一個積分期間" accessibilityState={{ disabled: !chart.previousAnchor || !onChartChange }} disabled={!chart.previousAnchor || !onChartChange} onPress={() => chart.previousAnchor && onChartChange?.({ range: chart.range, anchor: chart.previousAnchor })} style={styles.navButton}><Text style={styles.navText}>‹</Text></Pressable>
      <Text accessibilityLabel={`目前積分期間 ${periodLabel(chart)}`} style={styles.periodLabel}>{periodLabel(chart)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="下一個積分期間" accessibilityState={{ disabled: !chart.nextAnchor || !onChartChange }} disabled={!chart.nextAnchor || !onChartChange} onPress={() => chart.nextAnchor && onChartChange?.({ range: chart.range, anchor: chart.nextAnchor })} style={styles.navButton}><Text style={styles.navText}>›</Text></Pressable>
    </View>}
    {chart.buckets.length === 0 ? <Text style={styles.empty}>尚無讀經紀錄</Text> : dailyBuckets ? <View>
      <View style={styles.grid}>
        {(chart.range === 'month' ? WEEKDAY_HEADERS : chart.buckets.map((bucket) => WEEKDAY_LABELS[new Date(`${bucket.key}T12:00:00.000Z`).getUTCDay()])).map((label, index) => <View key={`h${index}`} style={styles.slot}><Text style={styles.weekday}>{label}</Text></View>)}
      </View>
      <View style={styles.grid}>
        {Array.from({ length: leadingBlanks }, (_, index) => <View key={`b${index}`} style={styles.slot}><View style={styles.cellBlank} /></View>)}
        {chart.buckets.map((bucket) => <DayCell key={bucket.key} bucket={bucket} today={today} selected={bucket.key === selectedKey} onSelect={setSelectedKey} />)}
      </View>
    </View> : <View style={styles.countGrid}>
      {chart.buckets.map((bucket) => <CountCell key={bucket.key} bucket={bucket} today={today} label={isMonthKey(bucket.key) ? `${Number(bucket.key.slice(5, 7))}月` : `${bucket.key}年`} selected={bucket.key === selectedKey} onSelect={setSelectedKey} />)}
    </View>}
    {selectedBucket ? <Text accessibilityLiveRegion="polite" style={styles.selectedLabel}>{selectedLabel(selectedBucket, today)}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderRadius: theme.radius.card, padding: theme.spacing.md, gap: theme.spacing.sm },
  headingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.spacing.sm },
  cardTitle: { color: theme.colors.ink, fontSize: theme.type.heading.size, fontWeight: '800' },
  periodTotal: { color: theme.colors.primaryDeep, fontSize: theme.type.label.size, fontWeight: '800' },
  rangeSelector: { flexDirection: 'row', gap: theme.spacing.xs, borderBottomColor: theme.colors.border, borderBottomWidth: theme.control.hairline },
  rangeOption: { flex: 1, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface },
  rangeOptionActive: { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary },
  rangeText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' },
  rangeTextActive: { color: theme.colors.primaryDeep },
  legacyPeriod: { minHeight: theme.control.tap, color: theme.colors.muted, fontSize: theme.type.body.size, fontWeight: '700', textAlign: 'center', textAlignVertical: 'center' },
  periodNav: { minHeight: theme.control.tap, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.xs },
  navButton: { minWidth: theme.control.tap, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, borderColor: theme.colors.borderStrong, borderWidth: theme.control.hairline, backgroundColor: theme.colors.surface },
  navText: { color: theme.colors.primary, fontSize: 30, lineHeight: 32 },
  periodLabel: { flex: 1, color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '800', textAlign: 'center' },
  // Exactly 7 slots per row: each slot is 1/7 of the width and carries the gutter as padding,
  // so no gap arithmetic can push the seventh column onto the next line.
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  slot: { width: '14.2857%', paddingHorizontal: 2.5, paddingVertical: 2.5 },
  weekday: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line, textAlign: 'center' },
  cellBlank: { height: 32 },
  cell: { height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceMuted },
  cellRead: { backgroundColor: theme.colors.primary },
  cellMissed: { backgroundColor: theme.colors.surfaceMuted },
  cellFuture: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.border },
  cellToday: { borderWidth: 2, borderColor: theme.colors.primaryDeep },
  cellSelected: { borderWidth: 2, borderColor: theme.colors.borderStrong },
  cellText: { color: theme.colors.muted, fontSize: theme.type.caption.size, fontWeight: '700' },
  cellTextRead: { color: theme.colors.white },
  cellTextFuture: { color: theme.colors.border },
  countGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  countSlot: { width: '25%', padding: 3 },
  countCell: { minHeight: theme.control.tap, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceMuted, paddingVertical: theme.spacing.xs },
  countCellSome: { backgroundColor: theme.colors.primarySoft },
  countCellStrong: { backgroundColor: theme.colors.primary },
  countLabel: { color: theme.colors.ink, fontSize: theme.type.caption.size, fontWeight: '800' },
  countValue: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line },
  selectedLabel: { color: theme.colors.ink, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, fontWeight: '700' },
  empty: { color: theme.colors.muted, fontSize: theme.type.body.size, paddingVertical: theme.spacing.lg },
});

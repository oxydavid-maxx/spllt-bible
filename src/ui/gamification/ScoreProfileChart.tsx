import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
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

interface CumulativePoint {
  bucket: ScoreChartBucket;
  value: number;
  x: number;
  y: number;
}

const CURVE_VIEW_BOX_WIDTH = 320;
const CURVE_LEFT_INSET = 14;
const CURVE_RIGHT_INSET = 306;

function curvePointIndex(locationX: number, plotWidth: number, pointCount: number): number {
  if (pointCount <= 1 || plotWidth <= 0) return 0;
  const viewBoxX = locationX / plotWidth * CURVE_VIEW_BOX_WIDTH;
  const ratio = (viewBoxX - CURVE_LEFT_INSET) / (CURVE_RIGHT_INSET - CURVE_LEFT_INSET);
  return Math.max(0, Math.min(pointCount - 1, Math.round(Math.max(0, Math.min(1, ratio)) * (pointCount - 1))));
}

function cumulativePoints(chart: ScoreChart, today: string): CumulativePoint[] | null {
  if (!Number.isInteger(chart.openingEarnedPoints) || chart.openingEarnedPoints! < 0 || chart.buckets.some((bucket) => !Number.isInteger(bucket.cumulativeEarnedPoints) || bucket.cumulativeEarnedPoints! < 0)) return null;
  const buckets = chart.buckets.filter((bucket) => bucket.startDate <= today);
  if (buckets.length === 0) return [];
  const max = Math.max(1, chart.openingEarnedPoints!, ...buckets.map((bucket) => bucket.cumulativeEarnedPoints!));
  const width = 320;
  const height = 128;
  const horizontalPadding = 14;
  const verticalPadding = 12;
  return buckets.map((bucket, index) => {
    const value = bucket.cumulativeEarnedPoints!;
    const x = buckets.length === 1 ? width / 2 : horizontalPadding + index * (width - horizontalPadding * 2) / (buckets.length - 1);
    const y = height - verticalPadding - (value / max) * (height - verticalPadding * 2);
    return { bucket, value, x, y };
  });
}

function CumulativeCurve({ chart, today, selectedKey, onSelect }: { chart: ScoreChart; today: string; selectedKey: string | null; onSelect: (key: string) => void }) {
  const points = cumulativePoints(chart, today);
  const [plotWidth, setPlotWidth] = useState(320);
  if (!points) return <Text style={styles.empty}>累積走勢尚未提供可靠資料</Text>;
  if (points.length === 0) return <Text style={styles.empty}>這個期間尚無已發生的積分紀錄</Text>;
  const selectedIndex = Math.max(0, points.findIndex((point) => point.bucket.key === selectedKey));
  const selectedPoint = points[selectedIndex];
  return <View>
    <Pressable
      accessibilityRole="adjustable"
      accessibilityLabel="累積積分走勢"
      accessibilityHint="點選走勢讀取日期與累積分數，也可向前或向後移動。"
      accessibilityValue={{ min: 1, max: points.length, now: selectedIndex + 1, text: `${selectedPoint.bucket.key} 累積 ${selectedPoint.value} 分` }}
      accessibilityActions={[{ name: 'increment', label: '下一個日期' }, { name: 'decrement', label: '上一個日期' }]}
      onAccessibilityAction={(event) => {
        const delta = event.nativeEvent.actionName === 'increment' ? 1 : -1;
        onSelect(points[Math.max(0, Math.min(points.length - 1, selectedIndex + delta))].bucket.key);
      }}
      onLayout={(event) => setPlotWidth(event.nativeEvent.layout.width || 320)}
      onPress={(event) => {
        const index = curvePointIndex(event.nativeEvent.locationX, plotWidth, points.length);
        onSelect(points[index].bucket.key);
      }}
      style={styles.curveControl}
    >
      <Svg width="100%" height={144} viewBox={`0 0 ${CURVE_VIEW_BOX_WIDTH} 128`} preserveAspectRatio="none" pointerEvents="none" accessible={false}>
        {points.length > 1 ? <Polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={theme.colors.primary} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /> : null}
        {points.map(({ bucket, value, x, y }) => <Circle key={bucket.key} cx={x} cy={y} r={bucket.key === selectedKey ? 6 : 4} fill={bucket.key === selectedKey ? theme.colors.primaryDeep : theme.colors.primary} stroke={theme.colors.white} strokeWidth={2} />)}
      </Svg>
    </Pressable>
    <View style={styles.trendFooter}>
      <Text style={styles.trendDate}>{bucketPeriodLabel(points[0].bucket)}</Text>
      <Text style={styles.trendDate}>{bucketPeriodLabel(points.at(-1)!.bucket)}</Text>
    </View>
    <Text style={styles.trendOpening}>{`期間前累積 ${chart.openingEarnedPoints} 分`}</Text>
  </View>;
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

function earnedThroughToday(chart: ScoreChart, index: number, today: string): number {
  const bucket = chart.buckets[index];
  if (bucket.startDate > today) return 0;
  if (bucket.endDate <= today) return bucket.earnedPoints;
  if (bucket.cumulativeEarnedPoints === undefined) return bucket.earnedPoints;
  const previous = index === 0 ? chart.openingEarnedPoints : chart.buckets[index - 1]?.cumulativeEarnedPoints;
  return previous === undefined ? bucket.earnedPoints : Math.max(0, bucket.cumulativeEarnedPoints - previous);
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

function DayCell({ bucket, today, selected, onSelect, perfect = false }: { bucket: ScoreChartBucket; today: string; selected: boolean; onSelect: (key: string) => void; perfect?: boolean }) {
  const state = cellState(bucket, today);
  const isToday = bucket.key === today;
  return <View style={styles.slot}><Pressable
    accessibilityRole="button"
    accessibilityLabel={bucketAccessibilityLabel(bucket, today)}
    accessibilityState={{ selected }}
    onPress={() => onSelect(bucket.key)}
    style={[styles.cell, state === 'read' && styles.cellRead, perfect && styles.cellPerfect, state === 'missed' && styles.cellMissed, state === 'future' && styles.cellFuture, isToday && styles.cellToday, selected && !isToday && styles.cellSelected]}
  >
    <Text style={[styles.cellText, state === 'read' && styles.cellTextRead, state === 'future' && styles.cellTextFuture]}>{Number(bucket.key.slice(8, 10))}</Text>
  </Pressable></View>;
}

/** Days a bucket could hold: the month's length, or the year's; used for the proportional bar. */
function bucketCapacity(bucket: ScoreChartBucket): number {
  if (isMonthKey(bucket.key)) return daysInMonth(bucket.key);
  const year = Number(bucket.key.slice(0, 4));
  return Number.isInteger(year) ? (new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365) : 365;
}

/** Monday-first rows of the month grid whose seven days were all read ("完整週", capped by nature). */
export function perfectWeekKeys(buckets: readonly ScoreChartBucket[]): Set<string> {
  const keys = new Set<string>();
  let row: ScoreChartBucket[] = [];
  const flush = () => { if (row.length === 7 && row.every((bucket) => bucket.earnedPoints > 0)) row.forEach((bucket) => keys.add(bucket.key)); row = []; };
  for (const bucket of buckets) {
    if (!isDayKey(bucket.key)) return keys;
    if (mondayIndex(bucket.key) === 0) flush();
    row.push(bucket);
  }
  flush();
  return keys;
}

function CountCell({ bucket, label, selected, onSelect, today }: { bucket: ScoreChartBucket; label: string; selected: boolean; onSelect: (key: string) => void; today: string }) {
  const strong = bucket.earnedPoints >= 15;
  const ratio = Math.max(0, Math.min(1, bucket.earnedPoints / bucketCapacity(bucket)));
  const future = bucket.startDate > today;
  return <View style={styles.countSlot}><Pressable
    accessibilityRole="button"
    accessibilityLabel={bucketAccessibilityLabel(bucket, today)}
    accessibilityState={{ selected }}
    onPress={() => onSelect(bucket.key)}
    style={[styles.countCell, bucket.earnedPoints > 0 && styles.countCellSome, strong && styles.countCellStrong, future && styles.countCellFuture, selected && styles.cellSelected]}
  >
    <Text style={[styles.countLabel, strong && styles.cellTextRead, future && styles.cellTextFuture]}>{label}</Text>
    <Text style={[styles.countValue, strong && styles.cellTextRead, future && styles.cellTextFuture]}>{future ? '—' : `${bucket.earnedPoints} 天`}</Text>
    {!future ? <View style={styles.countBar} testID="count-bar"><View style={[styles.countBarFill, strong && styles.countBarFillStrong, { width: `${Math.round(ratio * 100)}%` }]} /></View> : null}
  </Pressable></View>;
}

export function ScoreProfileChart({ chart: suppliedChart, fallbackMonths, onChartChange, today: suppliedToday }: ScoreProfileChartProps) {
  const chart = suppliedChart ?? fallbackChart(fallbackMonths);
  const isLegacyFallback = suppliedChart === undefined;
  const today = suppliedToday ?? taipeiDate(new Date());
  const [view, setView] = useState<'trend' | 'calendar'>(isLegacyFallback ? 'calendar' : 'trend');
  const defaultKey = () => chart.buckets.find((bucket) => bucket.key === today)?.key ?? chart.buckets.find((bucket) => bucket.key === today.slice(0, 7))?.key ?? chart.buckets.find((bucket) => bucket.key === today.slice(0, 4))?.key ?? chart.buckets.at(-1)?.key ?? null;
  const [selectedKey, setSelectedKey] = useState<string | null>(defaultKey);
  useEffect(() => { setView(isLegacyFallback ? 'calendar' : 'trend'); }, [isLegacyFallback]);
  useEffect(() => { setSelectedKey(defaultKey()); }, [chart.range, chart.anchor, chart.periodStart, chart.periodEnd, chart.buckets.length, today]);
  const calendarChart = { ...chart, buckets: chart.buckets.map((bucket, index) => ({ ...bucket, earnedPoints: earnedThroughToday(chart, index, today) })) };
  const selectedBucket = calendarChart.buckets.find((bucket) => bucket.key === selectedKey) ?? null;
  const cumulativeSelectedBucket = chart.buckets.find((bucket) => bucket.key === selectedKey) ?? null;
  const dailyBuckets = calendarChart.buckets.length > 0 && calendarChart.buckets.every((bucket) => isDayKey(bucket.key));
  const leadingBlanks = dailyBuckets && chart.range === 'month' && calendarChart.buckets[0] ? mondayIndex(calendarChart.buckets[0].key) : 0;
  const perfect = dailyBuckets && chart.range === 'month' ? perfectWeekKeys(calendarChart.buckets) : new Set<string>();
  const perfectWeeks = perfect.size / 7;
  const selectedCumulative = cumulativeSelectedBucket?.cumulativeEarnedPoints;

  return <View style={styles.card}>
    <View style={styles.headingRow}>
      <Text style={styles.cardTitle}>{isLegacyFallback ? '近六個月' : view === 'trend' ? '累積積分走勢' : '讀經日曆'}</Text>
      <Text accessibilityLabel={`本期 ${readDays(calendarChart)} 天${perfectWeeks > 0 ? `，完整週 ${perfectWeeks}` : ''}`} style={styles.periodTotal}>{`本期 ${readDays(calendarChart)} 天${perfectWeeks > 0 ? ` · 完整週 ${perfectWeeks}` : ''}`}</Text>
    </View>
    {!isLegacyFallback ? <View accessibilityRole="tablist" style={styles.rangeSelector}>
      {(['trend', 'calendar'] as const).map((option) => <Pressable key={option} accessibilityRole="tab" accessibilityLabel={option === 'trend' ? '走勢' : '日曆'} accessibilityState={{ selected: view === option }} onPress={() => setView(option)} style={[styles.rangeOption, view === option && styles.rangeOptionActive]}><Text style={[styles.rangeText, view === option && styles.rangeTextActive]}>{option === 'trend' ? '走勢' : '日曆'}</Text></Pressable>)}
    </View> : null}
    {!isLegacyFallback ? <View accessibilityRole="tablist" style={styles.rangeSelector}>
      {RANGE_OPTIONS.map((option) => <Pressable key={option.range} accessibilityRole="tab" accessibilityLabel={option.label} accessibilityState={{ selected: chart.range === option.range }} onPress={() => onChartChange?.(chartQueryForRange(chart, option.range))} style={[styles.rangeOption, chart.range === option.range && styles.rangeOptionActive]}><Text style={[styles.rangeText, chart.range === option.range && styles.rangeTextActive]}>{option.label}</Text></Pressable>)}
    </View> : null}
    {isLegacyFallback ? <Text style={styles.legacyPeriod}>近六個月</Text> : <View style={styles.periodNav}>
      <Pressable accessibilityRole="button" accessibilityLabel="上一個積分期間" accessibilityState={{ disabled: !chart.previousAnchor || !onChartChange }} disabled={!chart.previousAnchor || !onChartChange} onPress={() => chart.previousAnchor && onChartChange?.({ range: chart.range, anchor: chart.previousAnchor })} style={styles.navButton}><Text style={styles.navText}>‹</Text></Pressable>
      <Text accessibilityLabel={`目前積分期間 ${periodLabel(chart)}`} style={styles.periodLabel}>{periodLabel(chart)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="下一個積分期間" accessibilityState={{ disabled: !chart.nextAnchor || !onChartChange }} disabled={!chart.nextAnchor || !onChartChange} onPress={() => chart.nextAnchor && onChartChange?.({ range: chart.range, anchor: chart.nextAnchor })} style={styles.navButton}><Text style={styles.navText}>›</Text></Pressable>
    </View>}
    {chart.buckets.length === 0 ? <Text style={styles.empty}>尚無讀經紀錄</Text> : view === 'trend' ? <CumulativeCurve chart={chart} today={today} selectedKey={selectedKey} onSelect={setSelectedKey} /> : dailyBuckets ? <View>
      <View style={styles.grid}>
        {(chart.range === 'month' ? WEEKDAY_HEADERS : calendarChart.buckets.map((bucket) => WEEKDAY_LABELS[new Date(`${bucket.key}T12:00:00.000Z`).getUTCDay()])).map((label, index) => <View key={`h${index}`} style={styles.slot}><Text style={styles.weekday}>{label}</Text></View>)}
      </View>
      <View style={styles.grid}>
        {Array.from({ length: leadingBlanks }, (_, index) => <View key={`b${index}`} style={styles.slot}><View style={styles.cellBlank} /></View>)}
        {calendarChart.buckets.map((bucket) => <DayCell key={bucket.key} bucket={bucket} today={today} selected={bucket.key === selectedKey} onSelect={setSelectedKey} perfect={perfect.has(bucket.key)} />)}
      </View>
    </View> : <View style={styles.countGrid}>
      {calendarChart.buckets.map((bucket) => <CountCell key={bucket.key} bucket={bucket} today={today} label={isMonthKey(bucket.key) ? `${Number(bucket.key.slice(5, 7))}月` : `${bucket.key}年`} selected={bucket.key === selectedKey} onSelect={setSelectedKey} />)}
    </View>}
    {selectedBucket && view === 'trend' && selectedCumulative !== undefined ? <Text accessibilityLiveRegion="polite" style={styles.selectedLabel}>{`選取：${bucketPeriodLabel(selectedBucket)}　累積 ${selectedCumulative} 分`}</Text> : view === 'calendar' && selectedBucket ? <Text accessibilityLiveRegion="polite" style={styles.selectedLabel}>{selectedLabel(selectedBucket, today)}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderRadius: theme.radius.card, borderLeftColor: theme.colors.primary, borderLeftWidth: theme.control.rail, padding: theme.spacing.md, gap: theme.spacing.sm },
  headingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.spacing.sm },
  cardTitle: { color: theme.colors.ink, fontSize: theme.type.heading.size, fontWeight: '800' },
  periodTotal: { color: theme.colors.primaryDeep, fontSize: theme.type.label.size, fontWeight: '800' },
  rangeSelector: { flexDirection: 'row', gap: theme.spacing.xs, borderBottomColor: theme.colors.border, borderBottomWidth: theme.control.hairline },
  rangeOption: { flex: 1, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: theme.control.hairline, borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface },
  rangeOptionActive: { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary },
  rangeText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' },
  rangeTextActive: { color: theme.colors.primaryDeep },
  curveControl: { minHeight: 144 },
  trendFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  trendDate: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line },
  trendOpening: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
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
  // A whole Monday–Sunday row read: the seven cells deepen together, a capped "streak" that never punishes.
  cellPerfect: { backgroundColor: theme.colors.primaryDeep },
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
  countCellFuture: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.border },
  countBar: { width: '80%', height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden', marginTop: 3 },
  countBarFill: { height: 4, borderRadius: 2, backgroundColor: theme.colors.primary },
  countBarFillStrong: { backgroundColor: theme.colors.white },
  countLabel: { color: theme.colors.ink, fontSize: theme.type.caption.size, fontWeight: '800' },
  countValue: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line },
  selectedLabel: { color: theme.colors.ink, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, fontWeight: '700' },
  empty: { color: theme.colors.muted, fontSize: theme.type.body.size, paddingVertical: theme.spacing.lg },
});

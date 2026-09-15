import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MonthPoints, ScoreChart, ScoreChartBucket, ScoreChartQuery, ScoreChartRange } from '../../services/gamificationApiClient';
import { theme } from '../Theme';

const PLOT_HEIGHT = 120;
const X_AXIS_HEIGHT = 20;
const RANGE_OPTIONS: Array<{ range: ScoreChartRange; label: string }> = [
  { range: 'week', label: '週' },
  { range: 'month', label: '月' },
  { range: 'year', label: '年' },
  { range: 'all', label: '全部' },
];
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export interface ScoreProfileChartProps {
  chart?: ScoreChart;
  fallbackMonths: MonthPoints[];
  onChartChange?: (query: ScoreChartQuery) => void;
}

export function chartQueryForRange(chart: ScoreChart, range: ScoreChartRange): ScoreChartQuery {
  if (range === 'all') return { range };
  if (chart.range === 'all') return { range };
  const periodStart = chart.periodStart;
  const anchor = range === 'week'
    ? periodStart ?? undefined
    : range === 'month'
      ? periodStart?.slice(0, 7)
      : periodStart?.slice(0, 4);
  return anchor ? { range, anchor } : { range };
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

function periodLabel(chart: ScoreChart): string {
  if (chart.range === 'all') return '全部紀錄';
  if (!chart.periodStart || !chart.periodEnd) return '積分紀錄';
  if (chart.range === 'month') return yearMonthLabel(chart.periodStart.slice(0, 7));
  if (chart.range === 'year') return `${chart.periodStart.slice(0, 4)}年`;
  return chart.periodStart.slice(0, 4) === chart.periodEnd.slice(0, 4)
    ? `${shortDateLabel(chart.periodStart)}–${shortDateLabel(chart.periodEnd)}`
    : `${shortDateLabel(chart.periodStart)}–${dateLabel(chart.periodEnd)}`;
}

function bucketLabel(chart: ScoreChart, bucket: ScoreChartBucket, index: number): string {
  if (chart.range === 'week') return `週${WEEKDAY_LABELS[new Date(`${bucket.startDate}T12:00:00.000Z`).getUTCDay()]}`;
  if (chart.range === 'month') {
    if (/^\d{4}-\d{2}$/.test(bucket.key)) return `${Number(bucket.key.slice(5, 7))}月`;
    return index === 0 || index % 5 === 0 || index === chart.buckets.length - 1 ? String(Number(bucket.key.slice(8, 10))) : '';
  }
  if (chart.range === 'year') return index % 2 === 0 || index === chart.buckets.length - 1 ? `${Number(bucket.key.slice(5, 7))}月` : '';
  return bucket.key;
}

function bucketAccessibilityLabel(chart: ScoreChart, bucket: ScoreChartBucket): string {
  const period = chart.range === 'all' ? `${bucket.key}年` : chart.range === 'year' ? yearMonthLabel(bucket.key) : /^\d{4}-\d{2}$/.test(bucket.key) ? bucket.key : bucket.startDate;
  return `${period} ${bucket.earnedPoints} 分`;
}

function axisUpperBound(buckets: readonly ScoreChartBucket[]): number {
  return Math.max(1, ...buckets.map((bucket) => bucket.earnedPoints));
}

function axisTicks(upperBound: number): number[] {
  if (upperBound <= 1) return [1, 0];
  const middle = Math.max(1, Math.ceil(upperBound / 2));
  return [upperBound, middle, 0];
}

function tickPosition(tick: number, upperBound: number): number {
  return Math.round((1 - tick / upperBound) * (PLOT_HEIGHT - 1));
}

function selectedLabel(chart: ScoreChart, bucket: ScoreChartBucket): string {
  const period = chart.range === 'all' ? `${bucket.key}年` : chart.range === 'year' ? yearMonthLabel(bucket.key) : /^\d{4}-\d{2}$/.test(bucket.key) ? yearMonthLabel(bucket.key) : shortDateLabel(bucket.startDate);
  return `選取：${period}，${bucket.earnedPoints} 分`;
}

export function ScoreProfileChart({ chart: suppliedChart, fallbackMonths, onChartChange }: ScoreProfileChartProps) {
  const chart = suppliedChart ?? fallbackChart(fallbackMonths);
  const isLegacyFallback = suppliedChart === undefined;
  const [selectedKey, setSelectedKey] = useState<string | null>(chart.buckets.at(-1)?.key ?? null);
  useEffect(() => { setSelectedKey(chart.buckets.at(-1)?.key ?? null); }, [chart.range, chart.anchor, chart.periodStart, chart.periodEnd, chart.buckets.length]);
  const selectedIndex = Math.max(0, chart.buckets.findIndex((bucket) => bucket.key === selectedKey));
  const selectedBucket = chart.buckets[selectedIndex] ?? null;
  const upperBound = axisUpperBound(chart.buckets);
  const ticks = useMemo(() => axisTicks(upperBound), [upperBound]);
  const selectData = (offset: number) => {
    if (chart.buckets.length === 0) return;
    const nextIndex = Math.min(chart.buckets.length - 1, Math.max(0, selectedIndex + offset));
    setSelectedKey(chart.buckets[nextIndex].key);
  };

  return <View style={styles.card}>
    <View style={styles.headingRow}>
      <Text style={styles.cardTitle}>{isLegacyFallback ? '近六個月' : '積分趨勢'}</Text>
      <Text accessibilityLabel={`本期 ${chart.earnedPoints} 分`} style={styles.periodTotal}>{`本期 ${chart.earnedPoints} 分`}</Text>
    </View>
    {!isLegacyFallback ? <View accessibilityRole="tablist" style={styles.rangeSelector}>
      {RANGE_OPTIONS.map((option) => <Pressable key={option.range} accessibilityRole="tab" accessibilityLabel={option.label} accessibilityState={{ selected: chart.range === option.range }} onPress={() => onChartChange?.(chartQueryForRange(chart, option.range))} style={[styles.rangeOption, chart.range === option.range && styles.rangeOptionActive]}><Text style={[styles.rangeText, chart.range === option.range && styles.rangeTextActive]}>{option.label}</Text></Pressable>)}
    </View> : null}
    {isLegacyFallback ? <Text style={styles.legacyPeriod}>近六個月</Text> : <View style={styles.periodNav}>
      <Pressable accessibilityRole="button" accessibilityLabel="上一個積分期間" accessibilityState={{ disabled: !chart.previousAnchor || !onChartChange }} disabled={!chart.previousAnchor || !onChartChange} onPress={() => chart.previousAnchor && onChartChange?.({ range: chart.range, anchor: chart.previousAnchor })} style={styles.navButton}><Text style={styles.navText}>‹</Text></Pressable>
      <Text accessibilityLabel={`目前積分期間 ${periodLabel(chart)}`} style={styles.periodLabel}>{periodLabel(chart)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="下一個積分期間" accessibilityState={{ disabled: !chart.nextAnchor || !onChartChange }} disabled={!chart.nextAnchor || !onChartChange} onPress={() => chart.nextAnchor && onChartChange?.({ range: chart.range, anchor: chart.nextAnchor })} style={styles.navButton}><Text style={styles.navText}>›</Text></Pressable>
    </View>}
    {chart.buckets.length === 0 ? <Text style={styles.empty}>尚無已獲得積分</Text> : <View style={styles.plotRow}>
      <View style={styles.yAxis}>{ticks.map((tick) => <Text key={tick} style={[styles.axisLabel, { top: Math.max(0, Math.min(PLOT_HEIGHT - 8, tickPosition(tick, upperBound) - 8)) }]}>{tick}</Text>)}</View>
      <View style={styles.plotBody}>
        <View style={styles.gridLines}>{ticks.map((tick) => <View key={tick} style={[styles.gridLine, { top: tickPosition(tick, upperBound) }]} />)}</View>
        <View style={styles.barRow}>
          {chart.buckets.map((bucket, index) => {
            const label = bucketLabel(chart, bucket, index);
            const height = bucket.earnedPoints > 0 ? Math.max(1, Math.round((bucket.earnedPoints / upperBound) * PLOT_HEIGHT)) : 0;
            return <View key={bucket.key} accessible accessibilityRole="image" accessibilityLabel={bucketAccessibilityLabel(chart, bucket)} accessibilityState={{ selected: bucket.key === selectedKey }} style={[styles.barColumn, bucket.key === selectedKey && styles.barColumnSelected]}>
              <View style={styles.barSlot}>{bucket.earnedPoints > 0 ? <View style={[styles.bar, { height }]} /> : null}</View>
              <Text style={styles.xAxisLabel}>{label}</Text>
            </View>;
          })}
        </View>
      </View>
    </View>}
    {selectedBucket ? <View style={styles.dataNav}>
      <Pressable accessibilityRole="button" accessibilityLabel="上一個資料柱" accessibilityState={{ disabled: selectedIndex <= 0 }} disabled={selectedIndex <= 0} onPress={() => selectData(-1)} style={styles.dataNavButton}><Text style={styles.dataNavText}>‹</Text></Pressable>
      <Text accessible accessibilityRole="adjustable" accessibilityLabel="圖表資料選取" accessibilityValue={{ text: selectedLabel(chart, selectedBucket) }} accessibilityActions={[{ name: 'decrement', label: '上一個資料柱' }, { name: 'increment', label: '下一個資料柱' }]} onAccessibilityAction={(event) => selectData(event.nativeEvent.actionName === 'increment' ? 1 : -1)} style={styles.selectedLabel}>{selectedLabel(chart, selectedBucket)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="下一個資料柱" accessibilityState={{ disabled: selectedIndex >= chart.buckets.length - 1 }} disabled={selectedIndex >= chart.buckets.length - 1} onPress={() => selectData(1)} style={styles.dataNavButton}><Text style={styles.dataNavText}>›</Text></Pressable>
    </View> : null}
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
  plotRow: { minHeight: PLOT_HEIGHT + X_AXIS_HEIGHT, flexDirection: 'row', gap: theme.spacing.xs },
  yAxis: { width: 26, height: PLOT_HEIGHT + X_AXIS_HEIGHT, position: 'relative', alignItems: 'flex-end' },
  axisLabel: { position: 'absolute', color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line },
  plotBody: { flex: 1, minWidth: 0, height: PLOT_HEIGHT + X_AXIS_HEIGHT, position: 'relative' },
  gridLines: { position: 'absolute', top: 0, left: 0, right: 0, height: PLOT_HEIGHT, pointerEvents: 'none' },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, borderTopColor: theme.colors.border, borderTopWidth: theme.control.hairline },
  barRow: { height: PLOT_HEIGHT + X_AXIS_HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: 1 },
  barColumn: { flex: 1, height: PLOT_HEIGHT + X_AXIS_HEIGHT, alignItems: 'center', justifyContent: 'flex-end' },
  barColumnSelected: { borderColor: theme.colors.primary, borderLeftWidth: 1, borderRightWidth: 1 },
  barSlot: { width: '100%', height: PLOT_HEIGHT, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '56%', backgroundColor: theme.colors.primary, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  xAxisLabel: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line, minHeight: X_AXIS_HEIGHT },
  dataNav: { minHeight: theme.control.tap, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  dataNavButton: { minWidth: theme.control.tap, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, borderColor: theme.colors.borderStrong, borderWidth: theme.control.hairline, backgroundColor: theme.colors.surface },
  dataNavText: { color: theme.colors.primary, fontSize: 26, lineHeight: 30 },
  selectedLabel: { flex: 1, color: theme.colors.ink, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, fontWeight: '700', textAlign: 'center' },
  empty: { color: theme.colors.muted, fontSize: theme.type.body.size, paddingVertical: theme.spacing.lg },
});

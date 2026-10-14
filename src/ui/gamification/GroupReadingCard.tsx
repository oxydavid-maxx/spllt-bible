import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import type { GroupReading } from '../../services/devotionClient';
import { monthCells } from './readingCalendarModel';
import { monthName, monthSummary, myPrizeLine, prizeProgress, prizeRule, readersLevel } from './groupReadingModel';
import { theme } from '../Theme';

/**
 * 團體 on the 積分 page (維護者 2026-10-14): how many youth read each day, and the prizes the church
 * buys when enough of them read fifteen days in a month. Reading only; 靈修 is never counted here.
 * A day with fewer than two readers shows no number, so nobody can be picked out of it.
 */

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const LEVEL_STYLE = [{ backgroundColor: theme.colors.surfaceMuted }, { backgroundColor: theme.colors.primarySoft }, { backgroundColor: '#A9CDB7' }, { backgroundColor: theme.colors.primary }] as const;

export interface GroupReadingCardProps {
  view: GroupReading;
  onPreviousMonth?: () => void;
  onNextMonth?: () => void;
  /** Opens the prize nominations when a round is open; absent, the last row is only words. */
  onSuggestPrize?: () => void;
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={theme.colors.primary} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><Path d={direction === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} /></Svg>;
}

function PrizeIcon({ icon }: { icon: 'beanbag' | 'sofa' | 'next' }) {
  const color = icon === 'beanbag' ? theme.colors.accent : theme.colors.muted;
  if (icon === 'next') return <View style={[styles.prizeIcon, styles.prizeIconNext]}><Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={theme.colors.borderStrong} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Rect x={3} y={8} width={18} height={4} /><Path d="M12 8v13M5 12v9h14v-9" /><Path d="M12 8c-2-4-6-4-6-1s6 1 6 1zM12 8c2-4 6-4 6-1s-6 1-6 1z" /></Svg></View>;
  return <View style={[styles.prizeIcon, { backgroundColor: icon === 'beanbag' ? theme.colors.accentSoft : theme.colors.surfaceMuted }]}>
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {icon === 'beanbag'
        ? <><Path d="M5 19c-2-3-1-9 3-12 3-2 7-1 9 2s3 7 2 10z" /><Path d="M4 19h16" /></>
        : <><Path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3" /><Path d="M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2z" /><Path d="M5 18v2M19 18v2" /></>}
    </Svg>
  </View>;
}

function Count({ label, readers }: { label: string; readers: number | null }) {
  return <View style={styles.countBox} accessible accessibilityLabel={readers === null ? `${label}不到 2 人讀` : `${label} ${readers} 人讀了`}>
    <Text style={styles.countLabel}>{label}</Text>
    {readers === null ? <Text style={styles.countFew}>不到 2 人</Text> : <Text style={styles.countLine}><Text style={styles.countNumber}>{readers}</Text> 人讀了</Text>}
  </View>;
}

export function GroupReadingCard({ view, onPreviousMonth, onNextMonth, onSuggestPrize }: GroupReadingCardProps) {
  const readers = new Map(view.days.map((day) => [day.date, day.readers]));
  const busiest = view.busiest?.readers ?? 0;
  const summary = monthSummary(view);
  const firstOpen = view.prizes.findIndex((prize) => prize.achievedMonths < prize.months);
  const currentMonthName = monthName(view.today.slice(0, 7));
  return <View style={styles.card} accessibilityLabel="青少一起讀經">
    <View style={styles.titleRow}>
      <Text accessibilityRole="header" style={styles.title}>青少一起讀經</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="上個月" accessibilityState={{ disabled: !onPreviousMonth }} disabled={!onPreviousMonth} onPress={onPreviousMonth} style={[styles.monthStep, !onPreviousMonth && styles.disabled]}><Chevron direction="left" /></Pressable>
      <Text style={styles.monthLabel}>{monthName(view.month)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="下個月" accessibilityState={{ disabled: !onNextMonth }} disabled={!onNextMonth} onPress={onNextMonth} style={[styles.monthStep, !onNextMonth && styles.disabled]}><Chevron direction="right" /></Pressable>
    </View>
    <View style={styles.counts}>
      <Count label="今天 (還在進行)" readers={view.todayReaders} />
      <Count label="昨天" readers={view.yesterdayReaders} />
    </View>
    <Text style={styles.caption}>每一格是那天讀經的人數，顏色越深人越多</Text>
    <View>
      <View style={styles.grid}>{WEEKDAYS.map((label) => <View key={label} style={styles.slot}><Text style={styles.weekday}>{label}</Text></View>)}</View>
      <View style={styles.grid}>
        {monthCells(view.month).map((date, index) => {
          if (!date) return <View key={`b${index}`} style={styles.slot} />;
          const day = Number(date.slice(8, 10));
          if (date > view.today || !readers.has(date)) return <View key={date} style={styles.slot}><View style={[styles.cell, styles.cellFuture]}><Text style={styles.futureText}>{day}</Text></View></View>;
          const count = readers.get(date) ?? null;
          const level = readersLevel(count, busiest);
          return <View key={date} style={styles.slot}><View accessible accessibilityLabel={count === null ? `${date} 不到 2 人` : `${date} ${count} 人`} style={[styles.cell, LEVEL_STYLE[level], date === view.today && styles.cellToday]}>
            <Text style={[styles.cellDay, level === 3 && styles.cellDayDark]}>{day}</Text>
            {count !== null ? <Text style={[styles.cellCount, level === 3 && styles.cellCountDark]}>{count}</Text> : null}
          </View></View>;
        })}
      </View>
    </View>
    <View style={styles.legendRow}>
      <Text style={styles.legendText}>不到 2 人的日子不顯示人數</Text>
      <View style={styles.scale}><Text style={styles.legendText}>少</Text>{[1, 2, 3].map((level) => <View key={level} style={[styles.swatch, LEVEL_STYLE[level]]} />)}<Text style={styles.legendText}>多</Text></View>
    </View>
    {summary ? <Text style={styles.summary}>{summary.lead}<Text style={styles.bold}>{summary.reads}</Text>{summary.middle}{summary.busiest ? <Text style={styles.bold}>{summary.busiest}</Text> : null}{summary.tail}</Text> : null}

    <View style={styles.prizes}>
      <View style={styles.prizeHeader}><Text accessibilityRole="header" style={styles.prizeTitle}>團體獎</Text><Text style={styles.prizeNote}>大家一起達成，教會買給大家</Text></View>
      {view.prizes.map((prize, index) => {
        const first = index === firstOpen;
        return <View key={prize.id} style={styles.prize}>
          <PrizeIcon icon={prize.icon} />
          <View style={styles.prizeCopy}>
            <View style={styles.prizeNameRow}><Text style={styles.prizeName}>{prize.name}</Text><Text style={[styles.prizeMonths, first && styles.prizeMonthsActive]}>{`${prize.achievedMonths}/${prize.months} 個月`}</Text></View>
            <Text style={styles.prizeRule}>{prizeRule(prize, view.qualifyingDays, index === 0)}</Text>
            <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.round(prizeProgress(prize) * 100)}%` }, !first && styles.barFillQuiet]} /></View>
            <Text style={styles.prizeLine}>{`${currentMonthName}已有 `}<Text style={styles.bold}>{prize.qualifiedThisMonth}</Text>{`/${prize.members} 人讀滿 ${view.qualifyingDays} 天`}</Text>
            {first ? <Text style={styles.prizeMine}>{myPrizeLine(view.myDaysThisMonth, view.qualifyingDays)}</Text> : null}
          </View>
        </View>;
      })}
      <Pressable accessibilityRole={onSuggestPrize ? 'button' : 'text'} disabled={!onSuggestPrize} onPress={onSuggestPrize} style={styles.nextPrize}>
        <PrizeIcon icon="next" />
        <Text style={styles.nextPrizeText}>下一個獎品，由你決定</Text>
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, padding: 14, gap: theme.spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  title: { flex: 1, color: theme.colors.ink, fontSize: 18, lineHeight: 24, fontWeight: '800' },
  monthStep: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { color: theme.colors.primary, fontSize: theme.type.body.size, fontWeight: '800' },
  disabled: { opacity: 0.35 },
  counts: { flexDirection: 'row', gap: theme.spacing.sm },
  countBox: { flex: 1, backgroundColor: theme.colors.surfaceMuted, borderRadius: theme.radius.button, paddingVertical: 10, paddingHorizontal: theme.spacing.md, gap: 2 },
  countLabel: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, fontWeight: '700' },
  countLine: { color: theme.colors.ink, fontSize: theme.type.body.size, lineHeight: 38, fontWeight: '700' },
  countNumber: { color: theme.colors.primary, fontSize: 32, lineHeight: 38, fontWeight: '800' },
  countFew: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: 38, fontWeight: '700' },
  caption: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  slot: { width: '14.2857%', padding: 2 },
  weekday: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line, textAlign: 'center', paddingBottom: 2 },
  cell: { height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cellFuture: { backgroundColor: theme.colors.surfaceMuted },
  futureText: { color: '#B5C2B9', fontSize: theme.type.micro.size, fontWeight: '600' },
  cellToday: { borderWidth: 2, borderColor: theme.colors.accent },
  cellDay: { position: 'absolute', top: 3, left: 5, color: theme.colors.muted, fontSize: 10, lineHeight: 11, fontWeight: '600' },
  cellDayDark: { color: theme.colors.primarySoft },
  cellCount: { color: theme.colors.ink, fontSize: 16, fontWeight: '800' },
  cellCountDark: { color: theme.colors.white },
  legendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  legendText: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line },
  scale: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  swatch: { width: 14, height: 14, borderRadius: 3 },
  summary: { color: theme.colors.ink, fontSize: theme.type.label.size, lineHeight: theme.type.label.line },
  bold: { fontWeight: '800' },
  prizes: { borderTopWidth: theme.control.hairline, borderTopColor: theme.colors.border, paddingTop: theme.spacing.md, gap: theme.spacing.md },
  prizeHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  prizeTitle: { flex: 1, color: theme.colors.ink, fontSize: 17, lineHeight: 24, fontWeight: '800' },
  prizeNote: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  prize: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  prizeIcon: { width: 40, height: 40, borderRadius: theme.radius.button, alignItems: 'center', justifyContent: 'center' },
  prizeIconNext: { borderWidth: theme.control.hairline, borderStyle: 'dashed', borderColor: theme.colors.borderStrong },
  prizeCopy: { flex: 1, minWidth: 0, gap: 5 },
  prizeNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: theme.spacing.sm },
  prizeName: { flexShrink: 1, color: theme.colors.ink, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  prizeMonths: { color: theme.colors.muted, fontSize: theme.type.caption.size, fontWeight: '800' },
  prizeMonthsActive: { color: theme.colors.primary },
  prizeRule: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  bar: { height: 8, borderRadius: 4, backgroundColor: theme.colors.primarySoft, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4, backgroundColor: theme.colors.primary },
  barFillQuiet: { backgroundColor: theme.colors.borderStrong },
  prizeLine: { color: theme.colors.ink, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  prizeMine: { color: theme.colors.accent, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, fontWeight: '700' },
  nextPrize: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nextPrizeText: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line },
});

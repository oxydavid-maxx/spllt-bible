import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../Theme';
import { dayState, monthCells, type CalendarDays, type DayState } from './readingCalendarModel';

/**
 * The member's own reading calendar on 積分 (個人): this month's readings, and a tap picks a day.
 * Green is done, a dark ring is today, a clay ring is the day you picked.
 *
 * The picked day's line and its two buttons are not here (維護者 2026-10-19): they are the day card at
 * the top of the page (`SelectedDayCard`), so the buttons are the first thing on it.
 */

const WEEKDAY_HEADERS = ['日', '一', '二', '三', '四', '五', '六'];
const STATE_LABEL: Record<DayState, string> = { open: '未完成', completed: '已完成', expired: '未完成', rest: '沒有讀經', future: '未到' };

export interface ReadingCalendarCardProps {
  /** YYYY-MM on display. */
  month: string;
  today: string;
  selectedDate: string;
  days: CalendarDays;
  onSelect: (date: string) => void;
  /** Absent means the arrow is shown but cannot be used. */
  onPreviousMonth?: () => void;
  onNextMonth?: () => void;
  onOpenReadingPlan?: () => void;
  onExportReadingCard?: () => void;
  /** Days the member also read the pastor's 靈修: a small gold 「靈修」 under the date. */
  devotionDates?: ReadonlySet<string>;
}

function monthLabel(month: string): string {
  const [year, value] = month.split('-');
  return `${year}年${Number(value)}月`;
}

export function ReadingCalendarCard({ month, today, selectedDate, days, onSelect, onPreviousMonth, onNextMonth, onOpenReadingPlan, onExportReadingCard, devotionDates }: ReadingCalendarCardProps) {
  return <View style={styles.card}>
    <View style={styles.periodNav}>
      <Pressable accessibilityRole="button" accessibilityLabel="上個月" accessibilityState={{ disabled: !onPreviousMonth }} disabled={!onPreviousMonth} onPress={onPreviousMonth} style={styles.navButton}><Text style={styles.navText}>‹</Text></Pressable>
      <Text accessibilityRole="header" style={styles.periodLabel}>{monthLabel(month)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="下個月" accessibilityState={{ disabled: !onNextMonth }} disabled={!onNextMonth} onPress={onNextMonth} style={styles.navButton}><Text style={styles.navText}>›</Text></Pressable>
    </View>
    <View style={styles.grid}>
      {WEEKDAY_HEADERS.map((label) => <View key={label} style={styles.slot}><Text style={styles.weekday}>{label}</Text></View>)}
    </View>
    <View style={styles.grid}>
      {monthCells(month).map((date, index) => {
        if (!date) return <View key={`b${index}`} style={styles.slot}><View style={styles.cellBlank} /></View>;
        const state = dayState(date, today, days.get(date));
        const selected = date === selectedDate;
        const devoted = devotionDates?.has(date) ?? false;
        return <View key={date} style={styles.slot}><Pressable
          accessibilityRole="button"
          accessibilityLabel={`${date} ${STATE_LABEL[state]}${devoted ? ' 也讀了靈修' : ''}${date === today ? ' 今天' : ''}`}
          accessibilityState={{ selected }}
          onPress={() => onSelect(date)}
          // Today's dark ring already marks the day the page opens on; the clay ring is for another day picked.
          style={[styles.cell, state === 'completed' && styles.cellDone, date > today && styles.cellFuture, date === today && styles.cellToday, selected && date !== today && styles.cellSelected]}
        >
          <Text style={[styles.cellText, state === 'completed' && styles.cellTextDone, selected && styles.cellTextSelected]}>{Number(date.slice(8, 10))}</Text>
          {devoted ? <Text style={[styles.devotionMark, state === 'completed' && styles.devotionMarkDone]}>靈修</Text> : null}
        </Pressable></View>;
      })}
    </View>
    {devotionDates ? <View style={styles.legend}>
      <View style={styles.legendItem}><View style={styles.legendDone} /><Text style={styles.legendText}>讀完經文</Text></View>
      <Text style={styles.legendText}><Text style={styles.legendDevotion}>靈修</Text>＝那天也讀了靈修</Text>
    </View> : null}
    {onExportReadingCard || onOpenReadingPlan ? <View style={styles.footer}>
      {onExportReadingCard ? <Pressable accessibilityRole="button" accessibilityLabel="匯出讀經卡" onPress={onExportReadingCard} style={styles.exportLink}><Text style={styles.planLinkText}>匯出讀經卡 ›</Text></Pressable> : null}
      {onOpenReadingPlan ? <Pressable accessibilityRole="button" accessibilityLabel="整份計畫" onPress={onOpenReadingPlan} style={styles.planLink}><Text style={styles.planLinkText}>整份計畫 ›</Text></Pressable> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderRadius: theme.radius.card, padding: 14, gap: 6 },
  periodNav: { minHeight: theme.control.tap, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.xs },
  navButton: { minWidth: theme.control.tap, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, borderColor: theme.colors.borderStrong, borderWidth: theme.control.hairline, backgroundColor: theme.colors.surface },
  navText: { color: theme.colors.primary, fontSize: 30, lineHeight: 32 },
  periodLabel: { flex: 1, color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '800', textAlign: 'center' },
  // Seven slots per row, each carrying its own gutter, as in the trend card's old calendar.
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  slot: { width: '14.2857%', padding: 2 },
  weekday: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line, textAlign: 'center' },
  cellBlank: { height: 40 },
  cell: { height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceMuted },
  devotionMark: { color: theme.colors.goldText, fontSize: 11, lineHeight: 12, fontWeight: '700' },
  devotionMarkDone: { color: theme.colors.goldOnPrimary },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  legendDone: { width: 12, height: 12, borderRadius: 3, backgroundColor: theme.colors.primary },
  legendText: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line },
  legendDevotion: { color: theme.colors.goldText, fontWeight: '700' },
  cellDone: { backgroundColor: theme.colors.primary },
  cellFuture: { opacity: 0.45 },
  cellToday: { borderWidth: 2, borderColor: theme.colors.primaryDeep },
  // Clay, the app's "needs you" colour: this is the day the card at the top of the page acts on.
  cellSelected: { borderWidth: 3, borderColor: theme.colors.accent, opacity: 1 },
  cellText: { color: theme.colors.ink, fontSize: theme.type.caption.size, fontWeight: '700' },
  cellTextDone: { color: theme.colors.white },
  cellTextSelected: { fontWeight: '900' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  exportLink: { minHeight: theme.control.tap, justifyContent: 'center' },
  planLink: { marginLeft: 'auto', minHeight: theme.control.tap, justifyContent: 'center' },
  planLinkText: { color: theme.colors.primary, fontSize: theme.type.caption.size, fontWeight: '800' },
});

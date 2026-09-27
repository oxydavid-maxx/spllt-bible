import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatReferenceListZhTw } from '../../domain/scriptureReference';
import { theme } from '../Theme';
import { dayHeading, dayMessage, dayState, monthCells, type CalendarDays, type DayState } from './readingCalendarModel';

/**
 * The first card on the member's own 積分 page: this month's readings, and under the grid the one
 * day that is selected. Green is done, a dark ring is today, a clay ring is the day you picked.
 *
 * The completion button is not drawn here. The screen owns the completion controller for the
 * selected day and hands its button in as `action`, shown only for a day that can be completed or
 * undone; every other day gets one line saying why not.
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
  /** The selected day's completion button, with anything it needs to say about syncing. */
  action?: ReactNode;
}

function monthLabel(month: string): string {
  const [year, value] = month.split('-');
  return `${year}年${Number(value)}月`;
}

export function ReadingCalendarCard({ month, today, selectedDate, days, onSelect, onPreviousMonth, onNextMonth, action }: ReadingCalendarCardProps) {
  const selectedDay = days.get(selectedDate);
  const selectedState = dayState(selectedDate, today, selectedDay);
  const message = dayMessage(selectedDate, selectedState);
  const passages = selectedDay ? formatReferenceListZhTw(selectedDay.references) : '';
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
        return <View key={date} style={styles.slot}><Pressable
          accessibilityRole="button"
          accessibilityLabel={`${date} ${STATE_LABEL[state]}${date === today ? ' 今天' : ''}`}
          accessibilityState={{ selected }}
          onPress={() => onSelect(date)}
          style={[styles.cell, state === 'completed' && styles.cellDone, state === 'future' && styles.cellFuture, date === today && styles.cellToday, selected && styles.cellSelected]}
        >
          <Text style={[styles.cellText, state === 'completed' && styles.cellTextDone, selected && styles.cellTextSelected]}>{Number(date.slice(8, 10))}</Text>
        </Pressable></View>;
      })}
    </View>
    <View style={styles.selected}>
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : <>
        <View style={styles.dayLine}>
          <Text style={styles.heading}>{dayHeading(selectedDate)}</Text>
          {passages ? <Text style={styles.passages}>{passages}</Text> : null}
        </View>
        {action}
      </>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderRadius: theme.radius.card, padding: theme.spacing.md, gap: theme.spacing.xs },
  periodNav: { minHeight: theme.control.tap, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.xs },
  navButton: { minWidth: theme.control.tap, minHeight: theme.control.tap, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.button, borderColor: theme.colors.borderStrong, borderWidth: theme.control.hairline, backgroundColor: theme.colors.surface },
  navText: { color: theme.colors.primary, fontSize: 30, lineHeight: 32 },
  periodLabel: { flex: 1, color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '800', textAlign: 'center' },
  // Seven slots per row, each carrying its own gutter, as in the trend card's old calendar.
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  slot: { width: '14.2857%', padding: 2 },
  weekday: { color: theme.colors.muted, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line, textAlign: 'center' },
  cellBlank: { height: 36 },
  cell: { height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceMuted },
  cellDone: { backgroundColor: theme.colors.primary },
  cellFuture: { opacity: 0.45 },
  cellToday: { borderWidth: 2, borderColor: theme.colors.primaryDeep },
  // Clay, the app's "needs you" colour: this is the day the button below acts on.
  cellSelected: { borderWidth: 3, borderColor: theme.colors.accent },
  cellText: { color: theme.colors.ink, fontSize: theme.type.caption.size, fontWeight: '700' },
  cellTextDone: { color: theme.colors.white },
  cellTextSelected: { fontWeight: '900' },
  selected: { borderTopColor: theme.colors.border, borderTopWidth: theme.control.hairline, marginTop: theme.spacing.xs, paddingTop: theme.spacing.sm, gap: theme.spacing.sm },
  dayLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: theme.spacing.sm },
  heading: { color: theme.colors.ink, fontSize: theme.type.heading.size, lineHeight: theme.type.heading.line, fontWeight: '800' },
  passages: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  message: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '700' },
});

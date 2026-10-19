import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatReferenceListZhTw } from '../../domain/scriptureReference';
import { theme } from '../Theme';
import { dayHeading, dayMessage, dayState, type CalendarDay } from './readingCalendarModel';

/**
 * The first card on the member's own 積分 page (維護者 2026-10-19): the day the calendar below has
 * selected, its passages, and its two buttons, so the daily tap needs no scrolling.
 *
 * Today reads 「今天·10/19 (一)」. Any other day carries a clay 補登 chip before its date and a
 * 回到今天 link, so a tap meant for today does not land on another day. A day that cannot be
 * completed (too old, no reading, not yet here) gets its one line instead of the buttons, and no
 * chip: there is nothing to backfill on it.
 *
 * The buttons are not drawn here. The screen owns the completion controller for the selected day and
 * hands its buttons in as `action`.
 */

export interface SelectedDayCardProps {
  /** The calendar's selected day. */
  date: string;
  today: string;
  /** What the schedule knows about that day; undefined means it has no reading. */
  day: CalendarDay | undefined;
  /** The day's 靈修 and 讀經 buttons, with anything they need to say about syncing. */
  action?: ReactNode;
  onBackToToday?: () => void;
}

export function SelectedDayCard({ date, today, day, action, onBackToToday }: SelectedDayCardProps) {
  const isToday = date === today;
  const message = dayMessage(date, dayState(date, today, day));
  const passages = day ? formatReferenceListZhTw(day.references) : '';
  return <View style={styles.card}>
    {day ? <View style={styles.dayLine}>
      {!isToday && !message ? <Text style={styles.chip}>補登</Text> : null}
      <Text style={styles.heading}>{isToday ? `今天·${dayHeading(date)}` : dayHeading(date)}</Text>
      {passages ? <Text style={styles.passages}>{passages}</Text> : null}
    </View> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : action}
    {!isToday && onBackToToday ? <Pressable accessibilityRole="button" accessibilityLabel="回到今天" onPress={onBackToToday} style={styles.backLink}>
      <Text style={styles.backText}>回到今天 ›</Text>
    </Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: theme.control.hairline, borderRadius: theme.radius.card, padding: 14, gap: theme.spacing.sm },
  dayLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: theme.spacing.sm },
  // Clay, the app's "needs you" colour, the same as the ring on the picked day in the calendar.
  chip: { overflow: 'hidden', paddingHorizontal: theme.spacing.sm, paddingVertical: 1, borderRadius: theme.radius.pill, backgroundColor: theme.colors.warningSoft, color: theme.colors.warning, fontSize: theme.type.micro.size, lineHeight: theme.type.micro.line, fontWeight: '800' },
  heading: { color: theme.colors.ink, fontSize: theme.type.heading.size, lineHeight: theme.type.heading.line, fontWeight: '800' },
  passages: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  message: { color: theme.colors.muted, fontSize: theme.type.body.size, lineHeight: theme.type.body.line, fontWeight: '700' },
  backLink: { alignSelf: 'flex-end', minHeight: theme.control.tap, justifyContent: 'center' },
  backText: { color: theme.colors.primary, fontSize: theme.type.caption.size, fontWeight: '800' },
});

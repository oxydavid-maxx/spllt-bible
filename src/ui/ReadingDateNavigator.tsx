import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from './Theme';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function formatReadingDateLabel(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

export function formatReadingDateWithWeekday(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1)).getUTCDay()] ?? '';
  return `${formatReadingDateLabel(date)}（${weekday}）`;
}

export function formatReadingDateHeader(date: string, today: string): string {
  const label = formatReadingDateWithWeekday(date);
  return date === today ? `今天·${label}` : label;
}

export function formatReadingDateFull(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1)).getUTCDay()] ?? '';
  return `${month}月${day}日 週${weekday}`;
}

export function ReadingDateNavigator({ date, previousDate, nextDate, onSelect }: { date: string; previousDate?: string; nextDate?: string; onSelect: (date: string) => void }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`讀經日期${date}`}>
      <Pressable accessibilityRole="button" accessibilityLabel="上一個排定讀經日" disabled={!previousDate} onPress={() => previousDate && onSelect(previousDate)} style={[styles.step, !previousDate && styles.disabled]}>
        <Text style={[styles.stepText, !previousDate && styles.disabledText]}>{previousDate ? `‹ ${formatReadingDateLabel(previousDate)}` : '‹'}</Text>
      </Pressable>
      <Text style={styles.date} numberOfLines={1}>{formatReadingDateFull(date)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="下一個排定讀經日" disabled={!nextDate} onPress={() => nextDate && onSelect(nextDate)} style={[styles.step, !nextDate && styles.disabled]}>
        <Text style={[styles.stepText, !nextDate && styles.disabledText]}>{nextDate ? `${formatReadingDateLabel(nextDate)} ›` : '›'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // One 48dp band instead of two outlined pills separated by ~219dp of dead space.
  // Each step names the day it leads to, so paging is recognition, not recall.
  row: {
    minHeight: theme.control.tap,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: theme.control.hairline,
    borderRadius: theme.radius.button,
    paddingHorizontal: theme.spacing.xs,
  },
  date: { color: theme.colors.ink, flex: 1, fontSize: theme.type.body.size, fontWeight: '800', textAlign: 'center' },
  step: {
    minWidth: 72,
    minHeight: theme.control.tapCompact,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.chip,
    paddingHorizontal: theme.spacing.sm,
  },
  disabled: { opacity: 0.4 },
  disabledText: { color: theme.colors.muted },
  stepText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '700' },
});

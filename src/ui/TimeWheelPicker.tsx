import { useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { theme } from './Theme';

// Two snapping wheels (hour / minute) like the system clock picker, but pure JS: no native module,
// same look on every device, and every settle commits immediately — there is nothing to "submit",
// so a time can no longer be typed and then lost on back navigation.

export const MINUTE_STEP = 5;
export const ITEM_HEIGHT = 44;
const VISIBLE_ROWS = 3;
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, index) => index * MINUTE_STEP);

export function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Snap any minute to the wheel's step so a stored 08:07 lands on a real wheel row (08:05). */
export function snapMinute(minute: number): number {
  return Math.min(60 - MINUTE_STEP, Math.round(minute / MINUTE_STEP) * MINUTE_STEP);
}

/** Row index for a scroll offset; the wheel keeps one blank row above and below so the centre row is the value. */
export function indexForOffset(offsetY: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round(offsetY / ITEM_HEIGHT)));
}

/** Step the time by whole wheel rows; used by the accessibility increment/decrement actions. */
export function stepTime(value: string, direction: 1 | -1): string {
  const parsed = parseTime(value) ?? { hour: 6, minute: 30 };
  let minute = snapMinute(parsed.minute) + direction * MINUTE_STEP;
  let hour = parsed.hour;
  if (minute >= 60) { minute = 0; hour = (hour + 1) % 24; }
  if (minute < 0) { minute = 60 - MINUTE_STEP; hour = (hour + 23) % 24; }
  return formatTime(hour, minute);
}

function Wheel({ values, selected, onSettle, label }: { values: readonly number[]; selected: number; onSettle: (value: number) => void; label: string }) {
  const ref = useRef<ScrollView | null>(null);
  const selectedIndex = Math.max(0, values.indexOf(selected));
  const lastReported = useRef(selected);
  useEffect(() => {
    lastReported.current = selected;
    ref.current?.scrollTo?.({ y: selectedIndex * ITEM_HEIGHT, animated: false });
  }, [selected, selectedIndex]);
  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const value = values[indexForOffset(event.nativeEvent.contentOffset.y, values.length)];
    if (value === undefined || value === lastReported.current) return;
    lastReported.current = value;
    onSettle(value);
  };
  return <View style={styles.wheel} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <ScrollView
      ref={ref}
      testID={`wheel-${label}`}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_HEIGHT}
      decelerationRate="fast"
      contentOffset={{ x: 0, y: selectedIndex * ITEM_HEIGHT }}
      contentContainerStyle={{ paddingVertical: ITEM_HEIGHT }}
      onMomentumScrollEnd={settle}
      onScrollEndDrag={settle}
      nestedScrollEnabled
    >
      {values.map((value) => <View key={value} style={styles.item}><Text style={[styles.itemText, value === selected && styles.itemTextSelected]}>{String(value).padStart(2, '0')}</Text></View>)}
    </ScrollView>
  </View>;
}

export function TimeWheelPicker({ value, onChange, accessibilityLabel = '每日讀經時間' }: { value: string; onChange: (time: string) => void; accessibilityLabel?: string }) {
  const parsed = useMemo(() => parseTime(value) ?? { hour: 6, minute: 30 }, [value]);
  const minute = snapMinute(parsed.minute);
  const commit = (hour: number, nextMinute: number) => {
    const next = formatTime(hour, nextMinute);
    if (next !== value) onChange(next);
  };
  return <View
    accessible
    accessibilityRole="adjustable"
    accessibilityLabel={accessibilityLabel}
    accessibilityValue={{ text: `${formatTime(parsed.hour, minute)}，上下滑動調整` }}
    accessibilityActions={[{ name: 'increment', label: '晚 5 分鐘' }, { name: 'decrement', label: '早 5 分鐘' }]}
    onAccessibilityAction={(event) => onChange(stepTime(formatTime(parsed.hour, minute), event.nativeEvent.actionName === 'increment' ? 1 : -1))}
    style={styles.picker}
  >
    <View pointerEvents="none" style={styles.band} />
    <Wheel label="hour" values={HOURS} selected={parsed.hour} onSettle={(hour) => commit(hour, minute)} />
    <Text style={styles.colon}>:</Text>
    <Wheel label="minute" values={MINUTES} selected={minute} onSettle={(nextMinute) => commit(parsed.hour, nextMinute)} />
  </View>;
}

const styles = StyleSheet.create({
  picker: { height: ITEM_HEIGHT * VISIBLE_ROWS, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, borderRadius: theme.radius.button, backgroundColor: theme.colors.surfaceMuted, overflow: 'hidden' },
  band: { position: 'absolute', left: theme.spacing.md, right: theme.spacing.md, top: ITEM_HEIGHT, height: ITEM_HEIGHT, borderRadius: theme.radius.chip, backgroundColor: theme.colors.primarySoft },
  wheel: { width: 72, height: ITEM_HEIGHT * VISIBLE_ROWS },
  item: { height: ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  itemText: { color: theme.colors.muted, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  itemTextSelected: { color: theme.colors.primaryDeep, fontSize: 26, fontWeight: '800' },
  colon: { color: theme.colors.primaryDeep, fontSize: 26, fontWeight: '800', marginTop: -4 },
});

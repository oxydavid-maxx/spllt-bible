import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { theme } from './Theme';

/**
 * One of the two buttons under the 積分 calendar (維護者 2026-10-14): gold 靈修 on the left, green
 * 讀經 on the right, the same order as the reader's corner buttons. Not done: filled, an empty
 * ring. Done: white with a filled tick, in the same colour.
 */

export type DayActionTone = 'green' | 'gold';

export interface DayActionButtonProps {
  tone: DayActionTone;
  label: string;
  completed: boolean;
  disabled: boolean;
  busy?: boolean;
  onPress: () => void;
}

const TONE = {
  green: { fill: theme.colors.primary, text: theme.colors.primary },
  gold: { fill: theme.colors.gold, text: theme.colors.goldText },
} as const;

export function DayActionButton({ tone, label, completed, disabled, busy, onPress }: DayActionButtonProps) {
  const colors = TONE[tone];
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled, busy: Boolean(busy) }}
    disabled={disabled}
    onPress={() => { if (!disabled) onPress(); }}
    style={[styles.button, completed ? [styles.completed, { borderColor: colors.fill }] : { backgroundColor: colors.fill }, disabled && styles.disabled]}
  >
    <View style={[styles.circle, completed ? { backgroundColor: colors.fill, borderColor: colors.fill } : styles.ring]}>
      {completed ? <Svg width={16} height={16} viewBox="0 0 24 24"><Path d="M5 12l5 5 9-10" fill="none" stroke={theme.colors.white} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" /></Svg> : null}
    </View>
    <Text style={[styles.label, completed && { color: colors.text }]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { flex: 1, minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.sm, borderRadius: theme.radius.button },
  completed: { backgroundColor: theme.colors.surface, borderWidth: 1.5 },
  disabled: { opacity: 0.68 },
  circle: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 2, borderColor: theme.colors.white },
  label: { flexShrink: 1, color: theme.colors.white, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, fontWeight: '800', textAlign: 'center' },
});

import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from './Theme';
import { BookGlyph, GrownLeafGlyph, LeafGlyph } from './devotion/glyphs';

export interface DayActionButtonProps {
  kind: 'reading' | 'devotion'; label: string; completed: boolean; disabled: boolean; busy?: boolean; onPress: () => void;
}
/** Mock J: outlined until complete, filled green/white once complete, on both platforms. */
export function DayActionButton({ kind, label, completed, disabled, busy, onPress }: DayActionButtonProps) {
  const color = completed ? theme.colors.white : theme.colors.primary;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy: Boolean(busy) }} disabled={disabled}
    onPress={() => { if (!disabled) onPress(); }} style={[styles.button, completed && styles.completed, disabled && styles.disabled]}>
    {kind === 'reading' ? <BookGlyph completed={completed} size={20} color={color} /> : completed ? <GrownLeafGlyph size={22} color={color} /> : <LeafGlyph size={20} color={color} />}
    <Text style={[styles.label, { color }]}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { flex: 1, minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 8, borderRadius: theme.radius.button, borderWidth: 1.5, borderColor: theme.colors.primary, backgroundColor: theme.colors.white },
  completed: { backgroundColor: theme.colors.primary }, disabled: { opacity: 0.68 },
  label: { flexShrink: 1, fontSize: 14, lineHeight: 20, fontWeight: '800' },
});

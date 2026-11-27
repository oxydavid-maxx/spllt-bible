import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from './Theme';
import { makeStyles, useColors } from './useAppTheme';
import { BookGlyph, GrownLeafGlyph, LeafGlyph } from './devotion/glyphs';

export interface DayActionButtonProps {
  kind: 'reading' | 'devotion'; label: string; completed: boolean; disabled: boolean; busy?: boolean; onPress: () => void;
}
/** Mock J: outlined until complete, filled green/white once complete, on both platforms. */
export function DayActionButton({ kind, label, completed, disabled, busy, onPress }: DayActionButtonProps) {
  const styles = useStyles();
  const colors = useColors();
  const color = completed ? colors.onFill : colors.primary;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy: Boolean(busy) }} disabled={disabled}
    onPress={() => { if (!disabled) onPress(); }} style={[styles.button, completed && styles.completed, disabled && styles.disabled]}>
    {kind === 'reading' ? <BookGlyph completed={completed} size={completed ? 22 : 20} color={color} /> : completed ? <GrownLeafGlyph size={22} color={color} /> : <LeafGlyph size={20} color={color} />}
    <Text style={[styles.label, { color }]}>{label}</Text>
  </Pressable>;
}
const useStyles = makeStyles((colors) => ({
  button: { flex: 1, minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 8, borderRadius: theme.radius.button, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.surface },
  completed: { backgroundColor: colors.primaryFill }, disabled: { opacity: 0.68 },
  label: { flexShrink: 1, fontSize: 14, lineHeight: 20, fontWeight: '800' },
}));

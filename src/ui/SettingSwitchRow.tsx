import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from './Theme';
import { makeStyles } from './useAppTheme';

/**
 * A switch row in the reader's ⋯ sheet (維護者 2026-10-14): what it does in words on the left, a
 * system-style switch on the right. Green track with the knob right is on; grey with it left is off.
 */
export function SettingSwitchRow({ label, description, enabled, hint, onPress, help }: { label: string; description: string; enabled: boolean; hint: string; onPress: () => void; help?: string }) {
  const styles = useStyles();
  return <View style={styles.row}>
    <View style={styles.copy}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
    {help ? <Pressable accessibilityRole="button" accessibilityLabel={`${label}是什麼`} onPress={() => Alert.alert(`${label}是什麼？`, help, [{ text: '知道了' }])} style={styles.help}><Text style={styles.question}>?</Text></Pressable> : null}
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ checked: enabled }} onPress={onPress} style={styles.switchTouch}>
    <View testID="autoplay-track" style={[styles.track, enabled ? styles.trackOn : styles.trackOff]}>
      <View testID="autoplay-knob" style={[styles.knob, enabled ? styles.knobOn : styles.knobOff]} />
    </View>
    </Pressable>
  </View>;
}

const useStyles = makeStyles((colors) => ({
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: theme.spacing.sm, borderBottomWidth: theme.control.hairline, borderBottomColor: colors.border },
  help: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  question: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.primary, textAlign: 'center', color: colors.primary, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  switchTouch: { minHeight: 44, minWidth: 50, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 2 },
  label: { color: colors.ink, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  description: { color: colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  track: { width: 50, height: 30, borderRadius: 15, flexShrink: 0 },
  trackOn: { backgroundColor: colors.primaryFill },
  trackOff: { backgroundColor: colors.borderStrong },
  knob: { position: 'absolute', top: 3, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.onFill },
  knobOn: { right: 3 },
  knobOff: { left: 3 },
}));

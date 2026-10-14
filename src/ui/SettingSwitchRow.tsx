import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from './Theme';

/**
 * A switch row in the reader's ⋯ sheet (維護者 2026-10-14): what it does in words on the left, a
 * system-style switch on the right. Green track with the knob right is on; grey with it left is off.
 */
export function SettingSwitchRow({ label, description, enabled, hint, onPress }: { label: string; description: string; enabled: boolean; hint: string; onPress: () => void }) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ checked: enabled }} onPress={onPress} style={styles.row}>
    <View style={styles.copy}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
    <View testID="autoplay-track" style={[styles.track, enabled ? styles.trackOn : styles.trackOff]}>
      <View testID="autoplay-knob" style={[styles.knob, enabled ? styles.knobOn : styles.knobOff]} />
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.sm, borderBottomWidth: theme.control.hairline, borderBottomColor: theme.colors.border },
  copy: { flex: 1, gap: 2 },
  label: { color: theme.colors.ink, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  description: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  track: { width: 50, height: 30, borderRadius: 15, flexShrink: 0 },
  trackOn: { backgroundColor: theme.colors.primary },
  trackOff: { backgroundColor: theme.colors.borderStrong },
  knob: { position: 'absolute', top: 3, width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.white },
  knobOn: { right: 3 },
  knobOff: { left: 3 },
});

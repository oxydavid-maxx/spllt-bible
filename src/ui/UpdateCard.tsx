import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { UpdateState } from '../services/updateCheck';
import { theme } from './Theme';

/**
 * 光佑 (2026-09-27): when the update prompt is dismissed by mistake, the update must still be easy
 * to find. The notice board — the tab people open every week — carries this card for as long as
 * the phone is behind the published build, and it disappears once they have updated.
 */
export function UpdateCard({ state, onUpdate }: { state: UpdateState; onUpdate: (url: string) => void }) {
  if (!state.available || !state.url) return null;
  const url = state.url;
  return <View style={styles.card} accessibilityLabel="有新版本">
    <View style={styles.copy}>
      <Text style={styles.title}>{`有新版本 ${state.versionName ?? ''}`}</Text>
      {state.note ? <Text style={styles.note} numberOfLines={2}>{state.note}</Text> : null}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`更新到 ${state.versionName}`} onPress={() => onUpdate(url)} style={styles.action}>
      <Text style={styles.actionText}>更新</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm, borderRadius: theme.radius.card, backgroundColor: theme.colors.primarySoft, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  copy: { flex: 1, minWidth: 0, gap: theme.spacing.xxs },
  title: { color: theme.colors.ink, fontSize: theme.type.body.size, fontWeight: '800' },
  note: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  action: { minHeight: theme.control.tap, justifyContent: 'center', paddingHorizontal: theme.spacing.lg, borderRadius: theme.radius.button, backgroundColor: theme.colors.primary },
  actionText: { color: theme.colors.white, fontSize: theme.type.label.size, fontWeight: '800' },
});

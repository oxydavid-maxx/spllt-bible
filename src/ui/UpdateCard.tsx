import { Pressable, StyleSheet, Text, View } from 'react-native';
import { updateActionLabel, updateTitle, type UpdateState } from '../services/updateCheck';
import { theme } from './Theme';
import { makeStyles } from './useAppTheme';

/**
 * 光佑 (2026-09-27): when the update prompt is dismissed by mistake, the update must still be easy
 * to find. The notice board — the tab people open every week — carries this card for as long as
 * the phone is behind the published build, and it disappears once they have updated.
 */
export function UpdateCard({ state, onUpdate }: { state: UpdateState; onUpdate: (url: string) => void }) {
  const styles = useStyles();
  if (!state.available || !state.url) return null;
  const url = state.url;
  return <View style={styles.card} accessibilityLabel="有新版本">
    <View style={styles.copy}>
      <Text style={styles.title}>{updateTitle(state)}</Text>
      {state.note ? <Text style={styles.note} numberOfLines={2}>{state.note}</Text> : null}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={updateActionLabel(state)} onPress={() => onUpdate(url)} style={styles.action}>
      <Text style={styles.actionText}>更新</Text>
    </Pressable>
  </View>;
}

const useStyles = makeStyles((colors) => ({
  card: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm, borderRadius: theme.radius.card, backgroundColor: colors.primarySoft, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  copy: { flex: 1, minWidth: 0, gap: theme.spacing.xxs },
  title: { color: colors.ink, fontSize: theme.type.body.size, fontWeight: '800' },
  note: { color: colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  action: { minHeight: theme.control.tap, justifyContent: 'center', paddingHorizontal: theme.spacing.lg, borderRadius: theme.radius.button, backgroundColor: colors.primaryFill },
  actionText: { color: colors.onFill, fontSize: theme.type.label.size, fontWeight: '800' },
}));

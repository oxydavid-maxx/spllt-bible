import { StyleSheet, Text, View } from 'react-native';
import { theme } from './Theme';
import { makeStyles } from './useAppTheme';

export function StatusCard({ title, body, tone = 'info' }: { title: string; body: string; tone?: 'info' | 'warning' }) {
  const styles = useStyles();
  return (
    <View style={[styles.card, tone === 'warning' && styles.warning]} accessible accessibilityRole="summary">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // A ruled note, not a slab: the rail carries the tone so the fill can stay quiet
  // and the block can drop from 129dp to about 86dp without losing a word.
  card: {
    backgroundColor: colors.primarySoft,
    borderLeftWidth: theme.control.rail,
    borderLeftColor: colors.primary,
    borderRadius: theme.radius.card,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.xxs,
  },
  warning: { backgroundColor: colors.accentSoft, borderLeftColor: colors.accent },
  title: { color: colors.ink, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, fontWeight: '800' },
  body: { color: colors.ink, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
}));

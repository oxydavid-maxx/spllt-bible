import { Pressable, StyleSheet, Text } from 'react-native';
import { cardPeriod, type ReadingCardScope } from '../../domain/readingCard';
import { ActionSheet } from './ActionSheet';
import { theme } from '../Theme';
import { makeStyles } from '../useAppTheme';

export function ReadingCardExportSheet({ visible, today, busy, error, onExport, onClose }: {
  visible: boolean; today: string; busy: boolean; error: string | null;
  onExport: (scope: ReadingCardScope) => void; onClose: () => void;
}) {
  const styles = useStyles();
  const period = cardPeriod(today, 'quarter');
  return <ActionSheet visible={visible} title="匯出讀經卡" onClose={onClose} dismissOnOutsideTap>
    {(['month', 'quarter'] as const).map(scope => {
      const label = scope === 'month' ? period.monthLabel : period.quarterLabel;
      return <Pressable key={scope} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => onExport(scope)} style={[styles.button, scope === 'quarter' && styles.secondary, busy && styles.disabled]}>
        <Text style={[styles.label, scope === 'quarter' && styles.secondaryLabel]}>{label}</Text>
      </Pressable>;
    })}
    <Text style={styles.note}>按下去產生 PDF，接著選列印或分享。</Text>
    {busy ? <Text accessibilityLiveRegion="polite" style={styles.note}>正在產生讀經卡…</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </ActionSheet>;
}
const useStyles = makeStyles((colors) => ({
  button: { minHeight: theme.control.tap, padding: theme.spacing.md, borderWidth: 1, borderColor: colors.primaryFill, borderRadius: theme.radius.button, backgroundColor: colors.primaryFill, alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: colors.surface },
  label: { color: colors.onFill, fontSize: theme.type.body.size, fontWeight: '800' },
  secondaryLabel: { color: colors.primary },
  disabled: { opacity: 0.5 },
  note: { color: colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  error: { color: colors.accent, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
}));

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from './Theme';

/**
 * The Save button under the journal, with a label that says whether the writing is saved. The
 * journal also saves on its own, so the button mainly gives the member a clear last step and an
 * answer to "is it saved?". Nothing shows before anything is written.
 */
export function JournalSaveBar({ status, savedAt, onSave }: {
  status: 'empty' | 'unsaved' | 'saved';
  savedAt: string | null;
  onSave: () => void;
}) {
  if (status === 'empty') return null;
  const saved = status === 'saved';
  return <View style={styles.bar}>
    <Text style={saved ? styles.saved : styles.unsaved}>{saved ? `✓ 已儲存${savedAt ? ` ${taipeiClock(savedAt)}` : ''}` : '尚未儲存'}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="儲存日記" accessibilityState={{ disabled: saved }} disabled={saved} onPress={onSave} style={[styles.button, saved && styles.buttonDone]}>
      <Text style={[styles.buttonText, saved && styles.buttonTextDone]}>{saved ? '已儲存' : '儲存'}</Text>
    </Pressable>
  </View>;
}

function taipeiClock(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const local = new Date(time + 8 * 3_600_000);
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md, marginTop: theme.spacing.sm },
  unsaved: { color: theme.colors.muted, fontSize: theme.type.label.size, lineHeight: theme.type.label.line },
  saved: { color: theme.colors.primary, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, fontWeight: '700' },
  button: { minHeight: theme.control.tap, minWidth: 96, paddingHorizontal: theme.spacing.lg, borderRadius: theme.radius.button, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  buttonDone: { backgroundColor: theme.colors.primarySoft },
  buttonText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '700' },
  buttonTextDone: { color: theme.colors.primary },
});

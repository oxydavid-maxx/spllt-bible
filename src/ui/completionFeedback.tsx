import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from './Theme';

export function buildCompletionFeedbackModel(input: { taskDate: string; status: 'COMPLETED' | 'NOT_COMPLETED' | 'UNREPORTED'; syncStatus: 'CONFIRMED' | 'PENDING_SAVE' | 'SAVE_FAILED'; canUndo: boolean }) {
  const [, month, day] = input.taskDate.split('-');
  const dateLabel = `${Number(month)}月${Number(day)}日讀經`;
  const label = input.syncStatus === 'PENDING_SAVE' ? `已保存 ${dateLabel}，等待同步` : input.status === 'COMPLETED' ? `已完成 ${dateLabel}` : `尚未完成 ${dateLabel}`;
  return { label, showUndo: input.canUndo, persistentUndo: input.canUndo } as const;
}

export function CompletionFeedback({ taskDate, status, syncStatus, onUndo }: { taskDate: string; status: 'COMPLETED' | 'NOT_COMPLETED' | 'UNREPORTED'; syncStatus: 'CONFIRMED' | 'PENDING_SAVE' | 'SAVE_FAILED'; onUndo?: () => void }) {
  const [snackbarVisible, setSnackbarVisible] = useState(status === 'COMPLETED');
  const [menuOpen, setMenuOpen] = useState(false);
  const model = buildCompletionFeedbackModel({ taskDate, status, syncStatus, canUndo: Boolean(onUndo && status === 'COMPLETED') });
  return <View style={styles.container}>
    <Text style={styles.label}>{model.label}</Text>
    {snackbarVisible && model.showUndo && <View style={styles.snackbar}><Text style={styles.snackbarText}>已保存，可以撤銷</Text><Pressable accessibilityRole="button" accessibilityLabel="撤銷讀經完成" onPress={onUndo} style={styles.snackbarAction}><Text style={styles.action}>撤銷</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="關閉完成提示" onPress={() => setSnackbarVisible(false)} style={styles.snackbarAction}><Text style={styles.action}>關閉</Text></Pressable></View>}
    {model.persistentUndo && <><Pressable accessibilityRole="button" accessibilityLabel="更多完成操作" onPress={() => setMenuOpen((open) => !open)} style={styles.moreButton}><Text style={styles.more}>⋯</Text></Pressable>{menuOpen && <Pressable accessibilityRole="button" accessibilityLabel="撤銷完成" onPress={onUndo} style={styles.menu}><Text style={styles.menuText}>撤銷完成</Text></Pressable>}</>}
  </View>;
}

const styles = StyleSheet.create({
  // The undo snackbar keeps its own ink ground so it never competes with the
  // pinned completion bar. Its actions are white on ink: primary #1A5544 on
  // ink #15302A is 1.6:1 and was effectively unreadable in RC13.
  container: { gap: theme.spacing.xs },
  label: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  snackbar: { minHeight: theme.control.tapCompact, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, backgroundColor: theme.colors.ink, borderRadius: theme.radius.chip, paddingHorizontal: theme.spacing.md },
  snackbarText: { color: theme.colors.white, flex: 1, fontSize: theme.type.caption.size },
  // RC13 wrapped these three actions in Pressables with no style at all, so their
  // hit area was the glyph box (~20dp) — below both the 44pt and 48dp floors.
  snackbarAction: { minHeight: theme.control.tapCompact, minWidth: theme.control.tapCompact, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.xs },
  action: { color: theme.colors.white, fontSize: theme.type.label.size, fontWeight: '800' },
  moreButton: { alignSelf: 'flex-end', minHeight: theme.control.tapCompact, minWidth: theme.control.tapCompact, alignItems: 'center', justifyContent: 'center' },
  more: { color: theme.colors.primary, fontSize: theme.type.metric.size, lineHeight: theme.control.tapCompact, textAlign: 'center' },
  menu: { alignSelf: 'flex-end', minHeight: theme.control.tapCompact, justifyContent: 'center', paddingHorizontal: theme.spacing.md, borderColor: theme.colors.borderStrong, borderWidth: theme.control.hairline, borderRadius: theme.radius.chip },
  menuText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '800' },
});

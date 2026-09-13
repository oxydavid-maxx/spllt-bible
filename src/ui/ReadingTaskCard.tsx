import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from './Theme';
import { formatReferenceListZhTw } from '../domain/scriptureReference';

export function ReadingTaskCard({ date, references, completed, onOpenReader, onComplete, onUndo, syncStatus }: { date: string; references: string[]; completed: boolean; onOpenReader?: () => void; onComplete?: () => void; onUndo?: () => void; syncStatus?: 'CONFIRMED' | 'PENDING_SAVE' | 'SAVE_FAILED' }) {
  const pending = syncStatus === 'PENDING_SAVE' || syncStatus === 'SAVE_FAILED';
  // 顯示用中文簡寫;references 本身仍是原始 USFM,往下傳給閱讀器與同步的都沒有改。
  const referencesLabel = formatReferenceListZhTw(references);
  return (
    <View
      accessibilityLabel={`今日讀經：${referencesLabel}`}
      style={[styles.card, pending ? styles.cardPending : completed && styles.cardDone]}
    >
      <View style={styles.row}>
        <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>{referencesLabel}</Text>
        <Text style={[styles.state, completed && styles.stateDone]}>{completed ? '已完成' : '待完成'}</Text>
      </View>
      <Pressable onPress={onOpenReader} disabled={!onOpenReader} accessibilityRole="button" accessibilityLabel="開啟今日讀經" style={[styles.button, !onOpenReader && styles.buttonDisabled]}>
        <Text style={styles.buttonText}>開始今日讀經</Text>
      </Pressable>
      <View style={styles.footer}>
        <Text style={[styles.sync, pending && styles.syncPending]} numberOfLines={2}>{syncStatus === undefined ? '' : syncStatus === 'CONFIRMED' ? (completed ? '已與伺服器確認' : '尚未送出完成') : syncStatus === 'PENDING_SAVE' ? '已保留在本機，等待同步' : '同步失敗，保留待重試'}</Text>
        <Pressable onPress={completed ? onUndo : onComplete} disabled={(!completed && !onComplete) || (completed && !onUndo)} accessibilityRole="button" accessibilityLabel={completed ? '撤銷今日讀經完成確認' : '確認今日已完成讀經'} style={[styles.secondaryButton, completed && styles.undoButton]}>
          <Text style={[styles.secondaryText, completed && styles.undoText]}>{completed ? '撤銷確認' : '我已完成讀經'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Signature: a 3dp left rail marks whose turn it is - evergreen once the plan day
  // is confirmed, clay while the record still needs the network. Costs no whitespace.
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: theme.control.hairline,
    borderLeftWidth: theme.control.rail,
    borderLeftColor: theme.colors.borderStrong,
    borderRadius: theme.radius.card,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  cardDone: { borderLeftColor: theme.colors.primary },
  cardPending: { borderLeftColor: theme.colors.accent },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.sm },
  title: { color: theme.colors.ink, flexShrink: 1, fontSize: theme.type.title.size, lineHeight: theme.type.title.line, fontWeight: '800' },
  state: {
    color: theme.colors.muted,
    backgroundColor: theme.colors.surfaceMuted,
    overflow: 'hidden',
    borderRadius: theme.radius.chip,
    fontSize: theme.type.micro.size,
    lineHeight: theme.type.micro.line,
    fontWeight: '700',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  stateDone: { color: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
  button: { minHeight: theme.control.cta, borderRadius: theme.radius.button, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.md },
  buttonDisabled: { backgroundColor: theme.colors.muted },
  buttonText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  sync: { color: theme.colors.muted, flexShrink: 1, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  syncPending: { color: theme.colors.accent, fontWeight: '700' },
  // Undo is reversible, not destructive: it reads as an outline and never as the
  // loudest filled block on the screen (RC13 painted it solid clay).
  secondaryButton: { minHeight: theme.control.tapCompact, flexShrink: 0, borderColor: theme.colors.primary, borderWidth: 1.5, borderRadius: theme.radius.button, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.md },
  secondaryText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '700' },
  undoButton: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
  undoText: { color: theme.colors.accent },
});

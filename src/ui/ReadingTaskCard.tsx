import { useEffect, useRef, useState } from 'react';
import * as RN from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from './Theme';
import { formatReferenceListZhTw } from '../domain/scriptureReference';

const FEEDBACK_VISIBLE_MS = 900;

// Optional native modules are read defensively: strict test mocks throw on unknown exports.
function optionalAnimated(): typeof RN.Animated | null { try { return (RN as { Animated?: typeof RN.Animated }).Animated ?? null; } catch { return null; } }
type AlertFn = (title: string, message?: string, buttons?: Array<{ text: string; style?: 'cancel' | 'default' | 'destructive'; onPress?: () => void }>) => void;
function optionalAlert(): AlertFn | null { try { const alert = (RN as { Alert?: { alert?: AlertFn } }).Alert?.alert; return typeof alert === 'function' ? alert : null; } catch { return null; } }

/** Confirm before undoing; the undo touches the ledger. Falls back to direct undo where Alert is unavailable (tests). */
function confirmUndo(onUndo: () => void) {
  const alert = optionalAlert();
  if (!alert) { onUndo(); return; }
  alert('確定撤銷今天的完成？', '這一天的積分會一併撤回。', [{ text: '取消', style: 'cancel' }, { text: '撤銷', style: 'destructive', onPress: onUndo }]);
}

/** A short "+1" that appears the moment the day flips to completed, then fades. No copy, no badge. */
function CompletionFeedback({ visible }: { visible: boolean }) {
  const animated = optionalAnimated();
  const opacity = useRef(animated ? new animated.Value(0) : null).current;
  useEffect(() => {
    if (!visible || !animated || !opacity) return;
    opacity.setValue(0);
    animated.sequence([
      animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      animated.delay(450),
      animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [visible, animated, opacity]);
  if (!visible) return null;
  const Host = animated?.View ?? View;
  return <Host accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={[styles.feedback, opacity ? { opacity } : null]}><Text style={styles.feedbackText}>+1</Text></Host>;
}

export function ReadingTaskCard({ date, references, completed, onOpenReader, onComplete, onUndo, syncStatus, canComplete = true }: { date: string; references: string[]; completed: boolean; onOpenReader?: () => void; onComplete?: () => void; onUndo?: () => void; syncStatus?: 'CONFIRMED' | 'PENDING_SAVE' | 'SAVE_FAILED'; canComplete?: boolean }) {
  const pending = syncStatus === 'PENDING_SAVE' || syncStatus === 'SAVE_FAILED';
  // 顯示用中文簡寫;references 本身仍是原始 USFM,往下傳給閱讀器與同步的都沒有改。
  const referencesLabel = formatReferenceListZhTw(references);
  // "+1" only when this card's own day flips to completed while mounted (not on first render, not on date change).
  const previous = useRef<{ date: string; completed: boolean }>({ date, completed });
  const [feedback, setFeedback] = useState(false);
  useEffect(() => {
    const flipped = previous.current.date === date && !previous.current.completed && completed;
    previous.current = { date, completed };
    if (!flipped) return;
    setFeedback(true);
    const timer = setTimeout(() => setFeedback(false), FEEDBACK_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [date, completed]);
  const syncMessage = syncStatus === 'PENDING_SAVE' ? '已保留在本機，等待同步' : syncStatus === 'SAVE_FAILED' ? '同步失敗，保留待重試' : '';
  return (
    <View
      accessibilityLabel={`今日讀經：${referencesLabel}`}
      style={[styles.card, pending ? styles.cardPending : completed && styles.cardDone]}
    >
      <View style={styles.row}>
        <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>{referencesLabel}</Text>
        <View style={styles.stateHost}>
          <CompletionFeedback visible={feedback} />
          <Text style={[styles.state, completed && styles.stateDone]}>{completed ? '已完成' : canComplete ? '待完成' : '超過補登期限'}</Text>
        </View>
      </View>
      <Pressable onPress={onOpenReader} disabled={!onOpenReader} accessibilityRole="button" accessibilityLabel="開啟今日讀經" style={[styles.button, !onOpenReader && styles.buttonDisabled]}>
        <Text style={styles.buttonText}>開始今日讀經</Text>
      </Pressable>
      {completed ? (
        <View style={styles.footer}>
          <Text style={[styles.sync, pending && styles.syncPending]} numberOfLines={2}>{syncMessage}</Text>
          <Pressable onPress={onUndo ? () => confirmUndo(onUndo) : undefined} disabled={!onUndo} accessibilityRole="button" accessibilityLabel="撤銷今日讀經完成確認" hitSlop={8} style={styles.undoLink}>
            <Text style={styles.undoLinkText}>撤銷</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.footer}>
          <Text style={[styles.sync, pending && styles.syncPending]} numberOfLines={2}>{syncMessage}</Text>
          <Pressable onPress={onComplete} disabled={!onComplete || !canComplete} accessibilityRole="button" accessibilityLabel={canComplete ? '確認今日已完成讀經' : '超過補登期限'} style={[styles.secondaryButton, !canComplete && styles.buttonDisabled]}>
            <Text style={styles.secondaryText}>{canComplete ? '我已完成讀經' : '超過補登期限'}</Text>
          </Pressable>
        </View>
      )}
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
  stateHost: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
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
  feedback: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  feedbackText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '900' },
  button: { minHeight: theme.control.cta, borderRadius: theme.radius.button, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.md },
  buttonDisabled: { backgroundColor: theme.colors.muted },
  buttonText: { color: theme.colors.white, fontSize: theme.type.body.size, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  sync: { color: theme.colors.muted, flexShrink: 1, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line },
  syncPending: { color: theme.colors.accent, fontWeight: '700' },
  secondaryButton: { minHeight: theme.control.tapCompact, flexShrink: 0, borderColor: theme.colors.primary, borderWidth: 1.5, borderRadius: theme.radius.button, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.md },
  secondaryText: { color: theme.colors.primary, fontSize: theme.type.label.size, fontWeight: '700' },
  // Undo is reversible but touches the ledger: quiet text link, confirmed before it runs.
  // The tap target keeps 48dp through minHeight + hitSlop while the visible text stays small.
  undoLink: { minHeight: theme.control.tapCompact, flexShrink: 0, alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: theme.spacing.xs },
  undoLinkText: { color: theme.colors.muted, fontSize: theme.type.caption.size, lineHeight: theme.type.caption.line, fontWeight: '600', textDecorationLine: 'underline' },
});

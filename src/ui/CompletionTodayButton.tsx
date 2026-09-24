import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CompletionRecord } from '../domain/completion';
import { theme } from './Theme';

export interface CompletionTodayButtonProps {
  record: CompletionRecord;
  pending: boolean;
  retryable: boolean;
  canComplete: boolean;
  onComplete: () => void;
  onUndo: () => void;
}

export function buildCompletionTodayButtonModel(input: Pick<CompletionTodayButtonProps, 'record' | 'pending' | 'retryable' | 'canComplete'>) {
  const retry = input.record.syncStatus === 'SAVE_FAILED' && input.retryable;
  const terminalFailure = input.record.syncStatus === 'SAVE_FAILED' && !input.retryable;
  const completed = input.record.status === 'COMPLETED';
  const disabled = input.pending || terminalFailure || (!completed && !retry && !input.canComplete);
  const label = input.pending
    ? '已記錄，等待同步'
    : terminalFailure
      ? '完成記錄未同步，無法重試'
      : retry
        ? '重試同步完成記錄'
        : completed
          ? '今日讀經已完成'
          : input.canComplete
            ? '完成今日讀經'
            : '今天沒有可完成的讀經';
  return { disabled, label, completed, retry } as const;
}

export function CompletionTodayButton(props: CompletionTodayButtonProps) {
  const model = buildCompletionTodayButtonModel(props);
  const press = () => {
    if (model.disabled) return;
    if (model.retry || !model.completed) props.onComplete();
    else props.onUndo();
  };
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={model.label}
    accessibilityState={{ disabled: model.disabled, busy: props.pending }}
    disabled={model.disabled}
    onPress={press}
    style={[styles.button, model.completed && styles.completedButton, model.disabled && styles.disabledButton]}
  >
    <View style={[styles.circle, model.completed && styles.checkedCircle]}>
      {model.completed ? <Text style={styles.check}>✓</Text> : null}
    </View>
    <Text style={[styles.label, model.completed && styles.completedLabel]}>{model.label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { minHeight: 72, width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, borderRadius: theme.radius.button, backgroundColor: theme.colors.primary },
  completedButton: { backgroundColor: theme.colors.surface, borderWidth: theme.control.hairline, borderColor: theme.colors.primary },
  disabledButton: { opacity: 0.68 },
  circle: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: theme.colors.white, alignItems: 'center', justifyContent: 'center' },
  checkedCircle: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  check: { color: theme.colors.white, fontSize: 20, lineHeight: 24, fontWeight: '900' },
  label: { color: theme.colors.white, fontSize: theme.type.label.size, lineHeight: theme.type.label.line, fontWeight: '800' },
  completedLabel: { color: theme.colors.primary },
});

import type { CompletionRecord } from '../domain/completion';
import { DayActionButton } from './DayActionButton';

export interface CompletionTodayButtonProps {
  record: CompletionRecord;
  pending: boolean;
  retryable: boolean;
  canComplete: boolean;
  onComplete: () => void;
  onUndo: () => void;
  /**
   * The Taipei date. When the record is for another day (the 積分 calendar's selected day) the
   * button speaks about that day rather than about today. Omitted, it is today's button as before.
   */
  today?: string;
  /** False for a day finished on another phone: shown finished, with no undo that silently does nothing. */
  undoable?: boolean;
}

export function buildCompletionTodayButtonModel(input: Pick<CompletionTodayButtonProps, 'record' | 'pending' | 'retryable' | 'canComplete' | 'today' | 'undoable'>) {
  const retry = input.record.syncStatus === 'SAVE_FAILED' && input.retryable;
  const terminalFailure = input.record.syncStatus === 'SAVE_FAILED' && !input.retryable;
  const completed = input.record.status === 'COMPLETED';
  const otherDay = input.today !== undefined && input.record.taskDate !== input.today;
  const disabled = input.pending || terminalFailure || (!completed && !retry && !input.canComplete) || (completed && !retry && input.undoable === false);
  const label = input.pending
    ? '已記錄，等待同步'
    : terminalFailure
      ? '完成記錄未同步，無法重試'
      : retry
        ? '重試同步完成記錄'
        : completed
          ? otherDay ? '這天讀經已完成' : '今日讀經已完成'
          : input.canComplete
            ? otherDay ? '我已完成讀經' : '完成今日讀經'
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
  return <DayActionButton tone="green" label={model.label} completed={model.completed} disabled={model.disabled} busy={props.pending} onPress={press} />;
}

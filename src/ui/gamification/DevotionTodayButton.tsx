import { DayActionButton } from '../DayActionButton';

/**
 * The green leaf button beside 完成今日讀經 (維護者 2026-10-14): the member also read the pastor's 靈修
 * that day. It earns nothing and is not in the group's numbers, so the button never mentions points.
 * The same 7-day window as reading completions applies; the server enforces it too.
 */

export interface DevotionTodayButtonProps {
  date: string;
  today: string;
  completed: boolean;
  pending: boolean;
  /** Inside the completion window and not in the future. */
  canMark: boolean;
  onToggle: (completed: boolean) => void;
}

export function buildDevotionButtonModel(input: Omit<DevotionTodayButtonProps, 'onToggle'>) {
  const otherDay = input.date !== input.today;
  const label = input.completed
    ? otherDay ? '這天靈修已完成' : '今日靈修已完成'
    : otherDay ? '我已讀了靈修' : '完成今日靈修';
  return { label, disabled: input.pending || !input.canMark } as const;
}

export function DevotionTodayButton(props: DevotionTodayButtonProps) {
  const model = buildDevotionButtonModel(props);
  return <DayActionButton kind="devotion" label={model.label} completed={props.completed} disabled={model.disabled} busy={props.pending} onPress={() => props.onToggle(!props.completed)} />;
}

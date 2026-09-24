import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
vi.mock('react-native', () => ({
  Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: { create: (value: unknown) => value },
}));
import type { CompletionRecord } from '../../src/domain/completion';
import { buildCompletionTodayButtonModel, CompletionTodayButton } from '../../src/ui/CompletionTodayButton';

const base: CompletionRecord = { memberId: 'member-1', planId: 'church-2026-09', taskDate: '2026-09-14', status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' };
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const message = String(args[0] ?? '');
    if (message.includes('react-test-renderer is deprecated') || message.includes('testing environment is not configured to support act')) return;
    originalConsoleError(...args);
  };
});
afterAll(() => { console.error = originalConsoleError; });

describe('Points today completion button', () => {
  it('keeps one fixed-size accessible button disabled while its shared save is pending', () => {
    const model = buildCompletionTodayButtonModel({ record: { ...base, status: 'COMPLETED', syncStatus: 'PENDING_SAVE' }, pending: true, canComplete: true });
    expect(model).toMatchObject({ disabled: true, label: '已記錄，等待同步', completed: true });
  });

  it('uses the same complete/undo/retry actions without allowing an unscheduled new completion', () => {
    expect(buildCompletionTodayButtonModel({ record: base, pending: false, canComplete: false })).toMatchObject({ disabled: true, label: '今天沒有可完成的讀經' });
    const onComplete = vi.fn();
    const onUndo = vi.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(createElement(CompletionTodayButton, { record: base, pending: false, canComplete: true, onComplete, onUndo })); });
    expect(tree.root.findByProps({ accessibilityRole: 'button' }).props.accessibilityLabel).toBe('完成今日讀經');
    act(() => { tree.root.findByProps({ accessibilityRole: 'button' }).props.onPress(); });
    expect(onComplete).toHaveBeenCalledOnce();

    const completed = { ...base, status: 'COMPLETED' as const };
    act(() => tree.update(createElement(CompletionTodayButton, { record: completed, pending: false, canComplete: false, onComplete, onUndo })));
    act(() => { tree.root.findByProps({ accessibilityRole: 'button' }).props.onPress(); });
    expect(onUndo).toHaveBeenCalledOnce();
  });
});

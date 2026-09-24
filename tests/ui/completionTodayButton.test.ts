import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { DatabaseSync } from 'node:sqlite';
vi.mock('react-native', () => ({
  Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: { create: (value: unknown) => value },
}));
import type { CompletionRecord } from '../../src/domain/completion';
import { createMobileRepository, type MobileDatabase } from '../../src/storage/mobileRepository';
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
    const model = buildCompletionTodayButtonModel({ record: { ...base, status: 'COMPLETED', syncStatus: 'PENDING_SAVE' }, pending: true, retryable: false, canComplete: true });
    expect(model).toMatchObject({ disabled: true, label: '已記錄，等待同步', completed: true });
  });

  it('shows terminal save failure as non-retryable while preserving the local completed status', () => {
    const terminalRecord = { ...base, status: 'COMPLETED' as const, syncStatus: 'SAVE_FAILED' as const, pendingStatus: 'COMPLETED' as const, lastOperationId: 'expired-op' };
    const model = buildCompletionTodayButtonModel({ record: terminalRecord, pending: false, canComplete: true, retryable: false });
    expect(model).toMatchObject({ disabled: true, label: '完成記錄未同步，無法重試', completed: true, retry: false });
    expect(terminalRecord).toMatchObject({ status: 'COMPLETED', syncStatus: 'SAVE_FAILED', pendingStatus: 'COMPLETED' });
    const onComplete = vi.fn();
    const onUndo = vi.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(createElement(CompletionTodayButton, { record: terminalRecord, pending: false, retryable: false, canComplete: true, onComplete, onUndo })); });
    act(() => { tree.root.findByProps({ accessibilityRole: 'button' }).props.onPress(); });
    expect(onComplete).not.toHaveBeenCalled();
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('connects a terminal server rejection to the disabled Points button through the real repository', async () => {
    const node = new DatabaseSync(':memory:');
    const mobile: MobileDatabase = {
      execSync: (source) => node.exec(source),
      runSync: (source, ...params) => node.prepare(source).run(...(params as never[])),
      getFirstSync: <T>(source: string, ...params: unknown[]) => node.prepare(source).get(...(params as never[])) as T | null,
      getAllSync: <T>(source: string, ...params: unknown[]) => node.prepare(source).all(...(params as never[])) as T[],
    };
    const repository = createMobileRepository(mobile);
    const command = { ...base, desiredStatus: 'COMPLETED' as const, operationId: 'terminal-points-op', expectedRevision: 0 };
    repository.saveCompletion(command);
    await repository.flush(async () => ({ ok: false as const, error: 'OUTSIDE_COMPLETION_WINDOW' }));
    const record = repository.get(command)!;
    const model = buildCompletionTodayButtonModel({
      record, pending: false, retryable: repository.hasPendingCompletion(command), canComplete: true,
    });

    expect(model).toMatchObject({ disabled: true, label: '完成記錄未同步，無法重試', completed: true, retry: false });
    expect(record).toMatchObject({ status: 'COMPLETED', syncStatus: 'SAVE_FAILED', pendingStatus: 'COMPLETED' });
    expect(repository.hasPendingCompletion(command)).toBe(false);
    node.close();
  });

  it('uses the same complete/undo/retry actions without allowing an unscheduled new completion', () => {
    expect(buildCompletionTodayButtonModel({ record: base, pending: false, retryable: false, canComplete: false })).toMatchObject({ disabled: true, label: '今天沒有可完成的讀經' });
    const onComplete = vi.fn();
    const onUndo = vi.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => { tree = TestRenderer.create(createElement(CompletionTodayButton, { record: base, pending: false, retryable: false, canComplete: true, onComplete, onUndo })); });
    expect(tree.root.findByProps({ accessibilityRole: 'button' }).props.accessibilityLabel).toBe('完成今日讀經');
    act(() => { tree.root.findByProps({ accessibilityRole: 'button' }).props.onPress(); });
    expect(onComplete).toHaveBeenCalledOnce();

    const completed = { ...base, status: 'COMPLETED' as const };
    act(() => tree.update(createElement(CompletionTodayButton, { record: completed, pending: false, retryable: false, canComplete: false, onComplete, onUndo })));
    act(() => { tree.root.findByProps({ accessibilityRole: 'button' }).props.onPress(); });
    expect(onUndo).toHaveBeenCalledOnce();
  });
});

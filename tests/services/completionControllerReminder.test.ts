import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({}));
vi.mock('expo-modules-core', () => ({ EventEmitter: class {}, NativeModulesProxy: {}, requireNativeModule: vi.fn(), requireOptionalNativeModule: vi.fn(), Platform: { OS: 'test' } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(async () => undefined), deleteItemAsync: vi.fn(async () => undefined) }));
import type { CompletionCommand, CompletionRecord } from '../../src/domain/completion';
import { syncReadingReminderForCompletion } from '../../src/services/reminderCompletion';
import { createCompletionController, type CompletionControllerDependencies } from '../../src/services/completionController';
import type { SyncResult } from '../../src/storage/outbox';

describe('shared completion reminder boundary', () => {
  it('cancels on complete and schedules again on undo through one save callback', async () => {
    const identity = { memberId: 'reminder-controller-member', planId: 'church-2026-09', taskDate: '2026-09-12' };
    let record: CompletionRecord = { ...identity, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' };
    const operationIds = ['reminder-complete-op', 'reminder-undo-op'];
    const scheduled: string[] = [];
    const cancelled: string[] = [];
    const scheduler = {
      cancel: async (id: string) => { cancelled.push(id); },
      schedule: async (spec: { reminderId: string }) => { scheduled.push(spec.reminderId); },
      list: async () => [],
      requestPermission: async () => 'granted' as const,
      cancelForMember: async () => undefined,
    };
    const store = { getItemAsync: async (key: string) => key.endsWith('readingEnabled') ? 'true' : '08:00' };
    const dependencies: CompletionControllerDependencies = {
      identity,
      authEpoch: 81,
      canComplete: () => true,
      isCurrent: () => true,
      isSessionCurrent: () => true,
      isAppActive: () => true,
      isVisible: () => true,
      hasPendingCompletion: () => false,
      getRecord: () => record,
      saveCompletion: (command: CompletionCommand) => {
        record = { ...record, status: command.desiredStatus, revision: record.revision + 1, syncStatus: 'PENDING_SAVE', pendingStatus: command.desiredStatus, lastOperationId: command.operationId };
        return record;
      },
      flush: async (): Promise<SyncResult[]> => {
        record = { ...record, syncStatus: 'CONFIRMED', pendingStatus: undefined };
        return [{ ok: true, operationId: record.lastOperationId, revision: record.revision, status: record.status, pointsDelta: record.status === 'COMPLETED' ? 1 : -1 }];
      },
      onRecord: () => undefined,
      onSyncError: () => undefined,
      onCommandSaved: (command) => syncReadingReminderForCompletion({ ...command, status: command.desiredStatus, scheduler, store }),
      confirmUndo: (_message, onConfirm) => onConfirm(),
      generateOperationId: () => operationIds.shift() ?? 'unexpected-op',
    };
    const controller = createCompletionController(() => dependencies);

    await controller.complete();
    await vi.waitFor(() => expect(cancelled).toEqual([`reading:${identity.memberId}:${identity.taskDate}`]));
    controller.requestUndo();
    await vi.waitFor(() => expect(scheduled).toEqual([`reading:${identity.memberId}:${identity.taskDate}`]));
  });
});

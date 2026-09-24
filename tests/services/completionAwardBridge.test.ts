import { describe, expect, it, vi } from 'vitest';
import type { CompletionCommand, CompletionRecord } from '../../src/domain/completion';
import {
  activateCompletionAwardSurface,
  createCompletionController,
  subscribeCompletionAwardSurface,
  type CompletionControllerDependencies,
} from '../../src/services/completionController';
import type { SyncResult } from '../../src/storage/outbox';

describe('completion award route bridge', () => {
  it('drops numeric award if the app backgrounds before the response but preserves confirmed sync refresh', async () => {
    const identity = { memberId: 'background-bridge-member', planId: 'church-2026-09', taskDate: '2026-09-12' };
    let record: CompletionRecord = { ...identity, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' };
    const operationId = 'background-bridge-operation';
    let appActive = true;
    let surfaceVisible = true;
    let finishFlush!: (results: SyncResult[]) => void;
    const dependencies: CompletionControllerDependencies = {
      identity,
      authEpoch: 703,
      canComplete: () => true,
      isCurrent: () => true,
      isSessionCurrent: () => true,
      isAppActive: () => appActive,
      isVisible: () => surfaceVisible,
      hasPendingCompletion: () => false,
      getRecord: () => record,
      saveCompletion: (command: CompletionCommand) => {
        record = { ...identity, status: command.desiredStatus, revision: 1, syncStatus: 'PENDING_SAVE', lastOperationId: command.operationId };
        return record;
      },
      flush: () => new Promise((resolve) => { finishFlush = resolve; }),
      onRecord: () => undefined,
      onSyncError: () => undefined,
      confirmUndo: () => undefined,
      generateOperationId: () => operationId,
    };
    const awardEvents: unknown[] = [];
    const syncEvents: unknown[] = [];
    const stop = subscribeCompletionAwardSurface(identity, 703, () => surfaceVisible, (event) => awardEvents.push(event), (event) => syncEvents.push(event));
    try {
      const action = createCompletionController(() => dependencies).complete();
      await vi.waitFor(() => expect(finishFlush).toBeTypeOf('function'));

      appActive = false;
      surfaceVisible = false;
      finishFlush([{ ok: true, operationId, revision: 1, status: 'COMPLETED', pointsDelta: 1, earnedTotal: 1, redeemableBalance: 1 }]);
      await action;
      expect(awardEvents).toEqual([]);
      expect(syncEvents).toEqual([]);

      appActive = true;
      surfaceVisible = true;
      activateCompletionAwardSurface(identity, 703);
      expect(awardEvents).toEqual([]);
      expect(syncEvents).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it('delivers once when the current-auth surface returns to foreground before the TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    try {
      const identity = { memberId: 'ttl-active-member', planId: 'church-2026-09', taskDate: '2026-09-12' };
      let record: CompletionRecord = { ...identity, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' };
      const operationId = 'ttl-active-operation';
      const dependencies: CompletionControllerDependencies = {
        identity,
        authEpoch: 702,
        canComplete: () => true,
        isCurrent: () => true,
        isSessionCurrent: () => true,
        isAppActive: () => true,
        isVisible: () => true,
        hasPendingCompletion: () => false,
        getRecord: () => record,
        saveCompletion: (command: CompletionCommand) => {
          record = { ...identity, status: command.desiredStatus, revision: 1, syncStatus: 'PENDING_SAVE', lastOperationId: command.operationId };
          return record;
        },
        flush: async (): Promise<SyncResult[]> => [{ ok: true, operationId, revision: 1, status: 'COMPLETED', pointsDelta: 1 }],
        onRecord: () => undefined,
        onSyncError: () => undefined,
        confirmUndo: () => undefined,
        generateOperationId: () => operationId,
      };
      let foreground = false;
      const events: unknown[] = [];
      const stop = subscribeCompletionAwardSurface(identity, 702, () => foreground, (event) => events.push(event));
      await createCompletionController(() => dependencies).complete();
      expect(events).toEqual([]);

      vi.setSystemTime(new Date(Date.now() + 4_999));
      foreground = true;
      activateCompletionAwardSurface(identity, 702);
      expect(events).toHaveLength(1);
      activateCompletionAwardSurface(identity, 702);
      expect(events).toHaveLength(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('expires the zero-listener award queue after five seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    try {
      const identity = { memberId: 'ttl-bridge-member', planId: 'church-2026-09', taskDate: '2026-09-12' };
      let record: CompletionRecord = { ...identity, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' };
      const operationId = 'ttl-bridge-operation';
      const dependencies: CompletionControllerDependencies = {
        identity,
        authEpoch: 701,
        canComplete: () => true,
        isCurrent: () => true,
        isSessionCurrent: () => true,
        isAppActive: () => true,
        isVisible: () => true,
        hasPendingCompletion: () => false,
        getRecord: () => record,
        saveCompletion: (command: CompletionCommand) => {
          record = { ...identity, status: command.desiredStatus, revision: 1, syncStatus: 'PENDING_SAVE', lastOperationId: command.operationId };
          return record;
        },
        flush: async (): Promise<SyncResult[]> => [{ ok: true, operationId, revision: 1, status: 'COMPLETED', pointsDelta: 1 }],
        onRecord: () => undefined,
        onSyncError: () => undefined,
        confirmUndo: () => undefined,
        generateOperationId: () => operationId,
      };
      await createCompletionController(() => dependencies).complete();

      vi.setSystemTime(new Date(Date.now() + 5_001));
      const events: unknown[] = [];
      const stop = subscribeCompletionAwardSurface(identity, 701, () => true, (event) => events.push(event));
      expect(events).toEqual([]);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

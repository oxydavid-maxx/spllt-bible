import { describe, expect, it, vi } from 'vitest';
import type { CompletionCommand, CompletionRecord } from '../../src/domain/completion';
import {
  createCompletionController,
  subscribeCompletionAwardSurface,
  type CompletionAwardEvent,
  type CompletionControllerDependencies,
} from '../../src/services/completionController';
import type { SyncResult } from '../../src/storage/outbox';

const identity = { memberId: 'member-controller-test', planId: 'church-2026-09', taskDate: '2026-09-12' };
let nextOperation = 0;
let nextMember = 0;

function makeHarness(options: {
  startingRecord?: CompletionRecord;
  flush?: () => Promise<SyncResult[]>;
  canComplete?: () => boolean;
  isCurrent?: () => boolean;
  isSessionCurrent?: () => boolean;
  operationId?: string;
  identity?: typeof identity;
} = {}) {
  const generatedMemberId = `member-controller-test-${++nextMember}`;
  const testIdentity = options.identity ?? { ...identity, memberId: generatedMemberId };
  let record = options.startingRecord ?? {
    ...testIdentity, status: 'UNREPORTED' as const, revision: 0, syncStatus: 'CONFIRMED' as const,
  };
  const commands: CompletionCommand[] = [];
  const shownRecords: CompletionRecord[] = [];
  const syncErrors: boolean[] = [];
  const generatedOperationId = `controller-operation-${++nextOperation}`;
  const operationId = options.operationId ?? generatedOperationId;
  const confirmUndo = vi.fn((_message: string, onConfirm: () => void) => onConfirm());
  const deps: CompletionControllerDependencies = {
    identity: testIdentity,
    authEpoch: 4,
    canComplete: options.canComplete ?? (() => true),
    isCurrent: options.isCurrent ?? (() => true),
    isSessionCurrent: options.isSessionCurrent ?? (() => true),
    isVisible: () => true,
    getRecord: () => record,
    saveCompletion: (command) => {
      commands.push(command);
      record = {
        ...record,
        status: command.desiredStatus,
        revision: record.revision + 1,
        syncStatus: 'PENDING_SAVE',
        pendingStatus: command.desiredStatus,
        lastOperationId: command.operationId,
      };
      return record;
    },
    flush: options.flush ?? (async () => []),
    onRecord: (next) => { shownRecords.push(next); },
    onSyncError: (failed) => { syncErrors.push(failed); },
    confirmUndo,
    generateOperationId: () => operationId,
  };
  return {
    deps,
    identity: testIdentity,
    commands,
    shownRecords,
    syncErrors,
    confirmUndo,
    getRecord: () => record,
    setRecord: (next: CompletionRecord) => { record = next; },
    controller: createCompletionController(() => deps),
    operationId,
  };
}

function success(operationId: string, pointsDelta: number, status: 'COMPLETED' | 'NOT_COMPLETED' = 'COMPLETED'): SyncResult {
  return { ok: true, operationId, revision: 1, status, pointsDelta, earnedTotal: 12, redeemableBalance: 8 };
}

describe('shared completion controller and award handoff', () => {
  it('coalesces Points and Reader taps and delivers one immutable award to the newly visible surface', async () => {
    let finishFlush!: (results: SyncResult[]) => void;
    const flush = vi.fn(() => new Promise<SyncResult[]>((resolve) => { finishFlush = resolve; }));
    const harness = makeHarness({ flush });
    const readerEvents: CompletionAwardEvent[] = [];
    const pointsEvents: CompletionAwardEvent[] = [];
    let readerVisible = true;
    let pointsVisible = false;
    const stopReader = subscribeCompletionAwardSurface(harness.identity, 4, () => readerVisible, (event) => readerEvents.push(event));
    const stopPoints = subscribeCompletionAwardSurface({ ...harness.identity, taskDate: '2026-09-14' }, 4, () => pointsVisible, (event) => pointsEvents.push(event));

    const readerTap = harness.controller.complete();
    const pointsTap = createCompletionController(() => harness.deps).complete();
    await Promise.resolve();
    expect(harness.commands).toHaveLength(1);
    expect(flush).toHaveBeenCalledTimes(1);

    // The initiating Reader loses focus while the same operation is still in flight.
    readerVisible = false;
    pointsVisible = true;
    finishFlush([success(harness.operationId, 1)]);
    await Promise.all([readerTap, pointsTap]);

    expect(readerEvents).toEqual([]);
    expect(pointsEvents).toEqual([{
      ...harness.identity,
      operationId: harness.operationId,
      pointsDelta: 1,
      earnedTotal: 12,
      redeemableBalance: 8,
    }]);
    harness.controller.observeFlushResults([success(harness.operationId, 1)]);
    expect(pointsEvents).toHaveLength(1);
    stopReader();
    stopPoints();
  });

  it('queues a confirmed event through the blur-to-focus gap and drops it when auth or plan changed', async () => {
    const noSurfaceId = `controller-operation-${nextOperation + 1}`;
    const noSurface = makeHarness({ operationId: noSurfaceId, flush: async () => [success(noSurfaceId, 1)] });
    await noSurface.controller.complete();
    const delivered: CompletionAwardEvent[] = [];
    const stop = subscribeCompletionAwardSurface({ ...noSurface.identity, taskDate: '2026-09-14' }, 4, () => true, (event) => delivered.push(event));
    expect(delivered).toEqual([expect.objectContaining({ memberId: noSurface.identity.memberId, planId: noSurface.identity.planId, taskDate: noSurface.identity.taskDate, operationId: noSurface.operationId, pointsDelta: 1 })]);
    stop();

    const wrongScopeId = `controller-operation-${nextOperation + 1}`;
    const wrongScope = makeHarness({ operationId: wrongScopeId, flush: async () => [success(wrongScopeId, 1)] });
    await wrongScope.controller.complete();
    const changedPlan = subscribeCompletionAwardSurface({ ...wrongScope.identity, planId: 'church-2026-10' }, 4, () => true, (event) => delivered.push(event));
    changedPlan();
    const changedAuth = subscribeCompletionAwardSurface(wrongScope.identity, 5, () => true, (event) => delivered.push(event));
    changedAuth();
    expect(delivered).toHaveLength(1);
  });

  it('keeps the original backfill date and does not award for old-server, zero, reversal, or stale-session responses', async () => {
    const oldServerId = `controller-operation-${nextOperation + 1}`;
    const oldServer = makeHarness({ operationId: oldServerId, flush: async () => [{ ok: true, operationId: oldServerId, revision: 1, status: 'COMPLETED' }] });
    const events: CompletionAwardEvent[] = [];
    const stop = subscribeCompletionAwardSurface(oldServer.identity, 4, () => true, (event) => events.push(event));
    await oldServer.controller.complete();
    expect(events).toEqual([]);

    const zeroId = `controller-operation-${nextOperation + 1}`;
    const zero = makeHarness({ operationId: zeroId, flush: async () => [success(zeroId, 0)] });
    const stopZero = subscribeCompletionAwardSurface(zero.identity, 4, () => true, (event) => events.push(event));
    await zero.controller.complete();
    const negativeId = `controller-operation-${nextOperation + 1}`;
    const negativeIdentity = { ...identity, memberId: `member-controller-test-${nextMember + 1}` };
    const negative = makeHarness({
      identity: negativeIdentity,
      startingRecord: { ...negativeIdentity, status: 'COMPLETED', revision: 1, syncStatus: 'CONFIRMED' },
      operationId: negativeId,
      flush: async () => [success(negativeId, -1, 'NOT_COMPLETED')],
    });
    const stopNegative = subscribeCompletionAwardSurface(negative.identity, 4, () => true, (event) => events.push(event));
    negative.controller.requestUndo();
    await Promise.resolve();
    await Promise.resolve();
    expect(negative.confirmUndo).toHaveBeenCalledOnce();
    expect(negative.commands).toHaveLength(1);
    expect(negative.commands[0]).toMatchObject({ desiredStatus: 'NOT_COMPLETED', expectedRevision: 1, taskDate: negative.identity.taskDate });
    expect(events).toEqual([]);

    let sessionCurrent = true;
    let finishStaleFlush!: (results: SyncResult[]) => void;
    const staleId = `controller-operation-${nextOperation + 1}`;
    const stale = makeHarness({ operationId: staleId, isCurrent: () => sessionCurrent, isSessionCurrent: () => sessionCurrent, flush: () => new Promise((resolve) => { finishStaleFlush = resolve; }) });
    const staleReaderEvents: CompletionAwardEvent[] = [];
    const newSessionEvents: CompletionAwardEvent[] = [];
    const stopStaleReader = subscribeCompletionAwardSurface(stale.identity, 4, () => sessionCurrent, (event) => staleReaderEvents.push(event));
    const stopNewSession = subscribeCompletionAwardSurface(stale.identity, 5, () => true, (event) => newSessionEvents.push(event));
    const staleAction = stale.controller.complete();
    await vi.waitFor(() => expect(finishStaleFlush).toBeTypeOf('function'));
    sessionCurrent = false;
    finishStaleFlush([success(staleId, 1)]);
    await staleAction;
    expect(staleReaderEvents).toEqual([]);
    expect(newSessionEvents).toEqual([]);
    const staleAgain: CompletionAwardEvent[] = [];
    const stopStaleAgain = subscribeCompletionAwardSurface(stale.identity, 4, () => true, (event) => staleAgain.push(event));
    expect(staleAgain).toEqual([]);
    stopStaleAgain();
    stopStaleReader();
    stopNewSession();
    stopNegative();
    stopZero();
    stop();
  });

  it('retries the same pending operation and awards only when its eventual response confirms a positive delta', async () => {
    let response: SyncResult[] = [{ ok: false, error: 'offline' }];
    const operationId = `controller-operation-${nextOperation + 1}`;
    const harness = makeHarness({ operationId, flush: async () => response });
    const events: CompletionAwardEvent[] = [];
    const stop = subscribeCompletionAwardSurface(harness.identity, 4, () => true, (event) => events.push(event));
    await harness.controller.complete();
    expect(harness.getRecord().syncStatus).toBe('PENDING_SAVE');
    expect(events).toEqual([]);

    response = [success(harness.operationId, 1)];
    harness.controller.observeFlushResults(response);
    harness.controller.observeFlushResults(response);
    expect(events).toHaveLength(1);
    stop();
  });
});

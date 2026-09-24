import type { CompletionCommand, CompletionRecord } from '../domain/completion';
import type { SyncResult } from '../storage/outbox';

export type CompletionIdentity = Pick<CompletionRecord, 'memberId' | 'planId' | 'taskDate'>;

export interface CompletionAwardEvent extends Readonly<CompletionIdentity> {
  readonly operationId: string;
  readonly pointsDelta: number;
  readonly earnedTotal?: number;
  readonly redeemableBalance?: number;
}

export interface CompletionSyncEvent extends Readonly<CompletionIdentity> {
  readonly operationId: string;
  readonly status: CompletionRecord['status'];
  readonly pointsDelta?: number;
  readonly earnedTotal?: number;
  readonly redeemableBalance?: number;
}

export const COMPLETION_EVENT_BRIDGE_TTL_MS = 5_000;

export interface CompletionControllerDependencies {
  identity: CompletionIdentity;
  authEpoch: number;
  canComplete: () => boolean;
  isCurrent: () => boolean;
  isSessionCurrent: () => boolean;
  isVisible: () => boolean;
  hasPendingCompletion: () => boolean;
  getRecord: () => CompletionRecord | undefined;
  saveCompletion: (command: CompletionCommand) => CompletionRecord;
  flush: () => Promise<SyncResult[]>;
  onRecord: (record: CompletionRecord) => void;
  onSyncError: (failed: boolean) => void;
  onCommandSaved?: (command: CompletionCommand) => void | Promise<void>;
  confirmUndo: (message: string, onConfirm: () => void) => void;
  generateOperationId: () => string;
}

export interface CompletionController {
  complete: () => Promise<void>;
  requestUndo: () => void;
  observeFlushResults: (results: SyncResult[]) => void;
}

interface TrackedOperation {
  identity: CompletionIdentity;
  authEpoch: number;
  isSessionCurrent: () => boolean;
  desiredStatus: CompletionRecord['status'];
}

interface AwardSurface {
  identity: CompletionIdentity;
  authEpoch: number;
  isVisible: () => boolean;
  onAward?: (event: CompletionAwardEvent) => void;
  onConfirmed?: (event: CompletionSyncEvent) => void;
}

interface PendingAward {
  event: CompletionAwardEvent;
  authEpoch: number;
  expiresAt: number;
}

interface PendingCompletionSync {
  event: CompletionSyncEvent;
  authEpoch: number;
  expiresAt: number;
}

const actionFlights = new Map<string, Promise<void>>();
const trackedOperations = new Map<string, TrackedOperation>();
const awardSurfaces = new Set<AwardSurface>();
const pendingAwards = new Map<string, PendingAward>();
const pendingCompletionSync = new Map<string, PendingCompletionSync>();
const deliveredOperations = new Set<string>();
const deliveredSyncOperations = new Set<string>();

function identityKey(identity: CompletionIdentity): string {
  return `${identity.memberId}\u0000${identity.planId}\u0000${identity.taskDate}`;
}

function sameAwardScope(left: AwardSurface | { identity: CompletionIdentity; authEpoch: number }, right: { identity: CompletionIdentity; authEpoch: number }): boolean {
  return left.authEpoch === right.authEpoch
    && left.identity.memberId === right.identity.memberId
    && left.identity.planId === right.identity.planId;
}

function sameSessionScope(left: AwardSurface | { identity: CompletionIdentity; authEpoch: number }, right: { identity: CompletionIdentity; authEpoch: number }): boolean {
  return left.authEpoch === right.authEpoch && left.identity.memberId === right.identity.memberId;
}

function deliverAward(event: CompletionAwardEvent, authEpoch: number): void {
  const now = Date.now();
  if (deliveredOperations.has(event.operationId)) return;
  const visible = [...awardSurfaces].filter((surface) => {
    try { return surface.isVisible(); } catch { return false; }
  });
  if (visible.length === 0) {
    if (!pendingAwards.has(event.operationId)) pendingAwards.set(event.operationId, { event, authEpoch, expiresAt: now + COMPLETION_EVENT_BRIDGE_TTL_MS });
    return;
  }
  const surface = visible.find((candidate) => candidate.onAward && sameAwardScope(candidate, {
    identity: event,
    authEpoch,
  }));
  if (!surface) return;
  deliveredOperations.add(event.operationId);
  pendingAwards.delete(event.operationId);
  try { surface.onAward?.(event); } catch { /* A visual observer cannot change a confirmed save. */ }
}

function deliverCompletionSync(event: CompletionSyncEvent, authEpoch: number): void {
  const now = Date.now();
  if (deliveredSyncOperations.has(event.operationId)) return;
  const visible = [...awardSurfaces].filter((surface) => {
    try { return surface.isVisible(); } catch { return false; }
  });
  if (visible.length === 0) {
    if (!pendingCompletionSync.has(event.operationId)) pendingCompletionSync.set(event.operationId, { event, authEpoch, expiresAt: now + COMPLETION_EVENT_BRIDGE_TTL_MS });
    return;
  }
  const surface = visible.find((candidate) => candidate.onConfirmed && sameSessionScope(candidate, { identity: event, authEpoch }));
  if (!surface) return;
  deliveredSyncOperations.add(event.operationId);
  pendingCompletionSync.delete(event.operationId);
  try { surface.onConfirmed?.(event); } catch { /* Refresh observers cannot change a confirmed save. */ }
}

function activateSurface(surface: AwardSurface): void {
  for (const [operationId, pending] of pendingAwards) {
    if (pending.expiresAt <= Date.now() || !sameAwardScope(surface, { identity: pending.event, authEpoch: pending.authEpoch })) {
      pendingAwards.delete(operationId);
      continue;
    }
    let visible = false;
    try { visible = surface.isVisible(); } catch { /* A surface being torn down is not visible. */ }
    if (!visible) continue;
    if (deliveredOperations.has(operationId)) {
      pendingAwards.delete(operationId);
      continue;
    }
    if (!surface.onAward) continue;
    deliveredOperations.add(operationId);
    pendingAwards.delete(operationId);
    try { surface.onAward(pending.event); } catch { /* Ignore rendering failures after the result is consumed. */ }
  }
  for (const [operationId, pending] of pendingCompletionSync) {
    if (pending.expiresAt <= Date.now() || !sameSessionScope(surface, { identity: pending.event, authEpoch: pending.authEpoch })) {
      pendingCompletionSync.delete(operationId);
      continue;
    }
    let visible = false;
    try { visible = surface.isVisible(); } catch { /* A surface being torn down is not visible. */ }
    if (!visible || !surface.onConfirmed) continue;
    if (deliveredSyncOperations.has(operationId)) {
      pendingCompletionSync.delete(operationId);
      continue;
    }
    deliveredSyncOperations.add(operationId);
    pendingCompletionSync.delete(operationId);
    try { surface.onConfirmed(pending.event); } catch { /* Ignore refresh failures after the result is consumed. */ }
  }
}

export function subscribeCompletionAwardSurface(
  identity: CompletionIdentity,
  authEpoch: number,
  isVisible: () => boolean,
  onAward?: (event: CompletionAwardEvent) => void,
  onConfirmed?: (event: CompletionSyncEvent) => void,
): () => void {
  const surface: AwardSurface = { identity, authEpoch, isVisible, onAward, onConfirmed };
  // A pending event is scoped to the original account and plan. A later account or plan must not
  // revive it; taskDate may change within the same plan because the event carries its own date.
  for (const [operationId, pending] of pendingAwards) {
    if (pending.expiresAt <= Date.now() || !sameAwardScope(surface, { identity: pending.event, authEpoch: pending.authEpoch })) pendingAwards.delete(operationId);
  }
  for (const [operationId, pending] of pendingCompletionSync) {
    if (pending.expiresAt <= Date.now() || !sameSessionScope(surface, { identity: pending.event, authEpoch: pending.authEpoch })) pendingCompletionSync.delete(operationId);
  }
  awardSurfaces.add(surface);
  activateSurface(surface);
  return () => { awardSurfaces.delete(surface); };
}

export function activateCompletionAwardSurface(identity: CompletionIdentity, authEpoch: number): void {
  const surfaces = [...awardSurfaces].filter((candidate) => sameSessionScope(candidate, { identity, authEpoch }));
  for (const surface of surfaces) activateSurface(surface);
}

function observeFlushResults(results: SyncResult[]): void {
  for (const result of results) {
    const operationId = result.operationId;
    if (!operationId) continue;
    const tracked = trackedOperations.get(operationId);
    if (!tracked) continue;
    if (!result.ok && !result.conflict) continue;
    trackedOperations.delete(operationId);
    if (!tracked.isSessionCurrent()) {
      pendingAwards.delete(operationId);
      pendingCompletionSync.delete(operationId);
      continue;
    }
    if (!result.ok || result.reconciledConflict) continue;
    deliverCompletionSync(Object.freeze({
      ...tracked.identity,
      operationId,
      status: result.status,
      ...(Number.isSafeInteger(result.pointsDelta) ? { pointsDelta: result.pointsDelta } : {}),
      ...(Number.isSafeInteger(result.earnedTotal) ? { earnedTotal: result.earnedTotal } : {}),
      ...(Number.isSafeInteger(result.redeemableBalance) ? { redeemableBalance: result.redeemableBalance } : {}),
    }), tracked.authEpoch);
    if (tracked.desiredStatus !== 'COMPLETED'
      || result.status !== 'COMPLETED' || !Number.isSafeInteger(result.pointsDelta) || (result.pointsDelta ?? 0) <= 0) continue;
    deliverAward(Object.freeze({
      ...tracked.identity,
      operationId,
      pointsDelta: result.pointsDelta!,
      ...(Number.isSafeInteger(result.earnedTotal) ? { earnedTotal: result.earnedTotal } : {}),
      ...(Number.isSafeInteger(result.redeemableBalance) ? { redeemableBalance: result.redeemableBalance } : {}),
    }), tracked.authEpoch);
  }
}

function emptyRecord(identity: CompletionIdentity): CompletionRecord {
  return { ...identity, status: 'UNREPORTED', revision: 0, syncStatus: 'CONFIRMED' };
}

export function createCompletionController(getDependencies: () => CompletionControllerDependencies): CompletionController {
  async function flushExisting(dependencies: CompletionControllerDependencies): Promise<void> {
    try {
      const results = await dependencies.flush();
      observeFlushResults(results);
      if (!dependencies.isCurrent()) return;
      const record = dependencies.getRecord();
      if (record) dependencies.onRecord(record);
      dependencies.onSyncError(results.some((result) => !result.ok && !result.conflict) || record?.syncStatus === 'SAVE_FAILED');
    } catch {
      if (dependencies.isCurrent()) dependencies.onSyncError(true);
    }
  }

  async function perform(
    desiredStatus: 'COMPLETED' | 'NOT_COMPLETED',
    expectedIdentity: CompletionIdentity,
    expectedAuthEpoch: number,
  ): Promise<void> {
    const dependencies = getDependencies();
    if (!dependencies.isCurrent() || !dependencies.isVisible() || dependencies.authEpoch !== expectedAuthEpoch
      || identityKey(dependencies.identity) !== identityKey(expectedIdentity)) return;
    const identity = dependencies.identity;
    const current = dependencies.getRecord() ?? emptyRecord(identity);
    if (current.syncStatus === 'PENDING_SAVE') return;
    if (current.syncStatus === 'SAVE_FAILED') {
      if (!dependencies.hasPendingCompletion()) return;
      await flushExisting(dependencies);
      return;
    }
    if (desiredStatus === 'COMPLETED') {
      if (!dependencies.canComplete() || current.status === 'COMPLETED') return;
    } else if (current.status !== 'COMPLETED') {
      return;
    }

    const command: CompletionCommand = {
      ...identity,
      desiredStatus,
      operationId: dependencies.generateOperationId(),
      expectedRevision: current.revision,
      syncStatus: 'PENDING_SAVE',
    };
    trackedOperations.set(command.operationId, { identity: { ...identity }, authEpoch: dependencies.authEpoch, isSessionCurrent: dependencies.isSessionCurrent, desiredStatus });
    let pending: CompletionRecord;
    try {
      pending = dependencies.saveCompletion(command);
    } catch {
      trackedOperations.delete(command.operationId);
      dependencies.onSyncError(true);
      return;
    }
    if (pending.syncStatus === 'SAVE_FAILED') {
      trackedOperations.delete(command.operationId);
      dependencies.onRecord(pending);
      dependencies.onSyncError(true);
      return;
    }
    dependencies.onRecord(pending);
    try { void Promise.resolve(dependencies.onCommandSaved?.(command)).catch(() => undefined); } catch { /* Reminder reconciliation must not cancel a saved completion. */ }
    await flushExisting(dependencies);
    // A duplicate result may arrive from a recovery controller after this awaited flush. The shared
    // operation map and result observer make that a no-op, while this final read refreshes the tapper.
    const latestDependencies = getDependencies();
    if (latestDependencies.isCurrent() && latestDependencies.authEpoch === expectedAuthEpoch
      && identityKey(latestDependencies.identity) === identityKey(expectedIdentity)) {
      const latest = latestDependencies.getRecord();
      if (latest) latestDependencies.onRecord(latest);
    }
  }

  function run(
    desiredStatus: 'COMPLETED' | 'NOT_COMPLETED',
    expected?: { identity: CompletionIdentity; authEpoch: number },
  ): Promise<void> {
    const dependencies = getDependencies();
    const expectedIdentity = expected?.identity ?? dependencies.identity;
    const expectedAuthEpoch = expected?.authEpoch ?? dependencies.authEpoch;
    if (!dependencies.isCurrent() || !dependencies.isVisible() || dependencies.authEpoch !== expectedAuthEpoch
      || identityKey(dependencies.identity) !== identityKey(expectedIdentity)) return Promise.resolve();
    const key = `${identityKey(expectedIdentity)}\u0000${expectedAuthEpoch}`;
    const existing = actionFlights.get(key);
    if (existing) return existing;
    let flight!: Promise<void>;
    flight = Promise.resolve().then(() => perform(desiredStatus, { ...expectedIdentity }, expectedAuthEpoch)).finally(() => {
      if (actionFlights.get(key) === flight) actionFlights.delete(key);
    });
    actionFlights.set(key, flight);
    return flight;
  }

  return {
    complete: () => run('COMPLETED'),
    requestUndo: () => {
      const dependencies = getDependencies();
      if (!dependencies.isCurrent() || !dependencies.isVisible()) return;
      const current = dependencies.getRecord() ?? emptyRecord(dependencies.identity);
      if (current.status !== 'COMPLETED') return;
      const expected = { identity: { ...dependencies.identity }, authEpoch: dependencies.authEpoch };
      dependencies.confirmUndo(`確定撤銷 ${dependencies.identity.taskDate} 的完成？這一天的積分會一併撤回。`, () => {
        void run('NOT_COMPLETED', expected);
      });
    },
    observeFlushResults,
  };
}

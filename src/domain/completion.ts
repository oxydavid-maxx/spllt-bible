import type { CompletionStatus } from './types';

export type SyncStatus = 'CONFIRMED' | 'PENDING_SAVE' | 'SAVE_FAILED';

export interface CompletionRecord {
  memberId: string;
  planId: string;
  taskDate: string;
  status: CompletionStatus;
  revision: number;
  syncStatus: SyncStatus;
  pendingStatus?: CompletionStatus;
  lastOperationId?: string;
}

export interface CompletionCommand
  extends Omit<CompletionRecord, 'status' | 'revision' | 'lastOperationId'> {
  desiredStatus: CompletionStatus;
  operationId: string;
  expectedRevision: number;
}

export interface CompletionTransition {
  outcome: 'APPLIED' | 'IDEMPOTENT_REPLAY' | 'CONFLICT';
  record: CompletionRecord;
}

export function applyCompletion(
  command: CompletionCommand,
  current: CompletionRecord,
): CompletionTransition {
  if (command.memberId !== current.memberId || command.planId !== current.planId || command.taskDate !== current.taskDate) {
    throw new Error('completion command key does not match current record');
  }
  if (current.lastOperationId === command.operationId) {
    return { outcome: 'IDEMPOTENT_REPLAY', record: current };
  }
  if (command.expectedRevision !== current.revision) {
    return { outcome: 'CONFLICT', record: current };
  }

  return {
    outcome: 'APPLIED',
    record: {
      ...current,
      status: command.desiredStatus,
      revision: current.revision + 1,
      syncStatus: command.syncStatus,
      lastOperationId: command.operationId,
    },
  };
}

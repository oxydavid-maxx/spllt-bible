import { describe, expect, it } from 'vitest';
import { applyCompletion, type CompletionRecord } from '../../src/domain/completion';

describe('completion transitions', () => {
  const initial: CompletionRecord = {
    memberId: 'google:self',
    planId: 'church-2026-09',
    taskDate: '2026-09-08',
    status: 'UNREPORTED',
    revision: 0,
    syncStatus: 'CONFIRMED',
  };

  it('applies a completion once and safely replays the same operation', () => {
    const command = {
      ...initial,
      desiredStatus: 'COMPLETED' as const,
      operationId: 'op-1',
      expectedRevision: 0,
    };
    const applied = applyCompletion(command, initial);
    const replay = applyCompletion(command, applied.record);

    expect(applied.outcome).toBe('APPLIED');
    expect(applied.record.status).toBe('COMPLETED');
    expect(applied.record.revision).toBe(1);
    expect(replay.outcome).toBe('IDEMPOTENT_REPLAY');
    expect(replay.record).toEqual(applied.record);
  });

  it('reports a stale revision and keeps the current record', () => {
    const result = applyCompletion(
      { ...initial, desiredStatus: 'COMPLETED', operationId: 'op-stale', expectedRevision: 3 },
      initial,
    );
    expect(result.outcome).toBe('CONFLICT');
    expect(result.record).toEqual(initial);
  });

  it('models offline save and retry without changing the authoritative revision twice', () => {
    const pending = applyCompletion(
      {
        ...initial,
        desiredStatus: 'COMPLETED',
        operationId: 'op-offline',
        expectedRevision: 0,
        syncStatus: 'PENDING_SAVE',
      },
      initial,
    );
    expect(pending.record.syncStatus).toBe('PENDING_SAVE');

    const saved = applyCompletion(
      {
        ...pending.record,
        desiredStatus: pending.record.status,
        operationId: 'op-offline',
        expectedRevision: 0,
        syncStatus: 'CONFIRMED',
      },
      initial,
    );
    expect(saved.outcome).toBe('APPLIED');
    expect(saved.record.revision).toBe(1);
  });
});

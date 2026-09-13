import { describe, expect, it } from 'vitest';
import { LocalRepository } from '../../src/storage/localRepository';
import { Outbox } from '../../src/storage/outbox';

describe('offline completion outbox', () => {
  it('keeps a local save visibly pending until the authoritative retry succeeds', async () => {
    const outbox = new Outbox();
    const local = new LocalRepository(outbox);
    const command = {
      memberId: 'google:self',
      planId: 'church-2026-09',
      taskDate: '2026-09-08',
      desiredStatus: 'COMPLETED' as const,
      operationId: 'offline-op-1',
      expectedRevision: 0,
      syncStatus: 'PENDING_SAVE' as const,
    };

    expect(local.saveCompletion(command).syncStatus).toBe('PENDING_SAVE');
    const sent: string[] = [];
    const results = await outbox.flush(async (queued) => {
      sent.push(queued.operationId);
      return { ok: true, revision: 1, status: 'COMPLETED' as const };
    });

    expect(results).toHaveLength(1);
    expect(sent).toEqual(['offline-op-1']);
    expect(outbox.size).toBe(0);
  });

  it('retries the same operation id and stops for a revision conflict', async () => {
    const outbox = new Outbox();
    outbox.enqueue({
      memberId: 'google:self',
      planId: 'church-2026-09',
      taskDate: '2026-09-08',
      desiredStatus: 'COMPLETED',
      operationId: 'op-conflict',
      expectedRevision: 0,
      syncStatus: 'PENDING_SAVE',
    });
    const attempts: string[] = [];
    const results = await outbox.flush(async (queued) => {
      attempts.push(queued.operationId);
      return { ok: false, conflict: true, revision: 2, status: 'COMPLETED' as const };
    });

    expect(attempts).toEqual(['op-conflict']);
    expect(results[0]).toMatchObject({ conflict: true });
    expect(outbox.size).toBe(1);
  });
});

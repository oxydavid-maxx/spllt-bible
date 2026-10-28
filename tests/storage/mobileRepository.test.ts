import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { createMobileRepository, type MobileDatabase } from '../../src/storage/mobileRepository';

function nodeDatabase(): { node: DatabaseSync; mobile: MobileDatabase } {
  const node = new DatabaseSync(':memory:');
  return {
    node,
    mobile: {
      execSync: (source) => node.exec(source),
      runSync: (source, ...params) => node.prepare(source).run(...(params as never[])),
      getFirstSync: <T>(source: string, ...params: unknown[]) => node.prepare(source).get(...(params as never[])) as T | null,
      getAllSync: <T>(source: string, ...params: unknown[]) => node.prepare(source).all(...(params as never[])) as T[],
    },
  };
}

describe('durable mobile completion repository', () => {
  it('persists pending and confirmed state across repository recreation', async () => {
    const { node, mobile } = nodeDatabase();
    const repository = createMobileRepository(mobile);
    const command = {
      memberId: 'google:self',
      planId: 'church-2026-09',
      taskDate: '2026-09-08',
      desiredStatus: 'COMPLETED' as const,
      operationId: 'mobile-op-1',
      expectedRevision: 0,
      syncStatus: 'PENDING_SAVE' as const,
    };
    expect(repository.saveCompletion(command)).toMatchObject({ status: 'COMPLETED', syncStatus: 'PENDING_SAVE' });

    const reopened = createMobileRepository(mobile);
    expect(reopened.get(command)).toMatchObject({ status: 'COMPLETED', syncStatus: 'PENDING_SAVE', revision: 1 });
    const sent: string[] = [];
    await reopened.flush(async (queued) => {
      sent.push(queued.operationId);
      return { ok: true, revision: 1, status: 'COMPLETED' as const };
    });
    expect(sent).toEqual(['mobile-op-1']);
    expect(reopened.get(command)).toMatchObject({ syncStatus: 'CONFIRMED', revision: 1 });
    expect(reopened.pendingCount()).toBe(0);
    node.close();
  });

  it('retains the operation for stale revision reconciliation', async () => {
    const { node, mobile } = nodeDatabase();
    const repository = createMobileRepository(mobile);
    const command = {
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08', desiredStatus: 'COMPLETED' as const,
      operationId: 'mobile-op-conflict', expectedRevision: 0, syncStatus: 'PENDING_SAVE' as const,
    };
    repository.saveCompletion(command);
    const results = await repository.flush(async () => ({ ok: false as const, conflict: true as const, revision: 2, status: 'COMPLETED' as const }));
    expect(results[0]).toMatchObject({ conflict: true });
    expect(repository.pendingCount()).toBe(1);
    node.close();
  });

  it('reconciles a stale replay to the server state without reviving the old intent', async () => {
    const { node, mobile } = nodeDatabase();
    const repository = createMobileRepository(mobile);
    const oldCommand = {
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08', desiredStatus: 'COMPLETED' as const,
      operationId: 'mobile-op-lost-response', expectedRevision: 0, syncStatus: 'PENDING_SAVE' as const,
    };
    repository.saveCompletion(oldCommand);
    const stale = await repository.flush(async (queued) => {
      expect(queued.operationId).toBe(oldCommand.operationId);
      return { ok: false as const, conflict: true as const, error: 'OPERATION_REPLAY_STALE' as const, revision: 2, status: 'NOT_COMPLETED' as const };
    });

    expect(stale).toMatchObject([{ ok: false, error: 'OPERATION_REPLAY_STALE', reconciledConflict: true, revision: 2, status: 'NOT_COMPLETED' }]);
    expect(repository.pendingCount()).toBe(0);
    expect(repository.get(oldCommand)).toMatchObject({ status: 'NOT_COMPLETED', revision: 2, syncStatus: 'CONFIRMED' });

    const newCommand = { ...oldCommand, operationId: 'mobile-op-explicit-retry', expectedRevision: 2 };
    repository.saveCompletion(newCommand);
    const retried = await repository.flush(async (queued) => {
      expect(queued.operationId).toBe(newCommand.operationId);
      expect(queued.expectedRevision).toBe(2);
      return { ok: true as const, revision: 3, status: 'COMPLETED' as const };
    });
    expect(retried).toMatchObject([{ ok: true, revision: 3, status: 'COMPLETED' }]);
    expect(repository.get(newCommand)).toMatchObject({ status: 'COMPLETED', revision: 3, syncStatus: 'CONFIRMED' });
    node.close();
  });

  it('confirms a pending intent when the server already has the desired state', async () => {
    const { node, mobile } = nodeDatabase();
    const repository = createMobileRepository(mobile);
    const command = {
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08', desiredStatus: 'COMPLETED' as const,
      operationId: 'mobile-op-authoritative-complete', expectedRevision: 2, syncStatus: 'PENDING_SAVE' as const,
    };
    mobile.runSync('INSERT INTO qingmu_completions (member_id, plan_id, task_date, status, revision, sync_status, last_operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)', 'google:self', 'church-2026-09', '2026-09-08', 'NOT_COMPLETED', 2, 'CONFIRMED', null);
    repository.saveCompletion(command);
    const results = await repository.flush(async () => ({ ok: false as const, conflict: true as const, error: 'REVISION_CONFLICT' as const, revision: 5, status: 'COMPLETED' as const }));

    expect(results[0]).toMatchObject({ ok: true, reconciledConflict: true, revision: 5, status: 'COMPLETED' });
    expect(repository.pendingCount()).toBe(0);
    expect(repository.get(command)).toMatchObject({ status: 'COMPLETED', revision: 5, syncStatus: 'CONFIRMED' });
    node.close();
  });

  it('reconciles a stale opposite intent without automatically applying it', async () => {
    const { node, mobile } = nodeDatabase();
    const repository = createMobileRepository(mobile);
    const command = {
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08', desiredStatus: 'NOT_COMPLETED' as const,
      operationId: 'mobile-op-rebase', expectedRevision: 2, syncStatus: 'PENDING_SAVE' as const,
    };
    mobile.runSync('INSERT INTO qingmu_completions (member_id, plan_id, task_date, status, revision, sync_status, last_operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)', 'google:self', 'church-2026-09', '2026-09-08', 'COMPLETED', 2, 'CONFIRMED', null);
    repository.saveCompletion(command);
    const sent: Array<{ operationId: string; expectedRevision: number }> = [];
    const results = await repository.flush(async (queued) => {
      sent.push({ operationId: queued.operationId, expectedRevision: queued.expectedRevision });
      return { ok: false as const, conflict: true as const, error: 'REVISION_CONFLICT' as const, revision: 5, status: 'COMPLETED' as const };
    });

    expect(sent).toEqual([{ operationId: 'mobile-op-rebase', expectedRevision: 2 }]);
    expect(results.at(-1)).toMatchObject({ ok: false, error: 'REVISION_CONFLICT', reconciledConflict: true, revision: 5, status: 'COMPLETED' });
    expect(repository.pendingCount()).toBe(0);
    expect(repository.get(command)).toMatchObject({ status: 'COMPLETED', revision: 5, syncStatus: 'CONFIRMED' });
    node.close();
  });

  it('removes an opposite intent after a revision conflict until the user explicitly retries', async () => {
    const { node, mobile } = nodeDatabase();
    const repository = createMobileRepository(mobile);
    const command = {
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08', desiredStatus: 'NOT_COMPLETED' as const,
      operationId: 'mobile-op-second-conflict', expectedRevision: 2, syncStatus: 'PENDING_SAVE' as const,
    };
    mobile.runSync('INSERT INTO qingmu_completions (member_id, plan_id, task_date, status, revision, sync_status, last_operation_id) VALUES (?, ?, ?, ?, ?, ?, ?)', 'google:self', 'church-2026-09', '2026-09-08', 'COMPLETED', 2, 'CONFIRMED', null);
    repository.saveCompletion(command);
    const sent: number[] = [];
    await repository.flush(async (queued) => {
      sent.push(queued.expectedRevision);
      return { ok: false as const, conflict: true as const, error: 'REVISION_CONFLICT' as const, revision: 5, status: 'COMPLETED' as const };
    });

    expect(sent).toEqual([2]);
    expect(repository.pendingCount()).toBe(0);
    expect(repository.get(command)).toMatchObject({ status: 'COMPLETED', revision: 5, syncStatus: 'CONFIRMED' });
    node.close();
  });

  it('does not let an older queued acknowledgement overwrite a newer intent', async () => {
    const { node, mobile } = nodeDatabase();
    const repository = createMobileRepository(mobile);
    repository.saveCompletion({
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08', desiredStatus: 'COMPLETED',
      operationId: 'z-mobile-op-older', expectedRevision: 0, syncStatus: 'PENDING_SAVE',
    });
    repository.saveCompletion({
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08', desiredStatus: 'NOT_COMPLETED',
      operationId: 'a-mobile-op-newer', expectedRevision: 1, syncStatus: 'PENDING_SAVE',
    });
    mobile.runSync("UPDATE qingmu_outbox SET created_at = '2026-09-09T00:00:00.000Z'");
    const sent: string[] = [];
    await repository.flush(async (command) => {
      sent.push(command.operationId);
      return command.operationId === 'z-mobile-op-older'
        ? { ok: true as const, revision: 1, status: 'COMPLETED' as const }
        : { ok: true as const, revision: 2, status: 'NOT_COMPLETED' as const };
    });

    expect(sent).toEqual(['z-mobile-op-older', 'a-mobile-op-newer']);
    expect(repository.pendingCount()).toBe(0);
    const final = repository.get({ memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-08' });
    expect(final).toMatchObject({ status: 'NOT_COMPLETED', revision: 2, syncStatus: 'CONFIRMED' });
    expect(final?.pendingStatus).toBeUndefined();
    node.close();
  });

  it('serializes concurrent flushes so one queued operation is sent once', async () => {
    const { node, mobile } = nodeDatabase();
    const repository = createMobileRepository(mobile);
    repository.saveCompletion({
      memberId: 'google:self',
      planId: 'church-2026-09',
      taskDate: '2026-09-08',
      desiredStatus: 'COMPLETED',
      operationId: 'mobile-op-serialized',
      expectedRevision: 0,
      syncStatus: 'PENDING_SAVE',
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const send = vi.fn(async () => {
      await gate;
      return { ok: true as const, revision: 1, status: 'COMPLETED' as const };
    });

    const first = repository.flush(send);
    const second = repository.flush(send);
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([first, second]);
    expect(repository.pendingCount()).toBe(0);
    node.close();
  });

  it('does not flush another member\'s queued command after an identity change', async () => {
    const { node, mobile } = nodeDatabase();
    const repository = createMobileRepository(mobile);
    repository.saveCompletion({
      memberId: 'google:old',
      planId: 'church-2026-09',
      taskDate: '2026-09-08',
      desiredStatus: 'COMPLETED',
      operationId: 'mobile-op-old-member',
      expectedRevision: 0,
      syncStatus: 'PENDING_SAVE',
    });
    const send = vi.fn(async () => ({ ok: true as const, revision: 1, status: 'COMPLETED' as const }));

    await repository.flush(send, 'google:new');

    expect(send).not.toHaveBeenCalled();
    expect(repository.pendingCount()).toBe(1);
    node.close();
  });

  it('drops an expired completion from the outbox without treating it as confirmed points', async () => {
    const { node, mobile } = nodeDatabase();
    const repository = createMobileRepository(mobile);
    const command = {
      memberId: 'google:self', planId: 'church-2026-09', taskDate: '2026-09-01', desiredStatus: 'COMPLETED' as const,
      operationId: 'mobile-op-expired', expectedRevision: 0, syncStatus: 'PENDING_SAVE' as const,
    };
    repository.saveCompletion(command);
    const results = await repository.flush(async () => ({ ok: false as const, error: 'OUTSIDE_COMPLETION_WINDOW' }));
    expect(results).toMatchObject([{ ok: false, error: 'OUTSIDE_COMPLETION_WINDOW' }]);
    expect(repository.pendingCount()).toBe(0);
    expect(repository.get(command)).toMatchObject({ status: 'COMPLETED', syncStatus: 'SAVE_FAILED', pendingStatus: 'COMPLETED', lastOperationId: command.operationId });
    expect(repository.hasPendingCompletion(command)).toBe(false);
    node.close();
  });
});

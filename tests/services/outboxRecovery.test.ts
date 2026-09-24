import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutboxRecoveryController, type OutboxRecoveryRepository, type OutboxRecoverySession } from '../../src/services/outboxRecovery';
import type { SyncResult } from '../../src/storage/outbox';

const TARGET = { memberId: 'member-1', planId: 'church-2026-09', taskDate: '2026-09-10' };
const OPERATION_ID = 'op-recovery-1';

function queuedCommand() {
  return {
    memberId: TARGET.memberId,
    planId: TARGET.planId,
    taskDate: TARGET.taskDate,
    desiredStatus: 'COMPLETED' as const,
    operationId: OPERATION_ID,
    expectedRevision: 0,
    syncStatus: 'PENDING_SAVE' as const,
  };
}

/** Mirrors the essential contract of mobileRepository.flush: re-sends the same queued command
 * (same operationId) until send() resolves ok, and only clears PENDING_SAVE on success. */
function makeRepository(): OutboxRecoveryRepository & { syncStatus: 'PENDING_SAVE' | 'CONFIRMED' } {
  const state: OutboxRecoveryRepository & { syncStatus: 'PENDING_SAVE' | 'CONFIRMED' } = {
    syncStatus: 'PENDING_SAVE',
    get: () => ({ ...TARGET, status: 'UNREPORTED', revision: 0, syncStatus: state.syncStatus }),
    flush: async (send, memberId) => {
      if (state.syncStatus !== 'PENDING_SAVE') return [];
      if (memberId && memberId !== TARGET.memberId) return [];
      const result = await send(queuedCommand());
      if (result.ok) state.syncStatus = 'CONFIRMED';
      return [result];
    },
  };
  return state;
}

describe('outboxRecovery controller', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('kick() (AppState active) triggers exactly one flush send with the unchanged operationId', async () => {
    const repository = makeRepository();
    const saveCompletion = vi.fn<(command: unknown) => Promise<SyncResult>>().mockResolvedValue({ ok: true, revision: 1, status: 'COMPLETED' });
    const session: OutboxRecoverySession = { memberId: 'member-1', sessionToken: 'tok' };
    const onRecovered = vi.fn();
    const controller = createOutboxRecoveryController({
      getRepository: () => repository,
      getClient: () => ({ saveCompletion }),
      getSession: () => session,
      isCurrentAuthSession: (s) => s?.memberId === session.memberId && s.sessionToken === session.sessionToken,
      getTarget: () => TARGET,
      onRecovered,
    });

    controller.kick();
    await vi.advanceTimersByTimeAsync(0);

    expect(saveCompletion).toHaveBeenCalledTimes(1);
    expect(saveCompletion).toHaveBeenCalledWith(expect.objectContaining({ operationId: OPERATION_ID }));
    expect(repository.syncStatus).toBe('CONFIRMED');
    expect(onRecovered).toHaveBeenCalledTimes(1);

    // No pending record left, so no backoff timer should fire later.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(saveCompletion).toHaveBeenCalledTimes(1);
  });

  it('passes exact flush responses to the shared completion result observer', async () => {
    const repository = makeRepository();
    const response: SyncResult = { ok: true, operationId: OPERATION_ID, revision: 1, status: 'COMPLETED', pointsDelta: 1, earnedTotal: 1, redeemableBalance: 1 };
    const saveCompletion = vi.fn<(command: unknown) => Promise<SyncResult>>().mockResolvedValue(response);
    const onRecovered = vi.fn<(results: SyncResult[]) => void>();
    const session: OutboxRecoverySession = { memberId: 'member-1', sessionToken: 'tok' };
    const controller = createOutboxRecoveryController({
      getRepository: () => repository,
      getClient: () => ({ saveCompletion }),
      getSession: () => session,
      isCurrentAuthSession: () => true,
      getTarget: () => TARGET,
      onRecovered,
    });

    controller.kick();
    await vi.advanceTimersByTimeAsync(0);

    expect(onRecovered).toHaveBeenCalledWith([response]);
  });

  it('retries with doubling backoff (10s, 20s, 40s) until send succeeds, then stops', async () => {
    const repository = makeRepository();
    const saveCompletion = vi.fn<(command: unknown) => Promise<SyncResult>>()
      .mockResolvedValueOnce({ ok: false, error: 'offline' })
      .mockResolvedValueOnce({ ok: false, error: 'offline' })
      .mockResolvedValueOnce({ ok: false, error: 'offline' })
      .mockResolvedValueOnce({ ok: true, revision: 1, status: 'COMPLETED' });
    const session: OutboxRecoverySession = { memberId: 'member-1', sessionToken: 'tok' };
    const controller = createOutboxRecoveryController({
      getRepository: () => repository,
      getClient: () => ({ saveCompletion }),
      getSession: () => session,
      isCurrentAuthSession: (s) => s?.memberId === session.memberId,
      getTarget: () => TARGET,
      onRecovered: () => {},
    });

    controller.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(saveCompletion).toHaveBeenCalledTimes(1); // immediate attempt on 'active'

    await vi.advanceTimersByTimeAsync(9_999);
    expect(saveCompletion).toHaveBeenCalledTimes(1); // not yet — first retry waits 10s

    await vi.advanceTimersByTimeAsync(1);
    expect(saveCompletion).toHaveBeenCalledTimes(2); // 10s retry fired

    await vi.advanceTimersByTimeAsync(19_999);
    expect(saveCompletion).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(saveCompletion).toHaveBeenCalledTimes(3); // next retry doubled to 20s

    await vi.advanceTimersByTimeAsync(39_999);
    expect(saveCompletion).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(saveCompletion).toHaveBeenCalledTimes(4); // doubled again to 40s, this call succeeds

    expect(repository.syncStatus).toBe('CONFIRMED');

    // Confirmed — no further retries should ever fire.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(saveCompletion).toHaveBeenCalledTimes(4);
  });

  it('caps backoff at 60s and never exceeds it on repeated failures', async () => {
    const repository = makeRepository();
    const saveCompletion = vi.fn<(command: unknown) => Promise<SyncResult>>().mockResolvedValue({ ok: false, error: 'offline' });
    const session: OutboxRecoverySession = { memberId: 'member-1', sessionToken: 'tok' };
    const controller = createOutboxRecoveryController({
      getRepository: () => repository,
      getClient: () => ({ saveCompletion }),
      getSession: () => session,
      isCurrentAuthSession: () => true,
      getTarget: () => TARGET,
      onRecovered: () => {},
    });

    controller.kick();
    await vi.advanceTimersByTimeAsync(0); // attempt 1 (immediate)
    await vi.advanceTimersByTimeAsync(10_000); // attempt 2 (10s)
    await vi.advanceTimersByTimeAsync(20_000); // attempt 3 (20s)
    await vi.advanceTimersByTimeAsync(40_000); // attempt 4 (40s)
    expect(saveCompletion).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000); // attempt 5 (capped at 60s, not 80s)
    expect(saveCompletion).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(60_000); // attempt 6 stays at 60s cadence
    expect(saveCompletion).toHaveBeenCalledTimes(6);
    controller.stop();
  });

  it('a member/session change (stop()) cancels pending retries and sends nothing more for the previous member', async () => {
    const repository = makeRepository();
    const saveCompletion = vi.fn<(command: unknown) => Promise<SyncResult>>().mockResolvedValue({ ok: false, error: 'offline' });
    const session: OutboxRecoverySession = { memberId: 'member-1', sessionToken: 'tok' };
    const controller = createOutboxRecoveryController({
      getRepository: () => repository,
      getClient: () => ({ saveCompletion }),
      getSession: () => session,
      isCurrentAuthSession: (s) => s?.memberId === session.memberId,
      getTarget: () => TARGET,
      onRecovered: () => {},
    });

    controller.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(saveCompletion).toHaveBeenCalledTimes(1);

    // A retry is scheduled for +10s; simulate the member/session switching away (what the hook's
    // effect cleanup does) before that timer fires.
    controller.stop();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(saveCompletion).toHaveBeenCalledTimes(1); // no further sends for the old member
  });

  it('bails out of an in-flight attempt if the session guard flips before send resolves, without a new controller call', async () => {
    const repository = makeRepository();
    let sessionIsCurrent = true;
    const saveCompletion = vi.fn<(command: unknown) => Promise<SyncResult>>().mockResolvedValue({ ok: true, revision: 1, status: 'COMPLETED' });
    const controller = createOutboxRecoveryController({
      getRepository: () => repository,
      getClient: () => ({ saveCompletion }),
      getSession: () => ({ memberId: 'member-1', sessionToken: 'tok' }),
      isCurrentAuthSession: () => sessionIsCurrent,
      getTarget: () => TARGET,
      onRecovered: () => { throw new Error('onRecovered must not run once the session guard has flipped'); },
    });

    // Flip the guard mid-flush by making the mocked send flip it before resolving.
    saveCompletion.mockImplementationOnce(async () => {
      sessionIsCurrent = false;
      return { ok: true, revision: 1, status: 'COMPLETED' };
    });

    controller.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(saveCompletion).toHaveBeenCalledTimes(1);
  });
});

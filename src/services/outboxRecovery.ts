import type { CompletionCommand, CompletionRecord } from '../domain/completion';
import type { SyncResult } from '../storage/outbox';

export interface OutboxRecoverySession {
  memberId: string;
  sessionToken: string;
}

export interface OutboxRecoveryTarget {
  memberId: string;
  planId: string;
  taskDate: string;
}

export interface OutboxRecoveryRepository {
  get: (target: OutboxRecoveryTarget) => CompletionRecord | undefined;
  flush: (send: (command: CompletionCommand) => Promise<SyncResult>, memberId?: string) => Promise<SyncResult[]>;
}

export interface OutboxRecoveryClient {
  saveCompletion: (command: CompletionCommand) => Promise<SyncResult>;
}

export interface OutboxRecoveryControllerOptions {
  getRepository: () => OutboxRecoveryRepository | null;
  getClient: () => OutboxRecoveryClient | null;
  getSession: () => OutboxRecoverySession | null;
  isCurrentAuthSession: (session: OutboxRecoverySession | null) => boolean;
  getTarget: () => OutboxRecoveryTarget | null;
  /** Invoked after every flush attempt (success or failure) while the session guard still holds. */
  onRecovered: () => void;
  /** Initial retry delay in ms once a flush attempt leaves the record PENDING_SAVE. Default 10s. */
  minDelayMs?: number;
  /** Ceiling for the doubling backoff. Default 60s. */
  maxDelayMs?: number;
  setTimeoutFn?: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface OutboxRecoveryController {
  /** Call when the app becomes active (foreground): flushes immediately and resets backoff. */
  kick: () => void;
  /** Call when the app leaves the active state: stops the retry timer without ending the controller. */
  pause: () => void;
  /** Call on member/session change or unmount: stops the timer permanently; later callbacks are no-ops. */
  stop: () => void;
}

/**
 * Reusable bounded-backoff recovery loop for a single (memberId, planId, taskDate) outbox target.
 * Pure — no React/AppState dependency, so it can be unit tested directly. `repository.flush` is the
 * SAME queue-draining function used everywhere else, so the operationId and dedup semantics are
 * unchanged: recovery only ever re-sends what is already queued.
 */
export function createOutboxRecoveryController(options: OutboxRecoveryControllerOptions): OutboxRecoveryController {
  const minDelay = options.minDelayMs ?? 10_000;
  const maxDelay = options.maxDelayMs ?? 60_000;
  const scheduleTimeout = options.setTimeoutFn ?? ((handler, timeout) => setTimeout(handler, timeout));
  const cancelTimeout = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));

  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentDelay = minDelay;
  let stopped = false;
  let inFlight = false;

  function clearTimer(): void {
    if (timer !== null) {
      cancelTimeout(timer);
      timer = null;
    }
  }

  function isPending(): boolean {
    const repository = options.getRepository();
    const target = options.getTarget();
    if (!repository || !target) return false;
    return repository.get(target)?.syncStatus === 'PENDING_SAVE';
  }

  function scheduleRetry(): void {
    clearTimer();
    if (stopped) return;
    if (!isPending()) {
      currentDelay = minDelay;
      return;
    }
    const delay = currentDelay;
    currentDelay = Math.min(currentDelay * 2, maxDelay);
    timer = scheduleTimeout(() => {
      void attemptFlush();
    }, delay);
  }

  async function attemptFlush(): Promise<void> {
    if (stopped || inFlight) return;
    if (!options.isCurrentAuthSession(options.getSession())) return;
    const repository = options.getRepository();
    const client = options.getClient();
    const target = options.getTarget();
    if (!repository || !client || !target) return;
    inFlight = true;
    try {
      await repository.flush((command) => client.saveCompletion(command), target.memberId);
    } catch {
      // transport errors leave the record PENDING_SAVE; scheduleRetry below re-arms the backoff.
    } finally {
      inFlight = false;
    }
    if (stopped) return;
    if (!options.isCurrentAuthSession(options.getSession())) return;
    options.onRecovered();
    scheduleRetry();
  }

  function kick(): void {
    if (stopped) return;
    clearTimer();
    currentDelay = minDelay;
    void attemptFlush();
  }

  function pause(): void {
    clearTimer();
  }

  function stop(): void {
    stopped = true;
    clearTimer();
  }

  return { kick, pause, stop };
}

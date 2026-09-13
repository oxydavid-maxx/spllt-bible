import type { CompletionCommand } from '../domain/completion';
import type { CompletionStatus } from '../domain/types';

export type QueuedCompletion = CompletionCommand;

export type SyncResult =
  | { ok: true; revision: number; status: 'UNREPORTED' | 'NOT_COMPLETED' | 'COMPLETED'; reconciledConflict?: true }
  | { ok: false; conflict: true; error?: 'REVISION_CONFLICT' | 'OPERATION_REPLAY_STALE'; revision: number; status: CompletionStatus }
  | { ok: false; conflict?: false; error: string };

export class Outbox {
  private readonly queue: QueuedCompletion[] = [];

  get size(): number {
    return this.queue.length;
  }

  enqueue(command: QueuedCompletion): void {
    if (!this.queue.some((item) => item.operationId === command.operationId)) {
      this.queue.push(command);
    }
  }

  async flush(send: (command: QueuedCompletion) => Promise<SyncResult>): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    while (this.queue.length > 0) {
      const command = this.queue[0];
      const result = await send(command);
      results.push(result);
      if (!result.ok && result.conflict) break;
      if (!result.ok) break;
      this.queue.shift();
    }
    return results;
  }
}

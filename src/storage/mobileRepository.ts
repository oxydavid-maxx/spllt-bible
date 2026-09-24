import { applyCompletion, type CompletionCommand, type CompletionRecord } from '../domain/completion';
import type { SyncResult } from './outbox';

export interface MobileDatabase {
  execSync(source: string): void;
  runSync(source: string, ...params: unknown[]): unknown;
  getFirstSync<T>(source: string, ...params: unknown[]): T | null;
  getAllSync<T>(source: string, ...params: unknown[]): T[];
}

interface StoredCompletion {
  member_id: string;
  plan_id: string;
  task_date: string;
  status: CompletionRecord['status'];
  revision: number;
  sync_status: CompletionRecord['syncStatus'];
  pending_status: CompletionRecord['pendingStatus'] | null;
  last_operation_id: string | null;
}

interface StoredOutbox {
  operation_id: string;
  command_json: string;
}

export type MobileQueuedCommand = CompletionCommand;

/** Kept for source compatibility with the previous repository constructor.
 * Replay recovery never consumes this generator; new operation IDs only come
 * from an explicit UI command. */
export interface MobileRepositoryOptions {
  generateOperationId?: () => string;
}

function key(record: Pick<CompletionRecord, 'memberId' | 'planId' | 'taskDate'>): string {
  return `${record.memberId}:${record.planId}:${record.taskDate}`;
}

function toRecord(row: StoredCompletion | null): CompletionRecord | undefined {
  if (!row) return undefined;
  return {
    memberId: row.member_id,
    planId: row.plan_id,
    taskDate: row.task_date,
    status: row.status,
    revision: row.revision,
    syncStatus: row.sync_status,
    ...(row.pending_status ? { pendingStatus: row.pending_status } : {}),
    ...(row.last_operation_id ? { lastOperationId: row.last_operation_id } : {}),
  };
}

export function createMobileRepository(database: MobileDatabase, _options: MobileRepositoryOptions = {}) {
  database.execSync(`
    CREATE TABLE IF NOT EXISTS qingmu_completions (
      member_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      task_date TEXT NOT NULL,
      status TEXT NOT NULL,
      revision INTEGER NOT NULL,
      sync_status TEXT NOT NULL,
      pending_status TEXT,
      last_operation_id TEXT,
      PRIMARY KEY (member_id, plan_id, task_date)
    );
    CREATE TABLE IF NOT EXISTS qingmu_outbox (
      operation_id TEXT PRIMARY KEY,
      command_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const completionColumns = database.getAllSync<{ name: string }>('PRAGMA table_info(qingmu_completions)');
  if (!completionColumns.some((column) => column.name === 'pending_status')) {
    database.execSync('ALTER TABLE qingmu_completions ADD COLUMN pending_status TEXT');
  }

  function get(record: Pick<CompletionRecord, 'memberId' | 'planId' | 'taskDate'>): CompletionRecord | undefined {
    return toRecord(
      database.getFirstSync<StoredCompletion>(
        'SELECT member_id, plan_id, task_date, status, revision, sync_status, pending_status, last_operation_id FROM qingmu_completions WHERE member_id = ? AND plan_id = ? AND task_date = ?',
        record.memberId,
        record.planId,
        record.taskDate,
      ),
    );
  }

  function hasPendingCompletion(identity: Pick<CompletionRecord, 'memberId' | 'planId' | 'taskDate'>): boolean {
    const record = get(identity);
    if (!record?.lastOperationId) return false;
    const queued = database.getFirstSync<StoredOutbox>(
      'SELECT operation_id, command_json FROM qingmu_outbox WHERE operation_id = ?',
      record.lastOperationId,
    );
    if (!queued) return false;
    try {
      const command = JSON.parse(queued.command_json) as MobileQueuedCommand;
      return command.memberId === identity.memberId && command.planId === identity.planId && command.taskDate === identity.taskDate;
    } catch {
      return false;
    }
  }

  function saveCompletion(command: MobileQueuedCommand): CompletionRecord {
    const current = get(command) ?? {
      memberId: command.memberId,
      planId: command.planId,
      taskDate: command.taskDate,
      status: 'UNREPORTED' as const,
      revision: 0,
      syncStatus: 'CONFIRMED' as const,
    };
    const transition = applyCompletion(command, current);
    if (transition.outcome === 'CONFLICT') return { ...current, syncStatus: 'SAVE_FAILED' };
    const record = { ...transition.record, syncStatus: 'PENDING_SAVE' as const, pendingStatus: command.desiredStatus };
    database.execSync('BEGIN IMMEDIATE');
    try {
      database.runSync(
        `INSERT INTO qingmu_completions (member_id, plan_id, task_date, status, revision, sync_status, pending_status, last_operation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(member_id, plan_id, task_date) DO UPDATE SET status=excluded.status, revision=excluded.revision, sync_status=excluded.sync_status, pending_status=excluded.pending_status, last_operation_id=excluded.last_operation_id`,
        record.memberId,
        record.planId,
        record.taskDate,
        record.status,
        record.revision,
        record.syncStatus,
        record.pendingStatus ?? null,
        record.lastOperationId ?? null,
      );
      database.runSync(
        'INSERT OR REPLACE INTO qingmu_outbox (operation_id, command_json, created_at) VALUES (?, ?, ?)',
        command.operationId,
        JSON.stringify(command),
        new Date().toISOString(),
      );
      database.execSync('COMMIT');
    } catch (error) {
      database.execSync('ROLLBACK');
      throw error;
    }
    return record;
  }

  let flushTail: Promise<void> = Promise.resolve();

  async function flushOnce(send: (command: MobileQueuedCommand) => Promise<SyncResult>, memberId?: string): Promise<SyncResult[]> {
    const queued = database
      .getAllSync<StoredOutbox>('SELECT operation_id, command_json FROM qingmu_outbox ORDER BY created_at, rowid')
      .filter((item) => !memberId || (JSON.parse(item.command_json) as MobileQueuedCommand).memberId === memberId);
    const results: SyncResult[] = [];
    for (const item of queued) {
      let command = JSON.parse(item.command_json) as MobileQueuedCommand;
      let commandSettled = false;
      while (true) {
        const result = await send(command);
        results.push(result);
        if (result.ok) {
          confirmAuthoritative(command, result.revision, result.status);
          commandSettled = true;
          break;
        }

        // A replay-stale response means another device has since changed the
        // same completion. The server's status/revision is authoritative: end
        // this outbox item and reconcile locally. Rotating the operation ID
        // would turn an old intent into a fresh write and could award/withdraw
        // points after the user has already acted elsewhere. A new operation
        // is created only by a new explicit saveCompletion call.
        if (result.conflict && result.error === 'OPERATION_REPLAY_STALE') {
          confirmAuthoritative(command, result.revision, result.status);
          results[results.length - 1] = { ...result, reconciledConflict: true };
          commandSettled = true;
          break;
        }

        if (result.conflict && result.error === 'REVISION_CONFLICT') {
          if (result.status === command.desiredStatus) {
            confirmAuthoritative(command, result.revision, result.status);
            results[results.length - 1] = { ok: true, operationId: command.operationId, revision: result.revision, status: result.status, reconciledConflict: true };
            commandSettled = true;
            break;
          }
          confirmAuthoritative(command, result.revision, result.status);
          results[results.length - 1] = { ...result, reconciledConflict: true };
          commandSettled = true;
          break;
        }
        if (!result.conflict && (result.error === 'OUTSIDE_COMPLETION_WINDOW' || result.error === 'UNSCHEDULED_DAY')) {
          rejectTerminal(command);
          commandSettled = true;
        }
        break;
      }
      if (!commandSettled) break;
    }
    return results;
  }

  function rejectTerminal(command: MobileQueuedCommand): void {
    const current = get(command);
    database.execSync('BEGIN IMMEDIATE');
    try {
      database.runSync('DELETE FROM qingmu_outbox WHERE operation_id = ?', command.operationId);
      if (current?.lastOperationId === command.operationId) {
        database.runSync(
          'UPDATE qingmu_completions SET sync_status = ?, pending_status = ? WHERE member_id = ? AND plan_id = ? AND task_date = ?',
          'SAVE_FAILED',
          command.desiredStatus,
          command.memberId,
          command.planId,
          command.taskDate,
        );
      }
      database.execSync('COMMIT');
    } catch (error) {
      database.execSync('ROLLBACK');
      throw error;
    }
  }

  function confirmAuthoritative(command: MobileQueuedCommand, revision: number, status: CompletionRecord['status']): void {
    const current = get(command);
    database.execSync('BEGIN IMMEDIATE');
    try {
      if (current?.lastOperationId && current.lastOperationId !== command.operationId) {
        database.runSync(
          'UPDATE qingmu_completions SET revision = ?, sync_status = ? WHERE member_id = ? AND plan_id = ? AND task_date = ?',
          revision,
          'PENDING_SAVE',
          command.memberId,
          command.planId,
          command.taskDate,
        );
      } else {
        database.runSync(
          'UPDATE qingmu_completions SET revision = ?, status = ?, sync_status = ?, pending_status = ?, last_operation_id = ? WHERE member_id = ? AND plan_id = ? AND task_date = ?',
          revision,
          status,
          'CONFIRMED',
          null,
          command.operationId,
          command.memberId,
          command.planId,
          command.taskDate,
        );
      }
      database.runSync('DELETE FROM qingmu_outbox WHERE operation_id = ?', command.operationId);
      database.execSync('COMMIT');
    } catch (error) {
      database.execSync('ROLLBACK');
      throw error;
    }
  }

  function flush(send: (command: MobileQueuedCommand) => Promise<SyncResult>, memberId?: string): Promise<SyncResult[]> {
    const run = flushTail.then(() => flushOnce(send, memberId));
    flushTail = run.then(() => undefined, () => undefined);
    return run;
  }

  return {
    get,
    saveCompletion,
    flush,
    hasPendingCompletion,
    pendingCount: () => database.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM qingmu_outbox')?.count ?? 0,
    key,
  };
}

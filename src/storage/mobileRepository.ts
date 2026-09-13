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

export function createMobileRepository(database: MobileDatabase, options: MobileRepositoryOptions = {}) {
  const generateOperationId = options.generateOperationId ?? (() => `recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
      let revisionRetries = 0;
      let commandSettled = false;
      while (true) {
        const result = await send(command);
        results.push(result);
        if (result.ok) {
          confirmAuthoritative(command, result.revision, result.status);
          commandSettled = true;
          break;
        }

        if (result.conflict && (result.error === 'REVISION_CONFLICT' || result.error === 'OPERATION_REPLAY_STALE')) {
          if (result.status === command.desiredStatus) {
            confirmAuthoritative(command, result.revision, result.status);
            results[results.length - 1] = { ok: true, revision: result.revision, status: result.status, reconciledConflict: true };
            commandSettled = true;
            break;
          }
          if (result.error === 'OPERATION_REPLAY_STALE') {
            const rotated = { ...command, operationId: generateOperationId(), expectedRevision: result.revision };
            replacePendingOperation(command, rotated, result.revision, revisionRetries > 0 ? 'SAVE_FAILED' : 'PENDING_SAVE');
            command = rotated;
          } else {
            rebasePending(command, result.revision, revisionRetries > 0 ? 'SAVE_FAILED' : 'PENDING_SAVE');
            command = { ...command, expectedRevision: result.revision };
          }
          if (revisionRetries === 0) {
            revisionRetries += 1;
            continue;
          }
        }
        break;
      }
      if (!commandSettled) break;
    }
    return results;
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

  function rebasePending(command: MobileQueuedCommand, revision: number, syncStatus: CompletionRecord['syncStatus']): void {
    const rebased = JSON.stringify({ ...command, expectedRevision: revision });
    const current = get(command);
    const hasNewerIntent = !!current?.lastOperationId && current.lastOperationId !== command.operationId;
    const preservedStatus = hasNewerIntent ? current!.status : command.desiredStatus;
    const preservedPendingStatus = hasNewerIntent ? current!.pendingStatus : command.desiredStatus;
    const preservedOperationId = hasNewerIntent ? current!.lastOperationId : command.operationId;
    database.execSync('BEGIN IMMEDIATE');
    try {
      database.runSync(
        'UPDATE qingmu_completions SET revision = ?, status = ?, sync_status = ?, pending_status = ?, last_operation_id = ? WHERE member_id = ? AND plan_id = ? AND task_date = ?',
        revision,
        preservedStatus,
        syncStatus,
        preservedPendingStatus ?? null,
        preservedOperationId ?? command.operationId,
        command.memberId,
        command.planId,
        command.taskDate,
      );
      database.runSync('UPDATE qingmu_outbox SET command_json = ? WHERE operation_id = ?', rebased, command.operationId);
      database.execSync('COMMIT');
    } catch (error) {
      database.execSync('ROLLBACK');
      throw error;
    }
  }

  function replacePendingOperation(command: MobileQueuedCommand, replacement: MobileQueuedCommand, revision: number, syncStatus: CompletionRecord['syncStatus']): void {
    const current = get(command);
    const hasNewerIntent = !!current?.lastOperationId && current.lastOperationId !== command.operationId;
    const preservedStatus = hasNewerIntent ? current!.status : command.desiredStatus;
    const preservedPendingStatus = hasNewerIntent ? current!.pendingStatus : command.desiredStatus;
    const preservedOperationId = hasNewerIntent ? current!.lastOperationId : replacement.operationId;
    database.execSync('BEGIN IMMEDIATE');
    try {
      database.runSync(
        'UPDATE qingmu_completions SET revision = ?, status = ?, sync_status = ?, pending_status = ?, last_operation_id = ? WHERE member_id = ? AND plan_id = ? AND task_date = ?',
        revision,
        preservedStatus,
        syncStatus,
        preservedPendingStatus ?? null,
        preservedOperationId ?? replacement.operationId,
        command.memberId,
        command.planId,
        command.taskDate,
      );
      database.runSync('UPDATE qingmu_outbox SET operation_id = ?, command_json = ? WHERE operation_id = ?', replacement.operationId, JSON.stringify(replacement), command.operationId);
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
    pendingCount: () => database.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM qingmu_outbox')?.count ?? 0,
    key,
  };
}

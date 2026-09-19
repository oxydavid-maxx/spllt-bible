import type { MobileDatabase } from './mobileRepository';

/**
 * On-device storage for the devotional journal.
 *
 * This is a sibling of the completion repository, not an extension of it, and the separation is
 * deliberate. `flushOnce` in mobileRepository is the most safety-critical loop in the app: it reads
 * completion-specific result codes and carries a written invariant about never rotating an
 * operation id, because rotating one there could award or withdraw a point. Threading a second kind
 * of command through that loop would put the points ledger at risk for a feature that earns none.
 *
 * One rule differs from completions on purpose, and it is the reason for the separate queue. The
 * outbox here is keyed on `(member_id, task_date)` rather than on the operation id, so repeated
 * edits to the same day while offline coalesce into a single pending write instead of forty. That
 * makes rotating the operation id on coalesce both necessary and safe: a journal save moves no
 * ledger, its only content is the latest text, and writing the same text twice converges.
 */

export type JournalSyncStatus = 'CONFIRMED' | 'PENDING_SAVE' | 'SAVE_FAILED';

export interface JournalRecord {
  memberId: string;
  planId: string;
  taskDate: string;
  body: string;
  revision: number;
  syncStatus: JournalSyncStatus;
  updatedAt: string;
}

export interface JournalQueuedCommand {
  memberId: string;
  planId: string;
  taskDate: string;
  body: string;
  operationId: string;
  expectedRevision: number;
}

/** What the server said about one queued save. `CONFLICT` keeps the local text and stops retrying. */
export type JournalSyncResult =
  | { ok: true; revision: number; updatedAt: number }
  | { ok: false; outcome: 'CONFLICT'; revision: number }
  | { ok: false; outcome: 'RETRY' };

interface StoredJournal {
  member_id: string;
  plan_id: string;
  task_date: string;
  body: string;
  revision: number;
  sync_status: JournalSyncStatus;
  updated_at: string;
}

interface StoredQueued {
  member_id: string;
  plan_id: string;
  task_date: string;
  operation_id: string;
  command_json: string;
  created_at: string;
}

const toRecord = (row: StoredJournal): JournalRecord => ({
  memberId: row.member_id,
  planId: row.plan_id,
  taskDate: row.task_date,
  body: row.body,
  revision: row.revision,
  syncStatus: row.sync_status,
  updatedAt: row.updated_at,
});

export function createJournalStore(database: MobileDatabase) {
  database.execSync(`
    CREATE TABLE IF NOT EXISTS qingmu_journal_entries (
      member_id TEXT NOT NULL,
      task_date TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      body TEXT NOT NULL,
      revision INTEGER NOT NULL,
      sync_status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (member_id, task_date)
    );
    CREATE TABLE IF NOT EXISTS qingmu_journal_outbox (
      member_id TEXT NOT NULL,
      task_date TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      command_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (member_id, task_date)
    );
  `);

  /** A day nobody has written reads as blank at revision 0, matching the server and the reading card. */
  function get(key: { memberId: string; taskDate: string }): JournalRecord | null {
    const row = database.getFirstSync<StoredJournal>(
      'SELECT member_id, plan_id, task_date, body, revision, sync_status, updated_at FROM qingmu_journal_entries WHERE member_id = ? AND task_date = ?',
      key.memberId,
      key.taskDate,
    );
    return row ? toRecord(row) : null;
  }

  /** Write the text and its queued save in one transaction, so a crash cannot keep one without the other. */
  function save(command: JournalQueuedCommand, nowIso = new Date().toISOString()): JournalRecord {
    const current = get(command);
    const record: JournalRecord = {
      memberId: command.memberId,
      planId: command.planId,
      taskDate: command.taskDate,
      body: command.body,
      revision: current?.revision ?? 0,
      syncStatus: 'PENDING_SAVE',
      updatedAt: nowIso,
    };
    database.execSync('BEGIN IMMEDIATE');
    try {
      database.runSync(
        `INSERT INTO qingmu_journal_entries (member_id, task_date, plan_id, body, revision, sync_status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(member_id, task_date) DO UPDATE SET plan_id=excluded.plan_id, body=excluded.body,
           sync_status=excluded.sync_status, updated_at=excluded.updated_at`,
        record.memberId, record.taskDate, record.planId, record.body, record.revision, record.syncStatus, record.updatedAt,
      );
      // Coalescing: one pending save per day, always carrying the newest text and a fresh id.
      database.runSync(
        `INSERT INTO qingmu_journal_outbox (member_id, task_date, operation_id, command_json, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(member_id, task_date) DO UPDATE SET operation_id=excluded.operation_id,
           command_json=excluded.command_json, created_at=excluded.created_at`,
        command.memberId, command.taskDate, command.operationId,
        JSON.stringify({ ...command, expectedRevision: record.revision }), nowIso,
      );
      database.execSync('COMMIT');
    } catch (error) {
      database.execSync('ROLLBACK');
      throw error;
    }
    return record;
  }

  let flushTail: Promise<void> = Promise.resolve();

  async function flushOnce(send: (command: JournalQueuedCommand) => Promise<JournalSyncResult>, memberId: string): Promise<void> {
    const queued = database.getAllSync<StoredQueued>(
      'SELECT member_id, task_date, operation_id, command_json, created_at FROM qingmu_journal_outbox WHERE member_id = ? ORDER BY created_at, task_date',
      memberId,
    );
    for (const row of queued) {
      const command = JSON.parse(row.command_json) as JournalQueuedCommand;
      let result: JournalSyncResult;
      try {
        result = await send(command);
      } catch {
        return; // offline or unreachable: leave everything queued and try again later
      }
      if (result.ok) {
        // Only clear the queue entry we actually sent. An edit that landed while this request was in
        // flight has already replaced the operation id, and that newer intent must survive.
        database.execSync('BEGIN IMMEDIATE');
        try {
          database.runSync(
            'UPDATE qingmu_journal_entries SET revision = ?, sync_status = ? WHERE member_id = ? AND task_date = ?',
            result.revision, 'CONFIRMED', row.member_id, row.task_date,
          );
          database.runSync(
            'DELETE FROM qingmu_journal_outbox WHERE member_id = ? AND task_date = ? AND operation_id = ?',
            row.member_id, row.task_date, row.operation_id,
          );
          database.execSync('COMMIT');
        } catch (error) {
          database.execSync('ROLLBACK');
          throw error;
        }
        continue;
      }
      if (result.outcome === 'CONFLICT') {
        // Another device wrote this day. Keep what was typed here, stop retrying, and let the card
        // offer one explicit save-anyway. Nothing is overwritten without the member saying so.
        database.execSync('BEGIN IMMEDIATE');
        try {
          database.runSync(
            'UPDATE qingmu_journal_entries SET revision = ?, sync_status = ? WHERE member_id = ? AND task_date = ?',
            result.revision, 'SAVE_FAILED', row.member_id, row.task_date,
          );
          database.runSync(
            'DELETE FROM qingmu_journal_outbox WHERE member_id = ? AND task_date = ? AND operation_id = ?',
            row.member_id, row.task_date, row.operation_id,
          );
          database.execSync('COMMIT');
        } catch (error) {
          database.execSync('ROLLBACK');
          throw error;
        }
        continue;
      }
      return; // retryable: stop here so ordering is preserved
    }
  }

  /** Serialized so two flushes can never interleave, matching the completion repository. */
  function flush(send: (command: JournalQueuedCommand) => Promise<JournalSyncResult>, memberId: string): Promise<void> {
    const run = flushTail.then(() => flushOnce(send, memberId));
    flushTail = run.catch(() => undefined);
    return run;
  }

  function list(memberId: string): JournalRecord[] {
    return database
      .getAllSync<StoredJournal>(
        'SELECT member_id, plan_id, task_date, body, revision, sync_status, updated_at FROM qingmu_journal_entries WHERE member_id = ? AND body <> \'\' ORDER BY task_date DESC',
        memberId,
      )
      .map(toRecord);
  }

  function pendingCount(memberId: string): number {
    const row = database.getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM qingmu_journal_outbox WHERE member_id = ?',
      memberId,
    );
    return Number(row?.count ?? 0);
  }

  /** Adopt the server's copy for days this device has no unsent edit for. */
  function adoptRemote(memberId: string, entries: ReadonlyArray<{ taskDate: string; body: string; revision: number }>, planId: string, nowIso = new Date().toISOString()): void {
    for (const entry of entries) {
      const queued = database.getFirstSync<{ operation_id: string }>(
        'SELECT operation_id FROM qingmu_journal_outbox WHERE member_id = ? AND task_date = ?',
        memberId, entry.taskDate,
      );
      if (queued) continue; // local intent wins until it has been sent
      database.runSync(
        `INSERT INTO qingmu_journal_entries (member_id, task_date, plan_id, body, revision, sync_status, updated_at)
         VALUES (?, ?, ?, ?, ?, 'CONFIRMED', ?)
         ON CONFLICT(member_id, task_date) DO UPDATE SET body=excluded.body, revision=excluded.revision,
           sync_status='CONFIRMED', updated_at=excluded.updated_at`,
        memberId, entry.taskDate, planId, entry.body, entry.revision, nowIso,
      );
    }
  }

  return { get, save, flush, list, pendingCount, adoptRemote };
}

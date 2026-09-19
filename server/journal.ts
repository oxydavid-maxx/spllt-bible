import type { DatabaseSync } from 'node:sqlite';
import { isValidDateOnly } from '../src/domain/gamificationV1';
import { readMutationReceipt, transaction, writeMutationReceipt, type GamificationError } from './gamification';

/**
 * A member's own devotional journal.
 *
 * This lives in its own module, away from the gamification helpers, on purpose. A journal earns no
 * points and must never be joined into a score, a people list, or an audit view. Keeping the table
 * out of `ensureGamificationSchema` means a future query that wants to reach it has to add an import
 * here, which is a line a reviewer will see.
 *
 * Two rules hold everything else up:
 *
 *   1. Every function takes the CALLER's member id and nothing else. There is no parameter for
 *      "whose journal", so there is no code path to point at someone else and therefore nothing to
 *      guard. An administrator calling these functions reads their own page.
 *   2. The body never enters the bookkeeping tables. The mutation receipt stores the revision and
 *      the timestamp, never the text, because the receipt table is exactly where a future debugging
 *      or support tool would think to look.
 */

const MAX_BODY_LENGTH = 4000;
/** An export wants a year. Anything wider is a mistake or a scrape, not a member reading back. */
const MAX_RANGE_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface JournalEntry {
  taskDate: string;
  body: string;
  revision: number;
  updatedAt: number | null;
}

export interface JournalSaveCommand {
  operationId: string;
  expectedRevision: number;
  planId: string;
  body: string;
}

export function ensureJournalSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      member_id TEXT NOT NULL,
      task_date TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      body TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision > 0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_operation_id TEXT,
      PRIMARY KEY (member_id, task_date)
    );
    CREATE INDEX IF NOT EXISTS journal_entries_member_date ON journal_entries(member_id, task_date);
  `);
}

interface JournalRow {
  body: string;
  plan_id: string;
  revision: number;
  updated_at: number;
}

/**
 * A day nobody has written reads as an empty entry at revision 0, never as a 404.
 *
 * The reading card already treats "no record yet" as a blank at revision 0 rather than an error, and
 * a journal box that reports a failure simply because it is new would be both wrong and alarming.
 * Revision 0 is also what the first write sends as its expected revision, so the empty read and the
 * first write agree without a special case.
 */
export function getJournalEntry(db: DatabaseSync, memberId: string, taskDate: string): JournalEntry & { planId: string | null } | GamificationError {
  if (!isValidDateOnly(taskDate)) return { status: 400, code: 'INVALID_DATE' };
  ensureJournalSchema(db);
  const row = db
    .prepare('SELECT body, plan_id, revision, updated_at FROM journal_entries WHERE member_id = ? AND task_date = ?')
    .get(memberId, taskDate) as JournalRow | undefined;
  return row
    ? { taskDate, planId: row.plan_id, body: row.body, revision: row.revision, updatedAt: row.updated_at }
    : { taskDate, planId: null, body: '', revision: 0, updatedAt: null };
}

export function listJournalEntries(db: DatabaseSync, memberId: string, from: string, to: string): { entries: JournalEntry[] } | GamificationError {
  if (!isValidDateOnly(from) || !isValidDateOnly(to) || from > to) return { status: 400, code: 'INVALID_DATE_RANGE' };
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS > MAX_RANGE_DAYS) {
    return { status: 400, code: 'DATE_RANGE_TOO_LARGE' };
  }
  ensureJournalSchema(db);
  const rows = db
    .prepare('SELECT task_date, body, revision, updated_at FROM journal_entries WHERE member_id = ? AND task_date >= ? AND task_date <= ? ORDER BY task_date')
    .all(memberId, from, to) as Array<{ task_date: string; body: string; revision: number; updated_at: number }>;
  return {
    entries: rows.map((row) => ({ taskDate: row.task_date, body: row.body, revision: row.revision, updatedAt: row.updated_at })),
  };
}

/**
 * Save one day's entry.
 *
 * The conflict response deliberately carries only the revision, never the other device's text. The
 * client does not merge and does not silently overwrite: it keeps what the member typed, marks the
 * row unsynced, and offers one explicit "save anyway". Handing back the competing text here would
 * invite exactly the auto-overwrite this is meant to prevent.
 */
export function saveJournalEntry(
  db: DatabaseSync,
  memberId: string,
  taskDate: string,
  command: JournalSaveCommand,
  nowMs: number,
): Record<string, unknown> | GamificationError {
  if (!isValidDateOnly(taskDate)) return { status: 400, code: 'INVALID_DATE' };
  if (typeof command.operationId !== 'string' || !command.operationId.trim()) return { status: 400, code: 'INVALID_JOURNAL' };
  if (typeof command.body !== 'string' || typeof command.planId !== 'string' || !command.planId.trim()) return { status: 400, code: 'INVALID_JOURNAL' };
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0) return { status: 400, code: 'INVALID_JOURNAL' };
  if ([...command.body].length > MAX_BODY_LENGTH) return { status: 400, code: 'JOURNAL_TOO_LONG' };

  ensureJournalSchema(db);
  // The receipt is keyed on the caller plus the operation id, and its payload fingerprint covers the
  // body, so replaying the same save returns the same answer while reusing the id for different text
  // is reported as the mistake it is.
  const fingerprint = { scope: 'journal', taskDate, expectedRevision: command.expectedRevision, body: command.body };
  const receipt = readMutationReceipt(db, memberId, command.operationId, fingerprint);
  if (receipt && 'code' in receipt) return receipt;
  if (receipt) return receipt.result;

  return transaction(db, () => {
    const current = db
      .prepare('SELECT revision, created_at FROM journal_entries WHERE member_id = ? AND task_date = ?')
      .get(memberId, taskDate) as { revision: number; created_at: number } | undefined;
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== command.expectedRevision) {
      return { status: 409, code: 'JOURNAL_CHANGED', details: { revision: currentRevision } } satisfies GamificationError;
    }
    const revision = currentRevision + 1;
    db.prepare(`INSERT INTO journal_entries(member_id, task_date, plan_id, body, revision, created_at, updated_at, last_operation_id)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(member_id, task_date) DO UPDATE SET plan_id = excluded.plan_id, body = excluded.body,
        revision = excluded.revision, updated_at = excluded.updated_at, last_operation_id = excluded.last_operation_id`)
      .run(memberId, taskDate, command.planId, command.body, revision, current?.created_at ?? nowMs, nowMs, command.operationId);

    // Revision and timestamp only. The text stays in journal_entries and nowhere else.
    const result = { taskDate, revision, updatedAt: nowMs };
    writeMutationReceipt(db, memberId, command.operationId, 'JOURNAL_SAVE', fingerprint, 'journal', `${memberId}:${taskDate}`, result, nowMs);
    return result;
  });
}

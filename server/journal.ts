import type { DatabaseSync } from 'node:sqlite';
import { isValidDateOnly } from '../src/domain/gamificationV1';
import type { GamificationError } from './gamification';

/**
 * Read-only compatibility for 0.5.21's unused journal download.
 *
 * This lives in its own module, away from the gamification helpers, on purpose. A journal earns no
 * points and must never be joined into a score, a people list, or an audit view. Keeping the table
 * out of `ensureGamificationSchema` means a future query that wants to reach it has to add an import
 * here, which is a line a reviewer will see.
 *
 * journal.md「決定」: new writing never reaches this server. Keep the caller-only GET shape so
 * older installed apps can still open their journal page; retain any legacy data without deleting it.
 */

/** An export wants a year. Anything wider is a mistake or a scrape, not a member reading back. */
const MAX_RANGE_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface JournalEntry {
  taskDate: string;
  body: string;
  revision: number;
  updatedAt: number | null;
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

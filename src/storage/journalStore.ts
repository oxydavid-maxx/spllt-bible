import type { MobileDatabase } from './mobileRepository';

/** On-device journal only. See docs/features/journal.md「決定」: no network transport or outbox. */
export interface JournalRecord {
  memberId: string;
  planId: string;
  taskDate: string;
  body: string;
  updatedAt: string;
}

export interface JournalSaveCommand {
  memberId: string;
  planId: string;
  taskDate: string;
  body: string;
  /** Accepted from old local callers; never queued or sent. */
  operationId?: string;
  expectedRevision?: number;
}

interface StoredJournal {
  member_id: string;
  plan_id: string;
  task_date: string;
  body: string;
  updated_at: string;
}
const toRecord = (row: StoredJournal): JournalRecord => ({
  memberId: row.member_id, planId: row.plan_id, taskDate: row.task_date, body: row.body, updatedAt: row.updated_at,
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
    DROP TABLE IF EXISTS qingmu_journal_outbox;
  `);
  // Keep the old entry columns for an in-place upgrade; the writing and its saved time stay intact.
  database.runSync("UPDATE qingmu_journal_entries SET sync_status = 'CONFIRMED' WHERE sync_status <> 'CONFIRMED'");

  function get(key: { memberId: string; taskDate: string }): JournalRecord | null {
    const row = database.getFirstSync<StoredJournal>(
      'SELECT member_id, plan_id, task_date, body, updated_at FROM qingmu_journal_entries WHERE member_id = ? AND task_date = ?',
      key.memberId, key.taskDate,
    );
    return row ? toRecord(row) : null;
  }

  function save(command: JournalSaveCommand, nowIso = new Date().toISOString()): JournalRecord {
    const record: JournalRecord = { memberId: command.memberId, planId: command.planId, taskDate: command.taskDate, body: command.body, updatedAt: nowIso };
    database.runSync(
      `INSERT INTO qingmu_journal_entries (member_id, task_date, plan_id, body, revision, sync_status, updated_at)
       VALUES (?, ?, ?, ?, 0, 'CONFIRMED', ?)
       ON CONFLICT(member_id, task_date) DO UPDATE SET plan_id=excluded.plan_id, body=excluded.body,
         sync_status='CONFIRMED', updated_at=excluded.updated_at`,
      record.memberId, record.taskDate, record.planId, record.body, record.updatedAt,
    );
    return record;
  }

  function list(memberId: string): JournalRecord[] {
    return database.getAllSync<StoredJournal>(
      "SELECT member_id, plan_id, task_date, body, updated_at FROM qingmu_journal_entries WHERE member_id = ? AND body <> '' ORDER BY task_date DESC",
      memberId,
    ).map(toRecord);
  }
  return { get, save, list };
}

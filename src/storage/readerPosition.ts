import type { MobileDatabase } from './mobileRepository';

export interface ReaderPosition {
  memberId: string;
  planId: string;
  taskDate: string;
  versionId: number;
  book: string;
  chapter: string;
  reference: string;
  mode: 'ASSIGNED' | 'FREE_BROWSE';
  updatedAt: string;
}

interface StoredReaderPosition {
  member_id: string;
  plan_id: string;
  task_date: string;
  version_id: number;
  book: string;
  chapter: string;
  reference: string;
  mode: ReaderPosition['mode'];
  updated_at: string;
}

export function createReaderPositionStore(database: MobileDatabase) {
  database.execSync(`
    CREATE TABLE IF NOT EXISTS qingmu_reader_positions (
      member_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      task_date TEXT NOT NULL,
      version_id INTEGER NOT NULL,
      book TEXT NOT NULL,
      chapter TEXT NOT NULL,
      reference TEXT NOT NULL,
      mode TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (member_id, plan_id, task_date)
    );
  `);

  function get(memberId: string, planId: string, taskDate: string): ReaderPosition | undefined {
    const row = database.getFirstSync<StoredReaderPosition>(
      'SELECT member_id, plan_id, task_date, version_id, book, chapter, reference, mode, updated_at FROM qingmu_reader_positions WHERE member_id = ? AND plan_id = ? AND task_date = ?',
      memberId,
      planId,
      taskDate,
    );
    return row ? { memberId: row.member_id, planId: row.plan_id, taskDate: row.task_date, versionId: row.version_id, book: row.book, chapter: row.chapter, reference: row.reference, mode: row.mode, updatedAt: row.updated_at } : undefined;
  }

  function save(position: ReaderPosition): void {
    database.runSync(
      `INSERT INTO qingmu_reader_positions (member_id, plan_id, task_date, version_id, book, chapter, reference, mode, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(member_id, plan_id, task_date) DO UPDATE SET version_id=excluded.version_id, book=excluded.book, chapter=excluded.chapter, reference=excluded.reference, mode=excluded.mode, updated_at=excluded.updated_at`,
      position.memberId,
      position.planId,
      position.taskDate,
      position.versionId,
      position.book,
      position.chapter,
      position.reference,
      position.mode,
      position.updatedAt,
    );
  }

  function resetToAssigned(memberId: string, planId: string, taskDate: string, references: string[]): void {
    const reference = references[0];
    if (!reference) return;
    const [book = 'JHN', chapter = '1'] = reference.split('.').slice(-2);
    save({ memberId, planId, taskDate, versionId: 1392, book, chapter, reference, mode: 'ASSIGNED', updatedAt: new Date().toISOString() });
  }

  return { get, save, resetToAssigned };
}

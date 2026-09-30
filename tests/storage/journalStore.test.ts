import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createJournalStore } from '../../src/storage/journalStore';
import type { MobileDatabase } from '../../src/storage/mobileRepository';

function nodeDatabase(): { database: MobileDatabase; close: () => void } {
  const db = new DatabaseSync(':memory:');
  return {
    database: {
      execSync: source => db.exec(source),
      runSync: (source, ...params) => db.prepare(source).run(...(params as never[])),
      getFirstSync: <T,>(source: string, ...params: unknown[]) => (db.prepare(source).get(...(params as never[])) ?? null) as T | null,
      getAllSync: <T,>(source: string, ...params: unknown[]) => db.prepare(source).all(...(params as never[])) as T[],
    }, close: () => db.close(),
  };
}
const command = (body: string) => ({ memberId: 'member-self', planId: 'church-2026-09', taskDate: '2026-09-12', body });

describe('the journal stays on the phone (journal.md 決定)', () => {
  it('keeps writing after reopening without an upload queue or transport', () => {
    const { database, close } = nodeDatabase();
    const store = createJournalStore(database);
    store.save(command('第一次'));
    store.save(command('第二次'));
    const reopened = createJournalStore(database);
    expect(reopened.get(command(''))?.body).toBe('第二次');
    expect(reopened).not.toHaveProperty('flush');
    expect(database.getAllSync("SELECT name FROM sqlite_master WHERE name = 'qingmu_journal_outbox'")).toEqual([]);
    close();
  });

  it('migrates 0.5.21 pending and failed entries without losing text, identity or save time', () => {
    const { database, close } = nodeDatabase();
    database.execSync(`CREATE TABLE qingmu_journal_entries (member_id TEXT, task_date TEXT, plan_id TEXT, body TEXT, revision INTEGER, sync_status TEXT, updated_at TEXT, PRIMARY KEY(member_id, task_date));
      CREATE TABLE qingmu_journal_outbox (member_id TEXT, task_date TEXT, operation_id TEXT, command_json TEXT, created_at TEXT, PRIMARY KEY(member_id, task_date));`);
    for (const [date, status] of [['2026-09-12', 'PENDING_SAVE'], ['2026-09-13', 'SAVE_FAILED']]) {
      database.runSync('INSERT INTO qingmu_journal_entries VALUES (?, ?, ?, ?, ?, ?, ?)', 'member-self', date, 'church-2026-09', '手機裡原本的日記', 3, status, '2026-09-14T04:00:00Z');
      database.runSync('INSERT INTO qingmu_journal_outbox VALUES (?, ?, ?, ?, ?)', 'member-self', date, 'old-op', '{"body":"手機裡原本的日記"}', '2026-09-14T04:00:00Z');
    }
    const store = createJournalStore(database);
    for (const date of ['2026-09-12', '2026-09-13']) {
      expect(store.get({ memberId: 'member-self', taskDate: date })).toMatchObject({ body: '手機裡原本的日記', updatedAt: '2026-09-14T04:00:00Z' });
    }
    expect(store.list('member-self')).toHaveLength(2);
    expect(database.getAllSync("SELECT name FROM sqlite_master WHERE name = 'qingmu_journal_outbox'")).toEqual([]);
    close();
  });

  it('lists nonempty days newest first, only for the current account', () => {
    const { database, close } = nodeDatabase();
    const store = createJournalStore(database);
    store.save(command('第一天'));
    store.save({ ...command(''), taskDate: '2026-09-13' });
    store.save({ ...command('第三天'), taskDate: '2026-09-14' });
    store.save({ ...command('別人的'), memberId: 'member-other' });
    expect(store.list('member-self').map(entry => entry.taskDate)).toEqual(['2026-09-14', '2026-09-12']);
    expect(store.list('member-other').map(entry => entry.body)).toEqual(['別人的']);
    close();
  });
});

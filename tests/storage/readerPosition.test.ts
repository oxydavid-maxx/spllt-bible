import { describe, expect, it } from 'vitest';

import { createReaderPositionStore, type ReaderPosition } from '../../src/storage/readerPosition';

function fakeDatabase() {
  const rows = new Map<string, ReaderPosition>();
  return {
    execSync: () => undefined,
    getFirstSync: <T>(_source: string, memberId: string, planId: string, taskDate: string): T | null => {
      const row = rows.get(`${memberId}:${planId}:${taskDate}`);
      return row ? {
        member_id: row.memberId, plan_id: row.planId, task_date: row.taskDate, version_id: row.versionId,
        book: row.book, chapter: row.chapter, reference: row.reference, mode: row.mode, updated_at: row.updatedAt,
      } as T : null;
    },
    getAllSync: <T>() => [] as T[],
    runSync: (_source: string, ...params: unknown[]) => {
      const [memberId, planId, taskDate, versionId, book, chapter, reference, mode, updatedAt] = params as [string, string, string, number, string, string, string, ReaderPosition['mode'], string];
      rows.set(`${memberId}:${planId}:${taskDate}`, { memberId, planId, taskDate, versionId, book, chapter, reference, mode, updatedAt });
      return { changes: 1, lastInsertRowId: 1 };
    },
    __rows: rows,
  };
}

describe('reader position persistence', () => {
  it('stores only account-bound version/book/chapter/reference context', () => {
    const database = fakeDatabase();
    const store = createReaderPositionStore(database);
    const position: ReaderPosition = {
      memberId: 'member:one', planId: 'church-2026-09', taskDate: '2026-09-09',
      versionId: 1392, book: 'JHN', chapter: '19', reference: 'JHN.19', mode: 'FREE_BROWSE', updatedAt: 'now',
    };

    store.save(position);
    expect(store.get('member:one', 'church-2026-09', '2026-09-09')).toEqual(position);
    expect(store.get('member:other', 'church-2026-09', '2026-09-09')).toBeUndefined();
  });

  it('returns the selected canonical range without creating a completion', () => {
    const database = fakeDatabase();
    const store = createReaderPositionStore(database);
    store.resetToAssigned('member:one', 'church-2026-09', '2026-09-09', ['JHN.19', 'JHN.20']);
    expect(store.get('member:one', 'church-2026-09', '2026-09-09')).toMatchObject({ mode: 'ASSIGNED', reference: 'JHN.19' });
  });
});

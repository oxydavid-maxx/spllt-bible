import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createJournalStore, type JournalSyncResult } from '../../src/storage/journalStore';
import type { MobileDatabase } from '../../src/storage/mobileRepository';

// Real SQLite rather than a mock, same as tests/storage/mobileRepository.test.ts: the behaviour
// worth proving here is transactional, and a fake would prove nothing about it.
function nodeDatabase(): { database: MobileDatabase; close: () => void } {
  const db = new DatabaseSync(':memory:');
  return {
    database: {
      execSync: (source) => db.exec(source),
      runSync: (source, ...params) => db.prepare(source).run(...(params as never[])),
      getFirstSync: <T,>(source: string, ...params: unknown[]) => (db.prepare(source).get(...(params as never[])) ?? null) as T | null,
      getAllSync: <T,>(source: string, ...params: unknown[]) => db.prepare(source).all(...(params as never[])) as T[],
    },
    close: () => db.close(),
  };
}

const command = (body: string, operationId: string) => ({
  memberId: 'member-self', planId: 'church-2026-09', taskDate: '2026-09-12', body, operationId, expectedRevision: 0,
});

describe('a journal survives being typed offline', () => {
  it('keeps what was written when the store is reopened', () => {
    const first = nodeDatabase();
    createJournalStore(first.database).save(command('寫到一半就沒網路', 'op-1'));
    const reopened = createJournalStore(first.database);
    expect(reopened.get({ memberId: 'member-self', taskDate: '2026-09-12' })).toMatchObject({
      body: '寫到一半就沒網路', syncStatus: 'PENDING_SAVE', revision: 0,
    });
    first.close();
  });

  it('coalesces repeated edits of one day into a single pending save carrying the newest text', () => {
    const { database, close } = nodeDatabase();
    const store = createJournalStore(database);
    store.save(command('第一次', 'op-1'));
    store.save(command('第二次', 'op-2'));
    store.save(command('第三次', 'op-3'));

    expect(store.pendingCount('member-self')).toBe(1);
    const queued = database.getAllSync<{ operation_id: string; command_json: string }>('SELECT operation_id, command_json FROM qingmu_journal_outbox');
    expect(queued).toHaveLength(1);
    expect(queued[0].operation_id).toBe('op-3');
    expect(JSON.parse(queued[0].command_json).body).toBe('第三次');
    close();
  });

  it('confirms the server revision and clears the queue', async () => {
    const { database, close } = nodeDatabase();
    const store = createJournalStore(database);
    store.save(command('送出去', 'op-1'));

    await store.flush(async () => ({ ok: true, revision: 1, updatedAt: 1 }) as JournalSyncResult, 'member-self');

    expect(store.get({ memberId: 'member-self', taskDate: '2026-09-12' })).toMatchObject({ revision: 1, syncStatus: 'CONFIRMED' });
    expect(store.pendingCount('member-self')).toBe(0);
    close();
  });

  it('does not discard an edit made while the previous save was in flight', async () => {
    const { database, close } = nodeDatabase();
    const store = createJournalStore(database);
    store.save(command('舊的', 'op-1'));

    await store.flush(async () => {
      // The member keeps typing while the request is out, so the queue entry is replaced.
      store.save(command('新的', 'op-2'));
      return { ok: true, revision: 1, updatedAt: 1 } as JournalSyncResult;
    }, 'member-self');

    expect(store.pendingCount('member-self')).toBe(1);
    expect(store.get({ memberId: 'member-self', taskDate: '2026-09-12' })?.body).toBe('新的');
    close();
  });

  it('keeps the local text and stops retrying when another device already wrote that day', async () => {
    const { database, close } = nodeDatabase();
    const store = createJournalStore(database);
    store.save(command('我在這台寫的', 'op-1'));

    await store.flush(async () => ({ ok: false, outcome: 'CONFLICT', revision: 4 }) as JournalSyncResult, 'member-self');

    expect(store.get({ memberId: 'member-self', taskDate: '2026-09-12' })).toMatchObject({
      body: '我在這台寫的', syncStatus: 'SAVE_FAILED', revision: 4,
    });
    expect(store.pendingCount('member-self')).toBe(0);
    close();
  });

  it('leaves the save queued when the network is unreachable', async () => {
    const { database, close } = nodeDatabase();
    const store = createJournalStore(database);
    store.save(command('等網路', 'op-1'));

    await store.flush(async () => { throw new Error('offline'); }, 'member-self');

    expect(store.pendingCount('member-self')).toBe(1);
    expect(store.get({ memberId: 'member-self', taskDate: '2026-09-12' })?.syncStatus).toBe('PENDING_SAVE');
    close();
  });

  it('never lets a downloaded copy overwrite an unsent local edit', () => {
    const { database, close } = nodeDatabase();
    const store = createJournalStore(database);
    store.save(command('本機還沒送出的', 'op-1'));

    store.adoptRemote('member-self', [{ taskDate: '2026-09-12', body: '伺服器上的舊版', revision: 9 }], 'church-2026-09');

    expect(store.get({ memberId: 'member-self', taskDate: '2026-09-12' })?.body).toBe('本機還沒送出的');
    close();
  });

  it('lists only days with something written, newest first, for the journal tab', () => {
    const { database, close } = nodeDatabase();
    const store = createJournalStore(database);
    store.save({ ...command('第一天', 'op-1'), taskDate: '2026-09-12' });
    store.save({ ...command('', 'op-2'), taskDate: '2026-09-13' });
    store.save({ ...command('第三天', 'op-3'), taskDate: '2026-09-14' });

    expect(store.list('member-self').map((entry) => entry.taskDate)).toEqual(['2026-09-14', '2026-09-12']);
    close();
  });
});

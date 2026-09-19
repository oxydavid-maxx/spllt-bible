import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { createJournalApiClient } from '../../src/services/journalApiClient';
import { createJournalStore } from '../../src/storage/journalStore';
import type { MobileDatabase } from '../../src/storage/mobileRepository';

// Store, transport and server driven together. Each of the three has its own unit tests; what this
// adds is the agreement between them — that a save written offline reaches the real handler, comes
// back confirmed, and that a genuine conflict is reported as a conflict rather than a retry loop.

const databases: Array<{ close: () => void }> = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function deviceDatabase(): MobileDatabase {
  const db = new DatabaseSync(':memory:');
  databases.push({ close: () => db.close() });
  return {
    execSync: (source) => db.exec(source),
    runSync: (source, ...params) => db.prepare(source).run(...(params as never[])),
    getFirstSync: <T,>(source: string, ...params: unknown[]) => (db.prepare(source).get(...(params as never[])) ?? null) as T | null,
    getAllSync: <T,>(source: string, ...params: unknown[]) => db.prepare(source).all(...(params as never[])) as T[],
  };
}

/** Routes the client's fetch straight into the handler, so no HTTP server is needed. */
function handlerFetch(api: ReturnType<typeof createApiHandler>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const response = await api({
      method: init?.method ?? 'GET',
      url: url.replace('http://device.test', ''),
      headers: init?.headers as Record<string, string>,
      body: init?.body as string | undefined,
    });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
    } as Response;
  }) as typeof fetch;
}

function setup() {
  const server = createDatabase({ members: [{ id: 'member-self', displayName: '小明', groupId: 'g' }] });
  databases.push(server);
  const api = createApiHandler({ db: server, fixtureToken: 'test-token', now: () => new Date('2026-09-14T04:00:00.000Z') });
  const client = createJournalApiClient({
    baseUrl: 'http://device.test',
    token: 'test-token',
    memberId: 'member-self',
    fetchImpl: handlerFetch(api),
  });
  return { server, api, client, store: createJournalStore(deviceDatabase()) };
}

const command = (body: string, operationId: string) => ({
  memberId: 'member-self', planId: 'church-2026-09', taskDate: '2026-09-12', body, operationId, expectedRevision: 0,
});

describe('what is typed offline reaches the server and comes back confirmed', () => {
  it('flushes a queued entry through the real handler', async () => {
    const { client, store } = setup();
    store.save(command('今天讀到安靜', 'op-1'));

    await store.flush(client.saveEntry, 'member-self');

    expect(store.get({ memberId: 'member-self', taskDate: '2026-09-12' })).toMatchObject({ revision: 1, syncStatus: 'CONFIRMED' });
    expect(store.pendingCount('member-self')).toBe(0);
    expect(await client.getEntry('2026-09-12')).toMatchObject({ body: '今天讀到安靜', revision: 1 });
  });

  it('reports a real conflict as a conflict, so the retry loop ends and the member is told', async () => {
    const { client, store } = setup();
    store.save(command('這台寫的', 'op-1'));
    await store.flush(client.saveEntry, 'member-self');

    // Another device advances the day to revision 2 while this one still believes it is at 1.
    await client.saveEntry({ ...command('別台寫的', 'op-2'), expectedRevision: 1 });

    const stale = await client.saveEntry({ ...command('過期的意圖', 'op-3'), expectedRevision: 1 });
    expect(stale).toEqual({ ok: false, outcome: 'CONFLICT', revision: 2 });
  });

  it('reads a day nobody has written as a blank entry rather than a failure', async () => {
    const { client } = setup();
    expect(await client.getEntry('2026-09-11')).toMatchObject({ body: '', revision: 0, updatedAt: null });
  });

  it('lists a range in date order for the journal tab and for export', async () => {
    const { client, store } = setup();
    store.save({ ...command('第一天', 'op-1'), taskDate: '2026-09-12' });
    store.save({ ...command('第二天', 'op-2'), taskDate: '2026-09-13' });
    await store.flush(client.saveEntry, 'member-self');

    const listed = await client.listEntries('2026-09-01', '2026-09-30');
    expect(listed?.map((entry) => [entry.taskDate, entry.body])).toEqual([
      ['2026-09-12', '第一天'],
      ['2026-09-13', '第二天'],
    ]);
  });
});

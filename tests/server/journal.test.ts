import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

const databases: Array<{ close: () => void }> = [];
afterEach(() => databases.splice(0).forEach(database => database.close()));
function setup() {
  const database = createDatabase({ members: [
    { id: 'member-self', displayName: '自己', groupId: 'g' },
    { id: 'member-admin', displayName: '管理員', groupId: 'g' },
  ] });
  databases.push(database);
  const api = createApiHandler({ db: database, fixtureToken: 'test-token', adminMemberIds: ['member-admin'], now: () => new Date('2026-09-30T04:00:00Z') });
  const headers = (memberId = 'member-self') => ({ authorization: 'Bearer test-token', 'x-qingmu-member-id': memberId });
  return { database, api, headers };
}

describe('the retired journal API keeps 0.5.21 readable without accepting private content', () => {
  it('returns the empty list and empty day the old app expects', async () => {
    const { api, headers } = setup();
    const list = await api({ method: 'GET', url: '/api/me/journal?from=2026-09-01&to=2026-09-30', headers: headers() });
    expect(list).toMatchObject({ status: 200, body: { entries: [] } });
    const day = await api({ method: 'GET', url: '/api/me/journal/2026-09-12', headers: headers() });
    expect(day).toMatchObject({ status: 200, body: { body: '', revision: 0, updatedAt: null } });
  });

  it('refuses PUT before reading or persisting its body (journal.md 決定)', async () => {
    const { database, api, headers } = setup();
    const response = await api({ method: 'PUT', url: '/api/me/journal/2026-09-12', headers: headers(), body: JSON.stringify({ operationId: 'old-op', expectedRevision: 0, planId: 'church-2026-09', body: '不能送進教會伺服器的私人內容' }) });
    expect(response.status).toBe(405);
    expect(response.body).toMatchObject({ error: { code: 'JOURNAL_LOCAL_ONLY' } });
    for (const table of ['journal_entries', 'mutation_receipts', 'operations']) {
      expect(JSON.stringify(database.db.prepare(`SELECT * FROM ${table}`).all())).not.toContain('不能送進教會伺服器的私人內容');
    }
    expect(database.db.prepare('SELECT count(*) AS n FROM journal_entries').get()).toMatchObject({ n: 0 });
  });

  it('keeps legacy stored records readable only by their owner and never overwrites them', async () => {
    const { database, api, headers } = setup();
    database.db.prepare('INSERT INTO journal_entries VALUES(?,?,?,?,?,?,?,?)').run('member-self', '2026-09-12', 'church-2026-09', '舊資料仍保留', 1, 1, 1, null);
    const self = await api({ method: 'GET', url: '/api/me/journal/2026-09-12', headers: headers() });
    expect(self).toMatchObject({ status: 200, body: { body: '舊資料仍保留' } });
    const admin = await api({ method: 'GET', url: '/api/me/journal/2026-09-12', headers: headers('member-admin') });
    expect(admin).toMatchObject({ status: 200, body: { body: '' } });
    expect((await api({ method: 'GET', url: '/api/me/journal?from=2020-01-01&to=2026-09-30', headers: headers() })).status).toBe(400);
    expect((await api({ method: 'GET', url: '/api/me/journal/not-a-date', headers: headers() })).status).toBe(400);
  });
});

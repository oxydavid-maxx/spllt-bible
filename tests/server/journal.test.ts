import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

// The journal is the one thing in this app a young person writes for nobody but themselves.
// These tests exist to make that structural rather than aspirational: there is no route shaped
// like "someone else's journal", the bodies never reach the bookkeeping tables, and an
// administrator has exactly the same access as anyone else, which is none.

const databases: Array<{ close: () => void }> = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function setup() {
  const database = createDatabase({
    members: [
      { id: 'member-self', displayName: '小明', groupId: 'unassigned:member-self' },
      { id: 'member-friend', displayName: '小華', groupId: 'unassigned:member-friend' },
      { id: 'member-admin', displayName: '光佑', groupId: 'unassigned:member-admin' },
    ],
  });
  databases.push(database);
  const api = createApiHandler({
    db: database,
    fixtureToken: 'test-token',
    adminMemberIds: ['member-admin'],
    now: () => new Date('2026-09-14T04:00:00.000Z'),
  });
  const headers = (memberId: string) => ({ authorization: 'Bearer test-token', 'x-qingmu-member-id': memberId });
  return { database, api, headers };
}

const write = (api: ReturnType<typeof setup>['api'], headers: ReturnType<typeof setup>['headers'], memberId: string, taskDate: string, body: string, expectedRevision = 0, operationId = randomUUID()) =>
  api({
    method: 'PUT',
    url: `/api/me/journal/${taskDate}`,
    headers: headers(memberId),
    body: JSON.stringify({ operationId, expectedRevision, planId: 'church-2026-09', body }),
  });

describe('a journal entry belongs to the one person who wrote it', () => {
  it('reads a day nobody has written as empty rather than missing', async () => {
    const { api, headers } = setup();
    const response = await api({ method: 'GET', url: '/api/me/journal/2026-09-12', headers: headers('member-self') });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ taskDate: '2026-09-12', body: '', revision: 0, updatedAt: null });
  });

  it('writes, reads back, and refuses a stale revision without disclosing the newer text', async () => {
    const { api, headers } = setup();
    const first = await write(api, headers, 'member-self', '2026-09-12', '今天讀到安靜');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ taskDate: '2026-09-12', revision: 1 });

    const read = await api({ method: 'GET', url: '/api/me/journal/2026-09-12', headers: headers('member-self') });
    expect(read.body).toMatchObject({ body: '今天讀到安靜', revision: 1 });

    const stale = await write(api, headers, 'member-self', '2026-09-12', '另一台裝置寫的', 0);
    expect(stale.status).toBe(409);
    expect(JSON.stringify(stale.body)).not.toContain('今天讀到安靜');
  });

  it('treats a replayed operation id as the same write, and a changed body under it as a mistake', async () => {
    const { api, headers } = setup();
    const operationId = randomUUID();
    const first = await write(api, headers, 'member-self', '2026-09-12', '一樣的內容', 0, operationId);
    const replay = await write(api, headers, 'member-self', '2026-09-12', '一樣的內容', 0, operationId);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);

    const reused = await write(api, headers, 'member-self', '2026-09-12', '不一樣的內容', 0, operationId);
    expect(reused.status).toBe(409);
    expect(JSON.stringify(reused.body)).toContain('OPERATION_ID_REUSED');
  });

  it('refuses an entry longer than a day of writing could reasonably be', async () => {
    const { api, headers } = setup();
    const tooLong = await write(api, headers, 'member-self', '2026-09-12', 'あ'.repeat(4001));
    expect(tooLong.status).toBe(400);
    expect(JSON.stringify(tooLong.body)).toContain('JOURNAL_TOO_LONG');
  });

  it('gives an administrator their own empty page, never the member they administer', async () => {
    const { api, headers } = setup();
    await write(api, headers, 'member-self', '2026-09-12', '只有我看得到');

    const asAdmin = await api({ method: 'GET', url: '/api/me/journal/2026-09-12', headers: headers('member-admin') });
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body).toMatchObject({ body: '', revision: 0 });

    const asFriend = await api({ method: 'GET', url: '/api/me/journal/2026-09-12', headers: headers('member-friend') });
    expect(asFriend.body).toMatchObject({ body: '', revision: 0 });
  });

  it('has no route shaped like another member, for anyone, including an administrator', async () => {
    const { api, headers } = setup();
    await write(api, headers, 'member-self', '2026-09-12', '只有我看得到');

    for (const url of [
      '/api/admin/journal/member-self',
      '/api/admin/journal',
      '/api/me/journal/2026-09-12?memberId=member-self',
      '/api/points/journal/member-self',
    ]) {
      const response = await api({ method: 'GET', url, headers: headers('member-admin') });
      expect(JSON.stringify(response.body)).not.toContain('只有我看得到');
    }
  });

  it('keeps the text out of the bookkeeping tables, which is where a debugging tool would look', async () => {
    const { database, api, headers } = setup();
    await write(api, headers, 'member-self', '2026-09-12', '一句很容易被 grep 到的話');

    for (const table of ['mutation_receipts', 'operations']) {
      const rows = database.db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
      expect(JSON.stringify(rows)).not.toContain('一句很容易被 grep 到的話');
    }
  });

  it('lists a range for export and refuses a range wider than the feature needs', async () => {
    const { api, headers } = setup();
    await write(api, headers, 'member-self', '2026-09-12', '第一天');
    await write(api, headers, 'member-self', '2026-09-13', '第二天');

    const listed = await api({ method: 'GET', url: '/api/me/journal?from=2026-09-01&to=2026-09-30', headers: headers('member-self') });
    expect(listed.status).toBe(200);
    expect((listed.body as { entries: Array<{ taskDate: string; body: string }> }).entries).toEqual([
      { taskDate: '2026-09-12', body: '第一天', revision: 1, updatedAt: expect.any(Number) },
      { taskDate: '2026-09-13', body: '第二天', revision: 1, updatedAt: expect.any(Number) },
    ]);

    const tooWide = await api({ method: 'GET', url: '/api/me/journal?from=2020-01-01&to=2026-09-30', headers: headers('member-self') });
    expect(tooWide.status).toBe(400);
    expect(JSON.stringify(tooWide.body)).toContain('DATE_RANGE_TOO_LARGE');
  });

  it('lists only the caller, even when two members wrote on the same day', async () => {
    const { api, headers } = setup();
    await write(api, headers, 'member-self', '2026-09-12', '我的');
    await write(api, headers, 'member-friend', '2026-09-12', '別人的');

    const mine = await api({ method: 'GET', url: '/api/me/journal?from=2026-09-01&to=2026-09-30', headers: headers('member-self') });
    expect(JSON.stringify(mine.body)).toContain('我的');
    expect(JSON.stringify(mine.body)).not.toContain('別人的');
  });
});

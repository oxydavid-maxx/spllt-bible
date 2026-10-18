import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

// 青少/主堂 (維護者 2026-10-17): every member belongs to one of them. Members from before keep 青少 and are never
// asked; a new member chooses once and can change it later. 青少 numbers count 青少 only, 主堂 counts the whole
// church, and only 青少 has the group prizes.
const databases: Array<{ close(): void }> = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function setup(ids: string[]) {
  const db = createDatabase({ members: ids.map((id) => ({ id, displayName: `測試${id}`, groupId: 'g' })) });
  databases.push(db);
  const api = createApiHandler({ db, fixtureToken: 'fixture', now: () => new Date('2026-10-17T04:00:00Z') });
  const as = (memberId: string) => ({ authorization: 'Bearer fixture', 'x-qingmu-member-id': memberId });
  const read = (memberId: string) => api({ method: 'GET', url: '/api/me/congregation', headers: as(memberId) });
  const choose = (memberId: string, congregation: unknown) => api({ method: 'PUT', url: '/api/me/congregation', headers: { ...as(memberId), 'content-type': 'application/json' }, body: JSON.stringify({ congregation }) });
  const group = (memberId: string) => api({ method: 'GET', url: '/api/points/group?month=2026-10', headers: as(memberId) });
  const read10 = (memberId: string, date: string) => db.db.prepare("INSERT INTO completions VALUES(?, 'plan', ?, 'COMPLETED', 1, 'CONFIRMED', ?)").run(memberId, date, `op-${memberId}-${date}`);
  return { db, api, read, choose, group, read10 };
}

describe('青少/主堂 affiliation', () => {
  it('keeps every member from before as 青少 without asking, and asks a member who joins later', async () => {
    const f = setup(['old']);
    expect((await f.read('old')).body).toEqual({ congregation: 'youth' });
    f.db.db.prepare("INSERT INTO members(id, display_name, group_id) VALUES('new', '新人', 'unassigned:new')").run();
    expect((await f.read('new')).body).toEqual({ congregation: null });
  });

  it('saves the choice, lets it be changed, and refuses anything else', async () => {
    const f = setup(['a']);
    f.db.db.prepare("INSERT INTO members(id, display_name, group_id) VALUES('b', 'B', 'unassigned:b')").run();
    expect((await f.choose('b', 'main')).body).toEqual({ congregation: 'main' });
    expect((await f.read('b')).body).toEqual({ congregation: 'main' });
    expect((await f.choose('b', 'youth')).body).toEqual({ congregation: 'youth' });
    for (const bad of ['adult', '', null, 3]) expect((await f.choose('b', bad)).status).toBe(400);
    expect((await f.read('b')).body).toEqual({ congregation: 'youth' });
  });

  it('counts 青少 only for 青少, the whole church for 主堂, and gives the prizes to 青少 alone', async () => {
    const f = setup(['y1', 'y2', 'm1', 'm2']);
    await f.choose('m1', 'main'); await f.choose('m2', 'main');
    for (const id of ['y1', 'y2', 'm1', 'm2']) f.read10(id, '2026-10-16');
    const youth = (await f.group('y1')).body as { scope: string; yesterdayReaders: number | null; prizes: unknown[] };
    const main = (await f.group('m1')).body as { scope: string; yesterdayReaders: number | null; prizes: unknown[] };
    expect(youth).toMatchObject({ scope: 'youth', yesterdayReaders: 2 });
    expect(youth.prizes).toHaveLength(2);
    expect(main).toMatchObject({ scope: 'main', yesterdayReaders: 4, prizes: [] });
  });
});

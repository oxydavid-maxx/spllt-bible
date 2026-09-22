import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { ensureNominationSchema } from '../../server/rewardNominations';

// Students suggest what the prizes should be and vote on each other's ideas; a 輔導 turns one into a
// real reward. The point is ownership — wanting a prize you chose — so the nominator's name is
// shown. Everything else about a member stays as private as it was.

const databases: Array<{ close: () => void }> = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function setup() {
  const database = createDatabase({
    members: [
      { id: 'member-self', displayName: '小明', groupId: 'g' },
      { id: 'member-friend', displayName: '小華', groupId: 'g' },
      { id: 'member-admin', displayName: '光佑', groupId: 'g' },
    ],
  });
  databases.push(database);
  const api = createApiHandler({ db: database, fixtureToken: 'test-token', adminMemberIds: ['member-admin'], now: () => new Date('2026-09-14T04:00:00.000Z') });
  const headers = (memberId: string) => ({ authorization: 'Bearer test-token', 'x-qingmu-member-id': memberId });
  // Nominating happens inside a round now. These tests are about what happens inside one, so it is
  // opened directly; opening and closing rounds is covered in nominationRounds.test.ts.
  ensureNominationSchema(database.db);
  database.db.prepare(`INSERT INTO reward_nomination_rounds(round_id, title, opened_by, opened_at, closes_at, state)
    VALUES('round-1', '十月獎品', 'member-admin', 0, ?, 'OPEN')`).run(Date.parse('2026-09-30T16:00:00.000Z'));
  return { database, api, headers };
}

const nominate = (api: ReturnType<typeof setup>['api'], headers: ReturnType<typeof setup>['headers'], memberId: string, name: string, note?: string) =>
  api({ method: 'POST', url: '/api/rewards/nominations', headers: headers(memberId), body: JSON.stringify({ operationId: randomUUID(), name, note }) });

const list = (api: ReturnType<typeof setup>['api'], headers: ReturnType<typeof setup>['headers'], memberId: string) =>
  api({ method: 'GET', url: '/api/rewards/nominations', headers: headers(memberId) });

const items = (response: { body: unknown }) => (response.body as { nominations: Array<Record<string, unknown>> }).nominations;

describe('students propose the prizes and vote on them', () => {
  it('shows a nomination with its author, and marks the caller’s own', async () => {
    const { api, headers } = setup();
    const created = await nominate(api, headers, 'member-self', '電影票', '想跟朋友一起去');
    expect(created.status).toBe(201);

    const mine = items(await list(api, headers, 'member-self'))[0];
    expect(mine).toMatchObject({ name: '電影票', note: '想跟朋友一起去', displayName: '小明', status: 'OPEN', voteCount: 0, voted: false, mine: true });

    const theirs = items(await list(api, headers, 'member-friend'))[0];
    expect(theirs).toMatchObject({ displayName: '小明', mine: false });
  });

  // A name is deliberate; a member id is not. One is how you know whose idea it was, the other is a
  // handle into every other endpoint.
  it('never puts a member id or a voter list on the board', async () => {
    const { api, headers } = setup();
    await nominate(api, headers, 'member-self', '電影票');
    const entry = items(await list(api, headers, 'member-friend'))[0];
    expect(Object.keys(entry).sort()).toEqual(['createdAt', 'displayName', 'mine', 'name', 'nominationId', 'revision', 'status', 'voteCount', 'voted']);
    expect(JSON.stringify(entry)).not.toContain('member-self');
  });

  it('counts one vote per member however many times they tap', async () => {
    const { api, headers } = setup();
    const created = await nominate(api, headers, 'member-self', '電影票');
    const id = (created.body as { nominationId: string }).nominationId;

    await api({ method: 'PUT', url: `/api/rewards/nominations/${id}/vote`, headers: headers('member-friend') });
    const again = await api({ method: 'PUT', url: `/api/rewards/nominations/${id}/vote`, headers: headers('member-friend') });
    expect(again.body).toMatchObject({ voteCount: 1, voted: true });

    const removed = await api({ method: 'DELETE', url: `/api/rewards/nominations/${id}/vote`, headers: headers('member-friend') });
    expect(removed.body).toMatchObject({ voteCount: 0, voted: false });
  });

  // With one pilot user, any "someone else must vote first" rule would deadlock the feature on day
  // one, and a 輔導 approving their own suggestion is a perfectly ordinary way to add a prize.
  it('lets a 輔導 approve a nomination with no votes at all', async () => {
    const { api, headers } = setup();
    const created = await nominate(api, headers, 'member-self', '電影票');
    const id = (created.body as { nominationId: string }).nominationId;

    const approved = await api({
      method: 'POST', url: `/api/admin/rewards/nominations/${id}/approve`, headers: headers('member-admin'),
      body: JSON.stringify({ operationId: randomUUID(), expectedRevision: 1, costPoints: 40 }),
    });
    expect(approved.status).toBe(201);
    expect(approved.body).toMatchObject({ status: 'APPROVED' });

    const rewards = await api({ method: 'GET', url: '/api/rewards', headers: headers('member-self') });
    expect((rewards.body as { rewards: Array<{ name: string; costPoints: number }> }).rewards)
      .toEqual([expect.objectContaining({ name: '電影票', costPoints: 40 })]);
  });

  it('creates the reward exactly once when an approval is replayed', async () => {
    const { database, api, headers } = setup();
    const created = await nominate(api, headers, 'member-self', '電影票');
    const id = (created.body as { nominationId: string }).nominationId;
    const body = JSON.stringify({ operationId: randomUUID(), expectedRevision: 1, costPoints: 40 });

    const first = await api({ method: 'POST', url: `/api/admin/rewards/nominations/${id}/approve`, headers: headers('member-admin'), body });
    const replay = await api({ method: 'POST', url: `/api/admin/rewards/nominations/${id}/approve`, headers: headers('member-admin'), body });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM rewards').get()).toEqual({ count: 1 });
  });

  it('keeps a member out of the 輔導 decisions', async () => {
    const { api, headers } = setup();
    const created = await nominate(api, headers, 'member-self', '電影票');
    const id = (created.body as { nominationId: string }).nominationId;

    for (const action of ['approve', 'decline', 'remove']) {
      const response = await api({
        method: 'POST', url: `/api/admin/rewards/nominations/${id}/${action}`, headers: headers('member-friend'),
        body: JSON.stringify({ operationId: randomUUID(), expectedRevision: 1, costPoints: 40 }),
      });
      expect(response.status).toBe(403);
    }
  });

  // One idea each. Three made the board a wish list dump; one makes a vote worth casting, and makes
  // the person choose what they actually want.
  it('allows one idea per person per round', async () => {
    const { api, headers } = setup();
    expect((await nominate(api, headers, 'member-self', '一')).status).toBe(201);
    const second = await nominate(api, headers, 'member-self', '二');
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain('NOMINATION_LIMIT_REACHED');
  });

  it('hides a removed nomination from everyone, including its author', async () => {
    const { api, headers } = setup();
    const created = await nominate(api, headers, 'member-self', '不合適的東西');
    const id = (created.body as { nominationId: string }).nominationId;

    await api({
      method: 'POST', url: `/api/admin/rewards/nominations/${id}/remove`, headers: headers('member-admin'),
      body: JSON.stringify({ operationId: randomUUID(), expectedRevision: 1 }),
    });

    expect(items(await list(api, headers, 'member-self'))).toEqual([]);
    expect(items(await list(api, headers, 'member-friend'))).toEqual([]);
  });

  it('tells the author their idea was declined, without telling everybody else', async () => {
    const { api, headers } = setup();
    const created = await nominate(api, headers, 'member-self', '太貴的東西');
    const id = (created.body as { nominationId: string }).nominationId;

    await api({
      method: 'POST', url: `/api/admin/rewards/nominations/${id}/decline`, headers: headers('member-admin'),
      body: JSON.stringify({ operationId: randomUUID(), expectedRevision: 1 }),
    });

    expect(items(await list(api, headers, 'member-self'))[0]).toMatchObject({ status: 'DECLINED' });
    expect(items(await list(api, headers, 'member-friend'))).toEqual([]);
  });

  it('refuses a decision made against a nomination that has already moved on', async () => {
    const { api, headers } = setup();
    const created = await nominate(api, headers, 'member-self', '電影票');
    const id = (created.body as { nominationId: string }).nominationId;
    await api({
      method: 'POST', url: `/api/admin/rewards/nominations/${id}/decline`, headers: headers('member-admin'),
      body: JSON.stringify({ operationId: randomUUID(), expectedRevision: 1 }),
    });

    const stale = await api({
      method: 'POST', url: `/api/admin/rewards/nominations/${id}/approve`, headers: headers('member-admin'),
      body: JSON.stringify({ operationId: randomUUID(), expectedRevision: 1, costPoints: 40 }),
    });
    expect(stale.status).toBe(409);
    expect(JSON.stringify(stale.body)).toContain('NOMINATION_CHANGED');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { ensureNominationSchema } from '../../server/rewardNominations';

/**
 * The board runs as an election with a closing date rather than as a standing suggestion box.
 *
 * A deadline is what turns a wish list into a decision, and one idea each is what makes a vote worth
 * casting. Closing is derived from the date rather than from a job that has to run, so a round whose
 * date passed while the server was off is already in its deciding phase when anybody next looks.
 */

const databases: Array<{ close: () => void }> = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

const DEADLINE = Date.parse('2026-09-30T16:00:00.000Z');

function setup(nowIso = '2026-09-20T04:00:00.000Z') {
  let clock = new Date(nowIso);
  const database = createDatabase({
    members: [
      { id: 'member-self', displayName: '小明', groupId: 'g' },
      { id: 'member-friend', displayName: '小華', groupId: 'g' },
      { id: 'member-admin', displayName: '光佑', groupId: 'g' },
    ],
  });
  databases.push(database);
  const api = createApiHandler({ db: database, fixtureToken: 'test-token', adminMemberIds: ['member-admin'], now: () => clock });
  const headers = (memberId: string) => ({ authorization: 'Bearer test-token', 'x-qingmu-member-id': memberId });
  ensureNominationSchema(database.db);
  return { database, api, headers, travelTo: (iso: string) => { clock = new Date(iso); } };
}

type Api = ReturnType<typeof setup>['api'];
type Headers = ReturnType<typeof setup>['headers'];

const openRound = (api: Api, headers: Headers, closesAt = DEADLINE) =>
  api({ method: 'POST', url: '/api/admin/rewards/nomination-rounds', headers: headers('member-admin'), body: JSON.stringify({ operationId: randomUUID(), title: '十月獎品', closesAt }) });
const nominate = (api: Api, headers: Headers, memberId: string, name: string, note?: string) =>
  api({ method: 'POST', url: '/api/rewards/nominations', headers: headers(memberId), body: JSON.stringify({ operationId: randomUUID(), name, note }) });
const board = async (api: Api, headers: Headers, memberId: string) =>
  (await api({ method: 'GET', url: '/api/rewards/nominations', headers: headers(memberId) })).body as { round: { roundId: string; phase: string; closesAt: number } | null; nominations: Array<Record<string, unknown>> };
const vote = (api: Api, headers: Headers, memberId: string, nominationId: string) =>
  api({ method: 'PUT', url: `/api/rewards/nominations/${nominationId}/vote`, headers: headers(memberId) });

describe('a round has to be opened before anybody can suggest anything', () => {
  it('refuses a nomination when no round is running', async () => {
    const { api, headers } = setup();
    const attempt = await nominate(api, headers, 'member-self', '桌遊');
    expect(attempt.status).toBe(409);
    expect(JSON.stringify(attempt.body)).toContain('NO_OPEN_ROUND');
    expect((await board(api, headers, 'member-self')).round).toBeNull();
  });

  it('is a 輔導 job, not a member one', async () => {
    const { api, headers } = setup();
    const attempt = await api({ method: 'POST', url: '/api/admin/rewards/nomination-rounds', headers: headers('member-self'), body: JSON.stringify({ operationId: randomUUID(), closesAt: DEADLINE }) });
    expect(attempt.status).toBe(403);
  });

  it('refuses a round that closes in the past, which could never take a nomination', async () => {
    const { api, headers } = setup();
    const attempt = await openRound(api, headers, Date.parse('2026-09-01T00:00:00.000Z'));
    expect(attempt.status).toBe(400);
  });

  it('will not run two at once', async () => {
    const { api, headers } = setup();
    expect((await openRound(api, headers)).status).toBe(201);
    const second = await openRound(api, headers);
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain('ROUND_ALREADY_OPEN');
  });

  it('opens with the date and the phase the members will see', async () => {
    const { api, headers } = setup();
    await openRound(api, headers);
    const view = await board(api, headers, 'member-self');
    expect(view.round).toMatchObject({ phase: 'VOTING', closesAt: DEADLINE });
  });
});

describe('one each, and you may take yours back', () => {
  it('lets a member replace their idea by withdrawing it first', async () => {
    const { api, headers } = setup();
    await openRound(api, headers);
    const first = (await nominate(api, headers, 'member-self', '桌遊')).body as { nominationId: string };
    expect((await nominate(api, headers, 'member-self', '電影票')).status).toBe(409);

    const withdrawn = await api({ method: 'DELETE', url: `/api/rewards/nominations/${first.nominationId}`, headers: headers('member-self') });
    expect(withdrawn.status).toBe(200);
    expect((await nominate(api, headers, 'member-self', '電影票')).status).toBe(201);
  });

  it('refuses to let anybody withdraw an idea that is not theirs', async () => {
    const { api, headers } = setup();
    await openRound(api, headers);
    const mine = (await nominate(api, headers, 'member-self', '桌遊')).body as { nominationId: string };
    const attempt = await api({ method: 'DELETE', url: `/api/rewards/nominations/${mine.nominationId}`, headers: headers('member-friend') });
    // Not found rather than forbidden: whether it exists is not the caller's business either.
    expect(attempt.status).toBe(404);
  });

  it('takes a withdrawn idea off the board for everybody else', async () => {
    const { api, headers } = setup();
    await openRound(api, headers);
    const mine = (await nominate(api, headers, 'member-self', '桌遊')).body as { nominationId: string };
    await api({ method: 'DELETE', url: `/api/rewards/nominations/${mine.nominationId}`, headers: headers('member-self') });
    expect((await board(api, headers, 'member-friend')).nominations).toHaveLength(0);
    // And off its author's board too: they took it back, so it belongs in the history, not here.
    expect((await board(api, headers, 'member-self')).nominations).toHaveLength(0);
  });
});

describe('the date closes the voting, with nothing having to run', () => {
  it('stops a vote once the deadline has passed', async () => {
    const { api, headers, travelTo } = setup();
    await openRound(api, headers);
    const idea = (await nominate(api, headers, 'member-self', '桌遊')).body as { nominationId: string };
    expect((await vote(api, headers, 'member-friend', idea.nominationId)).status).toBe(200);

    travelTo('2026-10-01T04:00:00.000Z');
    const late = await vote(api, headers, 'member-admin', idea.nominationId);
    expect(late.status).toBe(409);
    expect(JSON.stringify(late.body)).toContain('VOTING_CLOSED');
  });

  it('moves to deciding by itself, even if nothing ran for a week', async () => {
    const { api, headers, travelTo } = setup();
    await openRound(api, headers);
    travelTo('2026-10-07T04:00:00.000Z');
    expect((await board(api, headers, 'member-self')).round).toMatchObject({ phase: 'DECIDING' });
  });

  it('takes no new nomination after the deadline', async () => {
    const { api, headers, travelTo } = setup();
    await openRound(api, headers);
    travelTo('2026-10-01T04:00:00.000Z');
    expect((await nominate(api, headers, 'member-self', '桌遊')).status).toBe(409);
  });

  it('still lets a 輔導 decide after voting has closed, which is the whole point', async () => {
    const { api, headers, travelTo } = setup();
    await openRound(api, headers);
    const idea = (await nominate(api, headers, 'member-self', '桌遊')).body as { nominationId: string; revision: number };
    travelTo('2026-10-01T04:00:00.000Z');
    const approved = await api({
      method: 'POST', url: `/api/admin/rewards/nominations/${idea.nominationId}/approve`, headers: headers('member-admin'),
      body: JSON.stringify({ operationId: randomUUID(), expectedRevision: idea.revision, costPoints: 250 }),
    });
    // 201: the approval created the reward, which is exactly what deciding after the close means.
    expect(approved.status).toBe(201);
  });
});

describe('what stays behind when a round is over', () => {
  it('keeps the result and the places, and not the whole ranking', async () => {
    const { api, headers, travelTo } = setup();
    await openRound(api, headers);
    const idea = (await nominate(api, headers, 'member-self', '桌遊')).body as { nominationId: string };
    await vote(api, headers, 'member-friend', idea.nominationId);
    travelTo('2026-10-01T04:00:00.000Z');
    const round = (await board(api, headers, 'member-self')).round!;
    await api({ method: 'POST', url: `/api/admin/rewards/nomination-rounds/${round.roundId}/close`, headers: headers('member-admin'), body: JSON.stringify({ operationId: randomUUID() }) });

    const history = (await api({ method: 'GET', url: '/api/rewards/nominations/history', headers: headers('member-friend') })).body as { rounds: Array<{ title: string; places: Array<Record<string, unknown>> }> };
    expect(history.rounds).toHaveLength(1);
    expect(history.rounds[0].title).toBe('十月獎品');
    expect(history.rounds[0].places[0]).toMatchObject({ name: '桌遊', displayName: '小明', voteCount: 1 });
    expect(JSON.stringify(history)).not.toContain('member-');
  });

  it('clears the banner once the round is closed', async () => {
    const { api, headers, travelTo } = setup();
    await openRound(api, headers);
    travelTo('2026-10-01T04:00:00.000Z');
    const round = (await board(api, headers, 'member-self')).round!;
    await api({ method: 'POST', url: `/api/admin/rewards/nomination-rounds/${round.roundId}/close`, headers: headers('member-admin'), body: JSON.stringify({ operationId: randomUUID() }) });
    expect((await board(api, headers, 'member-self')).round).toBeNull();
  });

  it('lets the next round start once the last one is finished', async () => {
    const { api, headers, travelTo } = setup();
    await openRound(api, headers);
    travelTo('2026-10-01T04:00:00.000Z');
    const round = (await board(api, headers, 'member-self')).round!;
    await api({ method: 'POST', url: `/api/admin/rewards/nomination-rounds/${round.roundId}/close`, headers: headers('member-admin'), body: JSON.stringify({ operationId: randomUUID() }) });
    expect((await openRound(api, headers, Date.parse('2026-10-31T16:00:00.000Z'))).status).toBe(201);
    // A new round is a clean slate: the person who used their one idea last time has one again.
    expect((await nominate(api, headers, 'member-self', '雞排')).status).toBe(201);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { ensureNominationSchema } from '../../server/rewardNominations';
import { createNominationAssistWorker } from '../../server/nominationAssist';

/**
 * The estimate as a member actually meets it: on the board, in points, next to somebody's idea.
 *
 * The number is a guess by a language model and the fourteen-year-old reading it does not know that,
 * so the two things that matter are that it never blocks the submission and that it can be repriced
 * by a 輔導 without anything being estimated again.
 */

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
  const api = createApiHandler({ db: database, fixtureToken: 'test-token', adminMemberIds: ['member-admin'], now: () => new Date('2026-09-20T04:00:00.000Z') });
  const headers = (memberId: string) => ({ authorization: 'Bearer test-token', 'x-qingmu-member-id': memberId });
  ensureNominationSchema(database.db);
  database.db.prepare(`INSERT INTO reward_nomination_rounds(round_id, title, opened_by, opened_at, closes_at, state)
    VALUES('round-1', '十月獎品', 'member-admin', 0, ?, 'OPEN')`).run(Date.parse('2026-09-30T16:00:00.000Z'));
  const priceMovieTicket = (points: number) =>
    database.db.prepare("INSERT INTO rewards(reward_id, name, cost_points, active, revision, created_at, updated_at, updated_by) VALUES('r-movie','電影票',?,1,1,0,0,'admin')").run(points);
  const reprice = (points: number) =>
    database.db.prepare("UPDATE rewards SET cost_points = ? WHERE reward_id = 'r-movie'").run(points);
  return { database, api, headers, priceMovieTicket, reprice };
}

type Setup = ReturnType<typeof setup>;
const nominate = (api: Setup['api'], headers: Setup['headers'], memberId: string, name: string, note?: string) =>
  api({ method: 'POST', url: '/api/rewards/nominations', headers: headers(memberId), body: JSON.stringify({ operationId: randomUUID(), name, note }) });
const board = async (api: Setup['api'], headers: Setup['headers'], memberId: string) =>
  (await api({ method: 'GET', url: '/api/rewards/nominations', headers: headers(memberId) })).body as { nominations: Array<Record<string, unknown>> };

const cliDouble = (answers: string[]) => {
  let index = 0;
  return { busy: () => false, invoke: vi.fn(async () => answers[index++] ?? 'OK') };
};

describe('submitting does not wait for a language model', () => {
  it('answers the phone before anything has been asked of the model', async () => {
    const { api, headers, database, priceMovieTicket } = setup();
    priceMovieTicket(75);
    const cli = cliDouble(['300']);
    // The worker exists and is not what the request path talks to.
    createNominationAssistWorker({ db: database.db, cli, now: () => new Date(0) });

    expect((await nominate(api, headers, 'member-self', '桌遊', '大家一起玩')).status).toBe(201);
    expect(cli.invoke).not.toHaveBeenCalled();
    // And the idea is on the board immediately, estimate or no estimate.
    expect((await board(api, headers, 'member-self')).nominations).toHaveLength(1);
  });

  it('shows a nomination the model never managed to price, exactly as it always did', async () => {
    const { api, headers, database, priceMovieTicket } = setup();
    priceMovieTicket(75);
    await nominate(api, headers, 'member-self', '一個願望');
    await createNominationAssistWorker({ db: database.db, cli: cliDouble(['這要看你想要什麼']), now: () => new Date(0) }).tick();

    const entry = (await board(api, headers, 'member-self')).nominations[0];
    // No estimate, no failure notice, no retry button. There is nothing useful to say.
    expect(entry.estimatedPoints).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain('FAIL');
  });
});

describe('the points follow the prize the group agreed on', () => {
  it('prices an estimate against the current 電影票', async () => {
    const { api, headers, database, priceMovieTicket } = setup();
    priceMovieTicket(75);
    await nominate(api, headers, 'member-self', '桌遊');
    await createNominationAssistWorker({ db: database.db, cli: cliDouble(['300']), now: () => new Date(0) }).tick();

    expect((await board(api, headers, 'member-self')).nominations[0].estimatedPoints).toBe(75);
  });

  it('moves every estimate when a 輔導 reprices, with no tick in between', async () => {
    const { api, headers, database, priceMovieTicket, reprice } = setup();
    priceMovieTicket(75);
    await nominate(api, headers, 'member-self', '桌遊');
    await createNominationAssistWorker({ db: database.db, cli: cliDouble(['300']), now: () => new Date(0) }).tick();
    expect((await board(api, headers, 'member-self')).nominations[0].estimatedPoints).toBe(75);

    // Nothing is re-estimated here. The stored fact is a price in 元; points are worked out on read.
    reprice(50);
    expect((await board(api, headers, 'member-self')).nominations[0].estimatedPoints).toBe(50);
  });

  it('says nothing rather than a number that reads as a refusal', async () => {
    const { api, headers, database, priceMovieTicket } = setup();
    priceMovieTicket(75);
    await nominate(api, headers, 'member-self', '一台腳踏車');
    await createNominationAssistWorker({ db: database.db, cli: cliDouble(['4000']), now: () => new Date(0) }).tick();
    expect((await board(api, headers, 'member-self')).nominations[0].estimatedPoints).toBeUndefined();
  });
});

describe('the rewrite belongs to whoever wrote the note', () => {
  async function withSuggestion() {
    const context = setup();
    context.priceMovieTicket(75);
    await nominate(context.api, context.headers, 'member-self', '桌遊', '桌遊');
    await createNominationAssistWorker({
      db: context.database.db, cli: cliDouble(['300', '大家聚會後可以一起玩的桌遊。']), now: () => new Date(0),
    }).tick();
    return context;
  }

  it('offers it to the author', async () => {
    const { api, headers } = await withSuggestion();
    expect((await board(api, headers, 'member-self')).nominations[0].noteSuggestion).toBe('大家聚會後可以一起玩的桌遊。');
  });

  it('does not show another member that somebody was corrected', async () => {
    const { api, headers } = await withSuggestion();
    expect(JSON.stringify(await board(api, headers, 'member-friend'))).not.toContain('大家聚會後');
  });

  it('does not show the 輔導 either, which is the version that would stop people writing', async () => {
    const { api, headers } = await withSuggestion();
    const asAdmin = await api({ method: 'GET', url: '/api/admin/rewards/nominations', headers: headers('member-admin') });
    expect(JSON.stringify(asAdmin.body)).not.toContain('大家聚會後');
  });

  it('replaces the note when the author takes it, and stops offering', async () => {
    const { api, headers } = await withSuggestion();
    const entry = (await board(api, headers, 'member-self')).nominations[0];
    const accepted = await api({
      method: 'POST', url: `/api/rewards/nominations/${entry.nominationId}/suggestion`,
      headers: headers('member-self'), body: JSON.stringify({ accept: true }),
    });
    expect(accepted.status).toBe(200);

    const after = (await board(api, headers, 'member-self')).nominations[0];
    expect(after.note).toBe('大家聚會後可以一起玩的桌遊。');
    expect(after.noteSuggestion).toBeUndefined();
  });

  it('keeps what the author wrote when they would rather not, and stops offering', async () => {
    const { api, headers } = await withSuggestion();
    const entry = (await board(api, headers, 'member-self')).nominations[0];
    await api({
      method: 'POST', url: `/api/rewards/nominations/${entry.nominationId}/suggestion`,
      headers: headers('member-self'), body: JSON.stringify({ accept: false }),
    });

    const after = (await board(api, headers, 'member-self')).nominations[0];
    // The model has no veto. Declining its rewrite costs the author nothing at all.
    expect(after.note).toBe('桌遊');
    expect(after.noteSuggestion).toBeUndefined();
  });

  it('is not somebody else’s to accept', async () => {
    const { api, headers } = await withSuggestion();
    const entry = (await board(api, headers, 'member-self')).nominations[0];
    const attempt = await api({
      method: 'POST', url: `/api/rewards/nominations/${entry.nominationId}/suggestion`,
      headers: headers('member-friend'), body: JSON.stringify({ accept: true }),
    });
    expect(attempt.status).toBe(404);
  });
});

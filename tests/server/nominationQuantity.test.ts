import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { ensureNominationSchema } from '../../server/rewardNominations';
import { createNominationAssistWorker, readAssist } from '../../server/nominationAssist';

/**
 * 打電動 was priced at 150 分 with nothing saying for how long, so ten minutes and a whole day cost
 * the same. A nomination now says 多少/多久 in the proposer's own words, the one estimate call reads
 * it, and when it cannot be priced the proposer is told why instead of being shown a guess.
 */

const databases: Array<{ close: () => void }> = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

const NOW = new Date('2026-09-20T04:00:00.000Z');

function setup(closesAt = Date.parse('2026-09-30T16:00:00.000Z')) {
  const database = createDatabase({
    members: [
      { id: 'member-self', displayName: '小明', groupId: 'g' },
      { id: 'member-friend', displayName: '小華', groupId: 'g' },
      { id: 'member-admin', displayName: '光佑', groupId: 'g' },
    ],
  });
  databases.push(database);
  let now = NOW;
  const api = createApiHandler({ db: database, fixtureToken: 'test-token', adminMemberIds: ['member-admin'], now: () => now });
  const headers = (memberId: string) => ({ authorization: 'Bearer test-token', 'x-qingmu-member-id': memberId });
  ensureNominationSchema(database.db);
  database.db.prepare(`INSERT INTO reward_nomination_rounds(round_id, title, opened_by, opened_at, closes_at, state)
    VALUES('round-1', '十月獎品', 'member-admin', 0, ?, 'OPEN')`).run(closesAt);
  database.db.prepare("INSERT INTO rewards(reward_id, name, cost_points, active, revision, created_at, updated_at, updated_by) VALUES('r-movie','電影票',75,1,1,0,0,'admin')").run();
  const nominate = (memberId: string, body: Record<string, unknown>) =>
    api({ method: 'POST', url: '/api/rewards/nominations', headers: headers(memberId), body: JSON.stringify({ operationId: randomUUID(), ...body }) });
  const board = async (memberId: string) =>
    (await api({ method: 'GET', url: '/api/rewards/nominations', headers: headers(memberId) })).body as { nominations: Array<Record<string, unknown>> };
  const editQuantity = (memberId: string, nominationId: string, quantity: unknown) =>
    api({ method: 'PATCH', url: `/api/rewards/nominations/${nominationId}/quantity`, headers: headers(memberId), body: JSON.stringify({ quantity }) });
  const cli = (answers: string[]) => {
    const prompts: string[] = [];
    let index = 0;
    return { prompts, busy: () => false, invoke: vi.fn(async (prompt: string) => { prompts.push(prompt); return answers[index++] ?? 'OK'; }) };
  };
  const tick = (double: ReturnType<typeof cli>) => createNominationAssistWorker({ db: database.db, cli: double, now: () => new Date(0) }).tick();
  return { database, api, headers, nominate, board, editQuantity, cli, tick, setNow: (value: Date) => { now = value; } };
}

describe('a nomination says how much or how long, in the proposer’s words', () => {
  it('stores the quantity and shows it on the board', async () => {
    const { nominate, board } = setup();
    expect((await nominate('member-self', { name: '珍奶', quantity: ' 1 杯 ' })).status).toBe(201);
    expect((await board('member-friend')).nominations[0]).toMatchObject({ name: '珍奶', quantity: '1 杯' });
  });

  it('still accepts an installed 0.5.17 app, which does not send a quantity', async () => {
    const { nominate, board, database } = setup();
    expect((await nominate('member-self', { name: '打電動' })).status).toBe(201);
    const entry = (await board('member-self')).nominations[0];
    expect(entry.quantity).toBeUndefined();
    expect((database.db.prepare('SELECT quantity FROM reward_nominations').get() as { quantity: string | null }).quantity).toBeNull();
  });

  it('refuses a blank or an overlong quantity', async () => {
    const { nominate } = setup();
    expect((await nominate('member-self', { name: '珍奶', quantity: '   ' })).status).toBe(400);
    expect((await nominate('member-self', { name: '珍奶', quantity: '一'.repeat(21) })).status).toBe(400);
    expect((await nominate('member-self', { name: '珍奶', quantity: 3 })).status).toBe(400);
  });
});

describe('the unit check rides on the one estimate call', () => {
  it('asks once, with the quantity in the prompt, and shows the points it priced', async () => {
    const { nominate, board, cli, tick } = setup();
    await nominate('member-self', { name: '珍奶', quantity: '1 杯' });
    const double = cli(['60']);
    await tick(double);
    expect(double.invoke).toHaveBeenCalledTimes(1);
    expect(double.prompts[0]).toContain('珍奶');
    expect(double.prompts[0]).toContain('1 杯');
    expect(double.prompts[0]).toContain('提醒');
    expect((await board('member-friend')).nominations[0].estimatedPoints).toBe(15);
  });

  it('keeps a reminder instead of a price, for the author alone, and shows no points to anybody', async () => {
    const { nominate, board, cli, tick, api, headers } = setup();
    await nominate('member-self', { name: '打電動', quantity: '很久' });
    const double = cli(['提醒：「很久」估不出分數，要不要寫多久？例如 1 小時']);
    await tick(double);
    expect(double.invoke).toHaveBeenCalledTimes(1);

    const mine = (await board('member-self')).nominations[0];
    expect(mine.estimatedPoints).toBeUndefined();
    expect(mine.quantityReminder).toBe('「很久」估不出分數，要不要寫多久？例如 1 小時');
    const theirs = (await board('member-friend')).nominations[0];
    expect(theirs.estimatedPoints).toBeUndefined();
    expect(JSON.stringify(theirs)).not.toContain('估不出');
    const asAdmin = await api({ method: 'GET', url: '/api/admin/rewards/nominations', headers: headers('member-admin') });
    expect(JSON.stringify(asAdmin.body)).not.toContain('估不出');
  });

  it('shows no points for a nomination without a quantity, even one the model already priced', async () => {
    const { nominate, board, database } = setup();
    await nominate('member-self', { name: '打電動', note: '想跟大家一起打' });
    const nominationId = String((await board('member-self')).nominations[0].nominationId);
    // Production today: the model guessed NT$600 before any quantity existed.
    database.db.prepare("INSERT INTO reward_nomination_assists(nomination_id, estimated_twd, state, attempts, requested_at) VALUES(?, 600, 'DONE', 1, 0)").run(nominationId);
    expect((await board('member-self')).nominations[0].estimatedPoints).toBeUndefined();
    expect((await board('member-friend')).nominations[0].estimatedPoints).toBeUndefined();
  });

  it('treats an answer that is neither a price nor a reminder as no answer at all', async () => {
    const { nominate, board, cli, tick, database } = setup();
    await nominate('member-self', { name: '珍奶', quantity: '1 杯' });
    await tick(cli(['這要看你在哪裡買，可能五十到八十元不等']));
    const entry = (await board('member-self')).nominations[0];
    expect(entry.estimatedPoints).toBeUndefined();
    expect(entry.quantityReminder).toBeUndefined();
    expect(readAssist(database.db, String(entry.nominationId))?.state).toBe('FAILED');
  });
});

describe('the author fixes the quantity while the round is voting', () => {
  async function remindedNomination() {
    const context = setup();
    await context.nominate('member-self', { name: '打電動', quantity: '很久', note: '想跟大家一起打' });
    await context.tick(context.cli(['提醒：「很久」估不出分數，要不要寫多久？例如 1 小時', 'OK']));
    const nominationId = String((await context.board('member-self')).nominations[0].nominationId);
    await context.api({ method: 'PUT', url: `/api/rewards/nominations/${nominationId}/vote`, headers: context.headers('member-friend') });
    return { ...context, nominationId };
  }

  it('keeps the votes, re-runs only the estimate once, and prices the new quantity', async () => {
    const { editQuantity, board, cli, tick, nominationId } = await remindedNomination();
    const edited = await editQuantity('member-self', nominationId, '1 小時');
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ nominationId, quantity: '1 小時' });

    const before = (await board('member-self')).nominations[0];
    expect(before).toMatchObject({ quantity: '1 小時', voteCount: 1 });
    expect(before.quantityReminder).toBeUndefined();

    const double = cli(['200']);
    await tick(double);
    await tick(double);
    // The note was already offered its rewrite once; a quantity edit does not ask about it again.
    expect(double.invoke).toHaveBeenCalledTimes(1);
    expect(double.prompts[0]).toContain('1 小時');
    expect((await board('member-friend')).nominations[0]).toMatchObject({ estimatedPoints: 50, voteCount: 1 });
  });

  it('does nothing when the same quantity is sent again, so a retried save does not re-ask the model', async () => {
    const { editQuantity, cli, tick, nominationId } = await remindedNomination();
    await editQuantity('member-self', nominationId, '1 小時');
    await tick(cli(['200']));
    expect((await editQuantity('member-self', nominationId, '1 小時')).status).toBe(200);
    const double = cli(['999']);
    await tick(double);
    expect(double.invoke).not.toHaveBeenCalled();
  });

  it('adds a quantity to an old nomination that never had one', async () => {
    const { nominate, board, editQuantity } = setup();
    await nominate('member-self', { name: '打電動' });
    const nominationId = String((await board('member-self')).nominations[0].nominationId);
    expect((await editQuantity('member-self', nominationId, '2 小時')).status).toBe(200);
    expect((await board('member-friend')).nominations[0].quantity).toBe('2 小時');
  });

  it('is the author’s alone, only while voting, and only with a real quantity', async () => {
    const { editQuantity, nominationId, setNow } = await remindedNomination();
    expect((await editQuantity('member-friend', nominationId, '1 小時')).status).toBe(404);
    expect((await editQuantity('member-self', nominationId, '')).status).toBe(400);
    expect((await editQuantity('member-self', nominationId, '一'.repeat(21))).status).toBe(400);
    setNow(new Date('2026-10-01T00:00:00.000Z'));
    expect((await editQuantity('member-self', nominationId, '1 小時')).status).toBe(409);
  });
});

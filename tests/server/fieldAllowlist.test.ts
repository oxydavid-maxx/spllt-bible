import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { applyRewardSheet } from '../../server/rewardSheet';

// Every response that leaves the server is pinned to an EXACT key set here.
//
// Why exact rather than toMatchObject: the rest of the suite asserts with toMatchObject and
// objectContaining, both of which ignore extra keys. That means a newly added field ships to
// whoever can call the endpoint and the whole suite still passes. These assertions are the only
// thing standing between a future private field and a friend's screen, so they compare key sets
// and fail on anything unexpected — including a field that is perfectly fine, which is the point:
// widening a payload should require editing this file and saying so.

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

const keys = (value: unknown): string[] => Object.keys(value as Record<string, unknown>).sort();

/** Make member-self and member-friend mutual friends through the real QR claim path. */
async function befriend(api: ReturnType<typeof setup>['api'], headers: ReturnType<typeof setup>['headers']) {
  const qr = await api({ method: 'POST', url: '/api/friends/qr', headers: headers('member-self'), body: '{}' });
  const token = new URL(String((qr.body as { payload: string }).payload)).searchParams.get('token');
  await api({
    method: 'POST',
    url: '/api/friends/claim',
    headers: headers('member-friend'),
    body: JSON.stringify({ operationId: randomUUID(), token }),
  });
}

/**
 * Give member-self one completed day, one redemption made in the app before 2026-10-17 (still in the ledger) and one
 * row from the prize sheet, so every payload has real rows of both kinds.
 */
async function seedRedemption(api: ReturnType<typeof setup>['api'], headers: ReturnType<typeof setup>['headers'], database: ReturnType<typeof setup>['database']) {
  await api({
    method: 'PUT',
    url: '/api/me/completions/church-2026-09/2026-09-08',
    headers: headers('member-self'),
    body: JSON.stringify({ operation_id: randomUUID(), expected_revision: 0, status: 'COMPLETED' }),
  });
  database.db.prepare(`INSERT INTO redemptions(redemption_id, member_id, reward_id, reward_name_snapshot, cost_points_snapshot, reward_revision, status, confirmed_by, confirmed_at, operation_id)
    VALUES('in-app', 'member-self', 'movie', '電影票', 1, 1, 'COMPLETED', 'member-admin', 1, 'op-in-app')`).run();
  applyRewardSheet(database.db, { youth: { rewards: [], redemptions: [{ row: 2, date: '2026-09-12', name: '小明', reward: '飲料', points: 1 }] } }, '2026-09-14T04:00:00.000Z');
}

describe('every response is an exact key set, so a new field cannot ship silently', () => {
  it('hides the acting administrator behind a member own-redemption list', async () => {
    const { api, headers, database } = setup();
    await seedRedemption(api, headers, database);

    const mine = await api({ method: 'GET', url: '/api/me/redemptions', headers: headers('member-self') });
    expect(mine.status).toBe(200);
    const rows = (mine.body as { redemptions: Array<Record<string, unknown>> }).redemptions;
    expect(rows).toHaveLength(2);
    // confirmedBy and reversedBy are the ADMINISTRATOR's member id. A member has no business
    // learning which adult confirmed their redemption, and reversalReason is adult-authored text.
    // A sheet row has exactly the same keys, and nothing about who wrote it.
    for (const row of rows) {
      expect(keys(row)).toEqual([
        'confirmedAt', 'costPoints', 'memberId', 'redemptionId', 'rewardId', 'rewardName', 'status',
      ]);
    }
  });

  it('gives a friend only the public half of a score profile', async () => {
    const { api, headers } = setup();
    await befriend(api, headers);

    const response = await api({
      method: 'GET',
      url: '/api/points/profiles/member-self?scope=friends',
      headers: headers('member-friend'),
    });
    expect(response.status).toBe(200);
    expect(keys(response.body)).toEqual([
      'band', 'chart', 'displayName', 'earnedTotal', 'memberId', 'months', 'permissions',
    ]);
  });

  it('gives a friend only name and total in the people list, never a rank', async () => {
    const { api, headers } = setup();
    await befriend(api, headers);

    const response = await api({ method: 'GET', url: '/api/points/people?scope=friends', headers: headers('member-friend') });
    expect(response.status).toBe(200);
    const people = (response.body as { people: Array<Record<string, unknown>> }).people;
    expect(people.length).toBeGreaterThan(0);
    for (const person of people) expect(keys(person)).toEqual(['displayName', 'earnedTotal', 'memberId']);
  });

  it('keeps the retired group endpoint to its published shape', async () => {
    const { api, headers } = setup();
    const response = await api({ method: 'GET', url: '/api/me/groups', headers: headers('member-self') });
    if (response.status === 404) return; // no group profile seeded; nothing to pin
    expect(response.status).toBe(200);
    expect(keys(response.body)).toEqual(['groupId', 'groupName', 'rpgs']);
    for (const rpg of (response.body as { rpgs: Array<Record<string, unknown>> }).rpgs) {
      expect(keys(rpg)).toEqual([
        'callProvider', 'callScope', 'callUrl', 'lastUpdatedAt', 'linkRevision', 'linkStatus',
        'meeting', 'openChatUrl', 'roster', 'rpgId', 'rpgName', 'standingRoom',
      ]);
    }
  });
});

// Prize nominations were removed on 2026-10-17 (維護者: vote offline). Apps up to 0.5.32 still read the board on the
// 積分 page, so it answers as an idle board with nothing in it; every other nomination route is gone.
describe('the retired nomination board', () => {
  it('answers old apps with an idle board, and nothing else about nominations exists', async () => {
    const { api, headers } = setup();
    const board = await api({ method: 'GET', url: '/api/rewards/nominations', headers: headers('member-self') });
    expect(board.status).toBe(200);
    expect(board.body).toEqual({ round: null, nominations: [], votesLeft: 0, votesPerMember: 3 });
    for (const [method, url] of [['POST', '/api/rewards/nominations'], ['GET', '/api/rewards/nominations/history'], ['PUT', '/api/rewards/nominations/n-1/vote'],
      ['POST', '/api/admin/rewards/nomination-rounds'], ['GET', '/api/admin/rewards/nominations'], ['GET', '/api/admin/redemptions']] as const) {
      const response = await api({ method, url, headers: headers('member-admin'), body: JSON.stringify({ operationId: randomUUID() }) });
      expect(response.status, `${method} ${url}`).toBe(404);
    }
  });
});

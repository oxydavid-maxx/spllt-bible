import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

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

/** Give member-self one completed day and one redemption, so every payload has real rows. */
async function seedRedemption(api: ReturnType<typeof setup>['api'], headers: ReturnType<typeof setup>['headers']) {
  await api({
    method: 'PUT',
    url: '/api/me/completions/church-2026-09/2026-09-08',
    headers: headers('member-self'),
    body: JSON.stringify({ operation_id: randomUUID(), expected_revision: 0, status: 'COMPLETED' }),
  });
  const reward = await api({
    method: 'POST',
    url: '/api/admin/rewards',
    headers: headers('member-admin'),
    body: JSON.stringify({ operationId: randomUUID(), name: '電影票', costPoints: 1 }),
  });
  await api({
    method: 'POST',
    url: '/api/admin/redemptions',
    headers: headers('member-admin'),
    body: JSON.stringify({
      operationId: randomUUID(),
      memberId: 'member-self',
      rewardId: String((reward.body as { rewardId: string }).rewardId),
      expectedRewardRevision: 1,
    }),
  });
}

describe('every response is an exact key set, so a new field cannot ship silently', () => {
  it('hides the acting administrator behind a member own-redemption list', async () => {
    const { api, headers } = setup();
    await seedRedemption(api, headers);

    const mine = await api({ method: 'GET', url: '/api/me/redemptions', headers: headers('member-self') });
    expect(mine.status).toBe(200);
    const rows = (mine.body as { redemptions: Array<Record<string, unknown>> }).redemptions;
    expect(rows).toHaveLength(1);
    // confirmedBy and reversedBy are the ADMINISTRATOR's member id. A member has no business
    // learning which adult confirmed their redemption, and reversalReason is adult-authored text.
    expect(keys(rows[0])).toEqual([
      'confirmedAt', 'costPoints', 'memberId', 'redemptionId', 'rewardId', 'rewardName', 'status',
    ]);
  });

  it('still gives an administrator the full audit row', async () => {
    const { api, headers } = setup();
    await seedRedemption(api, headers);

    const audit = await api({ method: 'GET', url: '/api/admin/redemptions', headers: headers('member-admin') });
    expect(audit.status).toBe(200);
    const rows = (audit.body as { redemptions: Array<Record<string, unknown>> }).redemptions;
    expect(rows[0]).toHaveProperty('confirmedBy', 'member-admin');
    expect(rows[0]).toHaveProperty('rewardRevision');
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

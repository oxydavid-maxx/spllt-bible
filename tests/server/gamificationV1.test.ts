import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../server/db';
import { seedReadingDays } from '../../server/gamification';
import { createApiHandler } from '../../server/routes';

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

describe('gamification v1 API', () => {
  it('returns scheduled reading days and enforces the completion window', async () => {
    const { api, headers } = setup();
    const response = await api({ method: 'GET', url: '/api/me/reading-days?from=2026-09-07&to=2026-09-15', headers: headers('member-self') });
    expect(response.status).toBe(200);
    expect(response.body.days).toEqual(expect.arrayContaining([expect.objectContaining({ taskDate: '2026-09-08', planId: 'church-2026-09' })]));
    const old = await api({
      method: 'PUT',
      url: '/api/me/completions/church-2026-09/2026-09-07',
      headers: headers('member-self'),
      body: JSON.stringify({ operation_id: randomUUID(), expected_revision: 0, status: 'COMPLETED' }),
    });
    expect(old.status).toBe(409);
    expect(old.body).toMatchObject({ error: { code: 'OUTSIDE_COMPLETION_WINDOW' } });
  });

  it('routes opaque legacy operation IDs through the single v1 writer with fixed one-point rules', async () => {
    const { api, database, headers } = setup();
    const policy = { version: 'legacy-rate-five', status: 'ACTIVE' as const, pointsPerCompletion: 5 };
    const configuredApi = createApiHandler({ db: database, fixtureToken: 'test-token', adminMemberIds: ['member-admin'], pointPolicy: policy, now: () => new Date('2026-09-14T04:00:00.000Z') });
    const complete = await configuredApi({ method: 'PUT', url: '/api/me/completions/church-2026-09/2026-09-08', headers: headers('member-self'), body: JSON.stringify({ operation_id: 'opaque-legacy-operation', expected_revision: 0, status: 'COMPLETED' }) });
    expect(complete.status).toBe(200);
    expect(complete.body).toMatchObject({ redeemableBalance: 1, earnedTotal: 1 });
    expect(database.db.prepare('SELECT amount FROM daily_point_entitlements WHERE member_id=? AND task_date=?').get('member-self', '2026-09-08')).toEqual({ amount: 1 });

    const reward = await configuredApi({ method: 'POST', url: '/api/admin/rewards', headers: headers('member-admin'), body: JSON.stringify({ operationId: randomUUID(), name: '飲料', costPoints: 1 }) });
    const redemption = await configuredApi({ method: 'POST', url: '/api/admin/redemptions', headers: headers('member-admin'), body: JSON.stringify({ operationId: randomUUID(), memberId: 'member-self', rewardId: reward.body.rewardId, expectedRewardRevision: 1 }) });
    expect(redemption.status).toBe(201);
    const spentUndo = await configuredApi({ method: 'PUT', url: '/api/me/completions/church-2026-09/2026-09-08', headers: headers('member-self'), body: JSON.stringify({ operation_id: 'opaque-legacy-undo', expected_revision: 1, status: 'NOT_COMPLETED' }) });
    expect(spentUndo.status).toBe(409);
    expect(spentUndo.body).toMatchObject({ error: { code: 'POINTS_ALREADY_SPENT' } });
    expect(database.db.prepare('SELECT status, revision FROM completions WHERE member_id=? AND plan_id=? AND task_date=?').get('member-self', 'church-2026-09', '2026-09-08')).toEqual({ status: 'COMPLETED', revision: 1 });

    const outside = await configuredApi({ method: 'PUT', url: '/api/me/completions/church-2026-09/2026-09-07', headers: headers('member-self'), body: JSON.stringify({ operation_id: 'opaque-too-old', expected_revision: 0, status: 'COMPLETED' }) });
    expect(outside.status).toBe(409);
    expect(outside.body).toMatchObject({ error: { code: 'OUTSIDE_COMPLETION_WINDOW' } });
    const crossPlan = await configuredApi({ method: 'PUT', url: '/api/me/completions/other-plan/2026-09-08', headers: headers('member-self'), body: JSON.stringify({ operation_id: 'opaque-cross-plan', expected_revision: 0, status: 'COMPLETED' }) });
    expect(crossPlan.status).toBe(409);
    expect(crossPlan.body).toMatchObject({ error: { code: 'UNSCHEDULED_DAY' } });
  });

  it('accepts higher revision reference corrections without changing earned entitlements', async () => {
    const database = createDatabase({ members: [{ id: 'member-self', displayName: '小明', groupId: 'unassigned:member-self' }], readingDays: [{ taskDate: '2026-10-01', planId: 'plan-oct', references: ['JHN.1'], sourceRevision: 1 }] });
    const api = createApiHandler({ db: database, fixtureToken: 'test-token', now: () => new Date('2026-10-01T04:00:00.000Z') });
    const headers = { authorization: 'Bearer test-token', 'x-qingmu-member-id': 'member-self' };
    seedReadingDays(database.db, [{ taskDate: '2026-10-01', planId: 'plan-oct', references: ['JHN.1', 'JHN.2'], sourceRevision: 2 }]);
    expect(database.db.prepare('SELECT references_json, source_revision FROM reading_days WHERE task_date=?').get('2026-10-01')).toEqual({ references_json: '["JHN.1","JHN.2"]', source_revision: 2 });
    const complete = await api({ method: 'PUT', url: '/api/me/completions/plan-oct/2026-10-01', headers, body: JSON.stringify({ operation_id: randomUUID(), expected_revision: 0, status: 'COMPLETED' }) });
    expect(complete.status).toBe(200);
    const earnedBefore = database.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS amount FROM daily_point_entitlements WHERE member_id=?').get('member-self');
    seedReadingDays(database.db, [{ taskDate: '2026-10-01', planId: 'plan-oct', references: ['JHN.1', 'JHN.2', 'JHN.3'], sourceRevision: 3 }]);
    expect(database.db.prepare('SELECT source_revision FROM reading_days WHERE task_date=?').get('2026-10-01')).toEqual({ source_revision: 3 });
    expect(database.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS amount FROM daily_point_entitlements WHERE member_id=?').get('member-self')).toEqual(earnedBefore);
    expect(() => seedReadingDays(database.db, [{ taskDate: '2026-10-01', planId: 'plan-oct', references: ['JHN.0'], sourceRevision: 2 }])).toThrow('READING_DAY_REVISION_CONFLICT');
    expect(() => seedReadingDays(database.db, [{ taskDate: '2026-10-01', planId: 'other-plan', references: ['JHN.4'], sourceRevision: 4 }])).toThrow('READING_DAY_PLAN_CONFLICT');
    database.close();
  });

  it('gives one daily entitlement, reverses it, and restores the same entitlement on re-completion', async () => {
    const { api, database, headers } = setup();
    const base = { method: 'PUT', url: '/api/me/completions/church-2026-09/2026-09-08', headers: headers('member-self') };
    const first = await api({ ...base, body: JSON.stringify({ operation_id: randomUUID(), expected_revision: 0, status: 'COMPLETED' }) });
    expect(first.status).toBe(200);
    const second = await api({ ...base, body: JSON.stringify({ operation_id: randomUUID(), expected_revision: 1, status: 'NOT_COMPLETED' }) });
    expect(second.status).toBe(200);
    const third = await api({ ...base, body: JSON.stringify({ operation_id: randomUUID(), expected_revision: 2, status: 'COMPLETED' }) });
    expect(third.status).toBe(200);
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM daily_point_entitlements WHERE member_id=? AND task_date=?').get('member-self', '2026-09-08')).toEqual({ count: 1 });
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM wallet_entries WHERE member_id=? AND task_date=?').get('member-self', '2026-09-08')).toEqual({ count: 3 });
    const profile = await api({ method: 'GET', url: '/api/points/profiles/member-self?anchorMonth=2026-09', headers: headers('member-self') });
    expect(profile.body).toMatchObject({ memberId: 'member-self', earnedTotal: 1, private: { redeemableBalance: 1 } });
  });

  it('replays a previously confirmed completion after the seven-day window closes', async () => {
    let clock = new Date('2026-09-14T04:00:00.000Z');
    const database = createDatabase({ members: [{ id: 'member-self', displayName: '小明', groupId: 'unassigned:member-self' }] });
    const api = createApiHandler({ db: database, fixtureToken: 'test-token', now: () => clock });
    const headers = { authorization: 'Bearer test-token', 'x-qingmu-member-id': 'member-self' };
    const operationId = randomUUID();
    const request = { method: 'PUT', url: '/api/me/completions/church-2026-09/2026-09-08', headers, body: JSON.stringify({ operation_id: operationId, expected_revision: 0, status: 'COMPLETED' }) };
    const first = await api(request);
    clock = new Date('2026-09-20T04:00:00.000Z');
    const replay = await api(request);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    database.close();
  });

  it('creates a bidirectional friendship through a QR claim and projects friend data without private fields', async () => {
    const { api, database, headers } = setup();
    const qr = await api({ method: 'POST', url: '/api/friends/qr', headers: headers('member-self'), body: '{}' });
    expect(qr.status).toBe(200);
    expect(qr.body.payload).toMatch(/^qingmu:\/\/friend\/add\?token=/);
    const token = new URL(String(qr.body.payload)).searchParams.get('token');
    const claimOperationId = randomUUID();
    const claim = await api({ method: 'POST', url: '/api/friends/claim', headers: headers('member-friend'), body: JSON.stringify({ operationId: claimOperationId, token }) });
    expect(claim.status).toBe(200);
    expect(claim.body).toMatchObject({ memberId: 'member-self' });
    expect(database.db.prepare('SELECT member_low, member_high FROM friendships').get()).toEqual({ member_low: 'member-friend', member_high: 'member-self' });
    const list = await api({ method: 'GET', url: '/api/points/people?scope=friends', headers: headers('member-friend') });
    expect(list.body.people).toEqual([expect.objectContaining({ memberId: 'member-self', displayName: '小明' })]);
    const profile = await api({ method: 'GET', url: '/api/points/profiles/member-self?anchorMonth=2026-09', headers: headers('member-friend') });
    expect(profile.status).toBe(200);
    expect(profile.body.private).toBeUndefined();
    const selfClaim = await api({ method: 'POST', url: '/api/friends/claim', headers: headers('member-self'), body: JSON.stringify({ operationId: randomUUID(), token }) });
    expect(selfClaim.status).toBe(409);
    expect(selfClaim.body).toMatchObject({ error: { code: 'SELF_FRIEND_NOT_ALLOWED' } });
    const removed = await api({ method: 'DELETE', url: '/api/friends/member-self', headers: headers('member-friend') });
    expect(removed).toMatchObject({ status: 200, body: { removed: true } });
    const replay = await api({ method: 'POST', url: '/api/friends/claim', headers: headers('member-friend'), body: JSON.stringify({ operationId: claimOperationId, token }) });
    expect(replay.status).toBe(200);
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM friendships').get()).toEqual({ count: 0 });
  });

  it('supports reward target, admin redemption idempotency, and one reversal', async () => {
    const { api, database, headers } = setup();
    const reward = await api({ method: 'POST', url: '/api/admin/rewards', headers: headers('member-admin'), body: JSON.stringify({ operationId: randomUUID(), name: '飲料', costPoints: 1 }) });
    expect(reward.status).toBe(201);
    const rewardId = String(reward.body.rewardId);
    const complete = await api({ method: 'PUT', url: '/api/me/completions/church-2026-09/2026-09-08', headers: headers('member-self'), body: JSON.stringify({ operation_id: randomUUID(), expected_revision: 0, status: 'COMPLETED' }) });
    expect(complete.status).toBe(200);
    const walletBeforeTarget = database.db.prepare('SELECT COALESCE(SUM(delta), 0) AS total FROM wallet_entries WHERE member_id=?').get('member-self');
    const target = await api({ method: 'PUT', url: '/api/me/reward-target', headers: headers('member-self'), body: JSON.stringify({ rewardId }) });
    expect(target.status).toBe(200);
    expect(database.db.prepare('SELECT COALESCE(SUM(delta), 0) AS total FROM wallet_entries WHERE member_id=?').get('member-self')).toEqual(walletBeforeTarget);
    const operationId = randomUUID();
    const redeemBody = { operationId, memberId: 'member-self', rewardId, expectedRewardRevision: 1 };
    const redeem = await api({ method: 'POST', url: '/api/admin/redemptions', headers: headers('member-admin'), body: JSON.stringify(redeemBody) });
    const replay = await api({ method: 'POST', url: '/api/admin/redemptions', headers: headers('member-admin'), body: JSON.stringify(redeemBody) });
    expect(redeem.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM redemptions').get()).toEqual({ count: 1 });
    const redemptionId = String(redeem.body.redemptionId);
    const reversed = await api({ method: 'POST', url: `/api/admin/redemptions/${redemptionId}/reverse`, headers: headers('member-admin'), body: JSON.stringify({ operationId: randomUUID(), reason: '現場更正' }) });
    const replayAfterReverse = await api({ method: 'POST', url: '/api/admin/redemptions', headers: headers('member-admin'), body: JSON.stringify(redeemBody) });
    const reversedAgain = await api({ method: 'POST', url: `/api/admin/redemptions/${redemptionId}/reverse`, headers: headers('member-admin'), body: JSON.stringify({ operationId: randomUUID(), reason: '重送' }) });
    expect(reversed.status).toBe(200);
    expect(replayAfterReverse.status).toBe(200);
    expect(replayAfterReverse.body).toMatchObject({ redemptionId, status: 'REVERSED', redeemableBalance: 1 });
    expect(reversedAgain.status).toBe(409);
    expect(reversedAgain.body).toMatchObject({ error: { code: 'REDEMPTION_ALREADY_REVERSED' } });
  });

  it('exposes all scores only to an admin after server-side authorization and assigns competitive ranks', async () => {
    const { api, headers } = setup();
    for (const [memberId, date] of [['member-self', '2026-09-08'], ['member-friend', '2026-09-09']] as const) {
      await api({ method: 'PUT', url: `/api/me/completions/church-2026-09/${date}`, headers: headers(memberId), body: JSON.stringify({ operation_id: randomUUID(), expected_revision: 0, status: 'COMPLETED' }) });
    }
    const forbidden = await api({ method: 'GET', url: '/api/points/people?scope=all', headers: headers('member-self') });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ error: { code: 'ADMIN_REQUIRED' } });
    const all = await api({ method: 'GET', url: '/api/points/people?scope=all', headers: headers('member-admin') });
    expect(all.status).toBe(200);
    expect(all.body.people).toEqual(expect.arrayContaining([expect.objectContaining({ memberId: 'member-self', rank: 1 }), expect.objectContaining({ memberId: 'member-friend', rank: 1 })]));
  });
});

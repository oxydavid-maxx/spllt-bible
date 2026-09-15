import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

const databases: Array<{ close: () => void }> = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

function setup(now = new Date('2026-01-01T16:30:00.000Z')) {
  const database = createDatabase({
    members: [
      { id: 'member-chart', displayName: '小明', groupId: 'unassigned:member-chart' },
      { id: 'member-friend', displayName: '小華', groupId: 'unassigned:member-friend' },
      { id: 'member-empty', displayName: '小空', groupId: 'unassigned:member-empty' },
    ],
  });
  databases.push(database);
  const api = createApiHandler({ db: database, fixtureToken: 'chart-token', now: () => now });
  const headers = (memberId: string) => ({ authorization: 'Bearer chart-token', 'x-qingmu-member-id': memberId });
  return { database, api, headers };
}

function entitlement(database: ReturnType<typeof setup>['database'], taskDate: string, amount: number, active = 1) {
  database.db.prepare(`INSERT INTO daily_point_entitlements
    (member_id, task_date, plan_id, amount, active, completion_revision, source_policy_version, first_awarded_at, updated_at, migration_id)
    VALUES (?, ?, 'chart-plan', ?, ?, 1, 'chart-v1', 1, 1, NULL)`).run('member-chart', taskDate, amount, active);
}

describe('score profile chart aggregation', () => {
  it('returns seven Taipei calendar days from Monday through Sunday across a year boundary', async () => {
    const { database, api, headers } = setup();
    entitlement(database, '2025-12-29', 1);
    entitlement(database, '2025-12-31', 2);
    entitlement(database, '2026-01-01', 3);
    entitlement(database, '2026-01-03', 9); // A stored active award remains visible even when its task date is later than today.

    const response = await api({ method: 'GET', url: '/api/points/profiles/member-chart?scope=me&anchorMonth=2026-01&chartRange=week&chartAnchor=2025-12-31', headers: headers('member-chart') });

    expect(response.status).toBe(200);
    const weekChart = (response.body as any).chart;
    expect(weekChart).toMatchObject({ range: 'week', anchor: '2025-12-29', periodStart: '2025-12-29', periodEnd: '2026-01-04', earnedPoints: 15, previousAnchor: '2025-12-22', nextAnchor: null });
    expect(weekChart.buckets).toEqual([
      { key: '2025-12-29', startDate: '2025-12-29', endDate: '2025-12-29', earnedPoints: 1 },
      { key: '2025-12-30', startDate: '2025-12-30', endDate: '2025-12-30', earnedPoints: 0 },
      { key: '2025-12-31', startDate: '2025-12-31', endDate: '2025-12-31', earnedPoints: 2 },
      { key: '2026-01-01', startDate: '2026-01-01', endDate: '2026-01-01', earnedPoints: 3 },
      { key: '2026-01-02', startDate: '2026-01-02', endDate: '2026-01-02', earnedPoints: 0 },
      { key: '2026-01-03', startDate: '2026-01-03', endDate: '2026-01-03', earnedPoints: 9 },
      { key: '2026-01-04', startDate: '2026-01-04', endDate: '2026-01-04', earnedPoints: 0 },
    ]);
  });

  it('returns daily month buckets, twelve year buckets, and all history by earned date', async () => {
    const { database, api, headers } = setup();
    entitlement(database, '2025-12-31', 2);
    entitlement(database, '2026-01-01', 3);
    entitlement(database, '2026-01-02', 4);
    entitlement(database, '2026-01-04', 4, 0);

    const defaultProfile = await api({ method: 'GET', url: '/api/points/profiles/member-chart?scope=me&anchorMonth=2026-01', headers: headers('member-chart') });
    expect((defaultProfile.body as any).chart).toMatchObject({ range: 'month', anchor: '2026-01' });

    const month = await api({ method: 'GET', url: '/api/points/profiles/member-chart?scope=me&anchorMonth=2026-01&chartRange=month&chartAnchor=2026-01', headers: headers('member-chart') });
    const monthChart = (month.body as any).chart;
    expect(monthChart).toMatchObject({ range: 'month', anchor: '2026-01', periodStart: '2026-01-01', periodEnd: '2026-01-31', earnedPoints: 7, previousAnchor: '2025-12', nextAnchor: null });
    expect(monthChart.buckets).toHaveLength(31);
    expect(monthChart.buckets.slice(0, 3).map((bucket: { key: string; earnedPoints: number }) => [bucket.key, bucket.earnedPoints])).toEqual([
      ['2026-01-01', 3], ['2026-01-02', 4], ['2026-01-03', 0],
    ]);

    const year = await api({ method: 'GET', url: '/api/points/profiles/member-chart?scope=me&anchorMonth=2026-01&chartRange=year&chartAnchor=2025', headers: headers('member-chart') });
    const yearChart = (year.body as any).chart;
    expect(yearChart).toMatchObject({ range: 'year', anchor: '2025', periodStart: '2025-01-01', periodEnd: '2025-12-31', earnedPoints: 2, previousAnchor: '2024', nextAnchor: '2026' });
    expect(yearChart.buckets).toHaveLength(12);
    expect(yearChart.buckets[11]).toMatchObject({ key: '2025-12', startDate: '2025-12-01', endDate: '2025-12-31', earnedPoints: 2 });

    const all = await api({ method: 'GET', url: '/api/points/profiles/member-chart?scope=me&anchorMonth=2026-01&chartRange=all', headers: headers('member-chart') });
    const allChart = (all.body as any).chart;
    expect(allChart).toMatchObject({ range: 'all', anchor: null, periodStart: '2025-12-31', periodEnd: '2026-01-02', earnedPoints: 9, previousAnchor: null, nextAnchor: null });
    expect(allChart.buckets).toEqual([
      { key: '2025', startDate: '2025-01-01', endDate: '2025-12-31', earnedPoints: 2 },
      { key: '2026', startDate: '2026-01-01', endDate: '2026-12-31', earnedPoints: 7 },
    ]);

    database.db.prepare(`INSERT INTO wallet_entries (entry_id, member_id, kind, delta, task_date, redemption_id, operation_id, created_at, migration_id)
      VALUES ('redemption-entry', 'member-chart', 'REDEMPTION_DEBIT', -5, NULL, 'redemption-1', 'operation-1', 2, NULL)`).run();
    const afterRedemption = await api({ method: 'GET', url: '/api/points/profiles/member-chart?scope=me&anchorMonth=2026-01&chartRange=year&chartAnchor=2026', headers: headers('member-chart') });
    expect((afterRedemption.body as any).chart.earnedPoints).toBe(7);

    const legacy = setup(new Date('2026-09-15T04:00:00.000Z'));
    entitlement(legacy.database, '2026-09-09', 1);
    entitlement(legacy.database, '2026-09-14', 1);
    entitlement(legacy.database, '2026-09-17', 1); // A real active legacy award can be future-dated relative to today.
    const legacyMonth = await legacy.api({ method: 'GET', url: '/api/points/profiles/member-chart?scope=me&anchorMonth=2026-09&chartRange=month&chartAnchor=2026-09', headers: legacy.headers('member-chart') });
    expect(legacyMonth.body).toMatchObject({ earnedTotal: 3 });
    expect((legacyMonth.body as any).chart).toMatchObject({ earnedPoints: 3 });
    legacy.database.db.prepare(`INSERT INTO wallet_entries (entry_id, member_id, kind, delta, task_date, redemption_id, operation_id, created_at, migration_id)
      VALUES ('legacy-opening-entry', 'member-chart', 'LEGACY_OPENING_CREDIT', 5, NULL, NULL, NULL, 1, 'legacy-migration')`).run();
    legacy.database.db.prepare(`INSERT INTO wallet_entries (entry_id, member_id, kind, delta, task_date, redemption_id, operation_id, created_at, migration_id)
      VALUES ('legacy-redemption-entry', 'member-chart', 'REDEMPTION_DEBIT', -2, NULL, 'legacy-redemption-1', 'legacy-operation-1', 2, NULL)`).run();
    const legacyAfterRedemption = await legacy.api({ method: 'GET', url: '/api/points/profiles/member-chart?scope=me&anchorMonth=2026-09&chartRange=all', headers: legacy.headers('member-chart') });
    expect(legacyAfterRedemption.body).toMatchObject({ earnedTotal: 3, private: { redeemableBalance: 3 } });
    expect((legacyAfterRedemption.body as any).chart).toMatchObject({ earnedPoints: 3 });
  });

  it('keeps an empty chart zero-only and strips private data for friends', async () => {
    const { database, api, headers } = setup();
    database.db.prepare(`INSERT INTO friendships (member_low, member_high, created_at, created_by, operation_id)
      VALUES ('member-chart', 'member-friend', 1, 'member-friend', 'friend-operation')`).run();

    const empty = await api({ method: 'GET', url: '/api/points/profiles/member-empty?scope=me&anchorMonth=2026-01&chartRange=month&chartAnchor=2026-01', headers: headers('member-empty') });
    const emptyChart = (empty.body as any).chart;
    expect(emptyChart.earnedPoints).toBe(0);
    expect(emptyChart.buckets).toHaveLength(31);
    expect(emptyChart.buckets.every((bucket: { earnedPoints: number }) => bucket.earnedPoints === 0)).toBe(true);

    const friend = await api({ method: 'GET', url: '/api/points/profiles/member-chart?scope=friends&anchorMonth=2026-01&chartRange=month&chartAnchor=2026-01', headers: headers('member-friend') });
    expect(friend.status).toBe(200);
    expect(friend.body.private).toBeUndefined();
    expect((friend.body as any).chart).toBeDefined();
    expect((friend.body as any).chart).not.toHaveProperty('redeemableBalance');
    expect((friend.body as any).chart).not.toHaveProperty('targetReward');
    expect(friend.body).not.toHaveProperty('rank');
  });

  it('rejects a future chart period', async () => {
    const { api, headers } = setup();
    const response = await api({ method: 'GET', url: '/api/points/profiles/member-chart?scope=me&anchorMonth=2026-01&chartRange=month&chartAnchor=2026-02', headers: headers('member-chart') });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'FUTURE_CHART_PERIOD' } });
  });

  it('rejects unsupported early years before any calendar loop runs', async () => {
    const { api, headers } = setup();
    for (const anchor of ['0000', '0001', '0099']) {
      const response = await api({ method: 'GET', url: `/api/points/profiles/member-chart?scope=me&anchorMonth=2026-01&chartRange=year&chartAnchor=${anchor}`, headers: headers('member-chart') });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'INVALID_CHART_ANCHOR' } });
    }
    for (const anchor of ['0001-01', '0099-12']) {
      const response = await api({ method: 'GET', url: `/api/points/profiles/member-chart?scope=me&anchorMonth=2026-01&chartRange=month&chartAnchor=${anchor}`, headers: headers('member-chart') });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { code: 'INVALID_CHART_ANCHOR' } });
    }
  });
});

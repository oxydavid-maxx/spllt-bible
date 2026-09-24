import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';
import { createApiClient } from '../../src/services/apiClient';
import { createMobileRepository, type MobileDatabase } from '../../src/storage/mobileRepository';

function mobileDatabase(): { node: DatabaseSync; mobile: MobileDatabase } {
  const node = new DatabaseSync(':memory:');
  return {
    node,
    mobile: {
      execSync: (source) => node.exec(source),
      runSync: (source, ...params) => node.prepare(source).run(...(params as never[])),
      getFirstSync: <T>(source: string, ...params: unknown[]) => node.prepare(source).get(...(params as never[])) as T | null,
      getAllSync: <T>(source: string, ...params: unknown[]) => node.prepare(source).all(...(params as never[])) as T[],
    },
  };
}

describe('completion to API to progress integration', () => {
  it('retries a durable local operation into the authoritative masked progress response', async () => {
    const database = createDatabase({
      members: [
        { id: 'fixture:self', displayName: '小明', groupId: 'G01' },
        { id: 'fixture:other', displayName: '王小明', groupId: 'G01' },
      ],
    });
    const api = createApiHandler({ db: database, fixtureToken: 'dev-only-test-token', now: () => new Date('2026-09-14T04:00:00.000Z') });
    const { node, mobile } = mobileDatabase();
    const local = createMobileRepository(mobile);
    const command = {
      memberId: 'fixture:self', planId: 'church-2026-09', taskDate: '2026-09-08', desiredStatus: 'COMPLETED' as const,
      operationId: 'integration-op-1', expectedRevision: 0, syncStatus: 'PENDING_SAVE' as const,
    };
    local.saveCompletion(command);

    const results = await local.flush(async (queued) => {
      const response = await api({
        method: 'PUT',
        url: `/api/me/completions/${queued.planId}/${queued.taskDate}`,
        headers: { authorization: 'Bearer dev-only-test-token', 'x-qingmu-member-id': queued.memberId },
        body: JSON.stringify({ operation_id: queued.operationId, expected_revision: queued.expectedRevision, status: queued.desiredStatus }),
      });
      if (response.status === 409) return { ok: false as const, conflict: true as const, revision: Number(response.body.revision), status: response.body.status as 'COMPLETED' };
      return {
        ok: true as const,
        operationId: String(response.body.operationId),
        pointsDelta: Number(response.body.pointsDelta),
        earnedTotal: Number(response.body.earnedTotal),
        redeemableBalance: Number(response.body.redeemableBalance),
        revision: Number(response.body.revision),
        status: response.body.status as 'COMPLETED',
      };
    });
    expect(results[0]).toMatchObject({ ok: true, operationId: 'integration-op-1', pointsDelta: 1, redeemableBalance: 1, revision: 1 });

    const progress = await api({
      method: 'GET',
      url: '/api/progress?date=2026-09-08',
      headers: { authorization: 'Bearer dev-only-test-token', 'x-qingmu-member-id': 'fixture:self' },
    });
    expect(progress.body.members).toEqual([
      { id: 'fixture:self', label: '小明', isSelf: true, status: 'COMPLETED' },
    ]);
    expect(progress.body.totalMembers).toBe(1);
    expect(JSON.stringify(progress.body)).not.toContain('王小明');
    expect(local.get(command)).toMatchObject({ status: 'COMPLETED', syncStatus: 'CONFIRMED', revision: 1 });
    expect(local.pendingCount()).toBe(0);
    node.close();
    database.close();
  });

  it('reconciles a stale replay response without reviving the old completion or duplicating points', async () => {
    const database = createDatabase({
      members: [
        { id: 'fixture:self', displayName: '小明', groupId: 'G01' },
        { id: 'fixture:other', displayName: '王小明', groupId: 'G01' },
      ],
    });
    const api = createApiHandler({
      db: database,
      fixtureToken: 'dev-only-test-token',
      pointPolicy: { version: 'fixture-week-v1', status: 'ACTIVE', pointsPerCompletion: 1 },
      scheduleDates: ['2026-09-08'],
      now: () => new Date('2026-09-14T04:00:00.000Z'),
    });
    const put = async (operationId: string, expectedRevision: number, status: 'COMPLETED' | 'NOT_COMPLETED') => api({
      method: 'PUT',
      url: '/api/me/completions/church-2026-09/2026-09-08',
      headers: { authorization: 'Bearer dev-only-test-token', 'x-qingmu-member-id': 'fixture:self' },
      body: JSON.stringify({ operation_id: operationId, expected_revision: expectedRevision, status }),
    });
    await put('op-a', 0, 'COMPLETED');
    await put('op-b', 1, 'NOT_COMPLETED');

    const { node, mobile } = mobileDatabase();
    const local = createMobileRepository(mobile, { generateOperationId: () => 'op-a-recovered' });
    mobile.runSync('INSERT INTO qingmu_completions (member_id, plan_id, task_date, status, revision, sync_status, pending_status, last_operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 'fixture:self', 'church-2026-09', '2026-09-08', 'COMPLETED', 1, 'CONFIRMED', null, 'op-a');
    local.saveCompletion({
      memberId: 'fixture:self', planId: 'church-2026-09', taskDate: '2026-09-08', desiredStatus: 'COMPLETED', operationId: 'op-a', expectedRevision: 1, syncStatus: 'PENDING_SAVE',
    });

    const sent: string[] = [];
    const client = createApiClient({
      baseUrl: 'http://fixture',
      token: 'dev-only-test-token',
      memberId: 'fixture:self',
      fetchImpl: async (input, init) => {
        const body = typeof init?.body === 'string' ? init.body : undefined;
        if (body) sent.push((JSON.parse(body) as { operation_id: string }).operation_id);
        const result = await api({
          method: init?.method ?? 'GET',
          url: String(input).replace('http://fixture', ''),
          headers: Object.fromEntries(Object.entries(init?.headers ?? {}).map(([key, value]) => [key, String(value)])),
          body,
        });
        return new Response(JSON.stringify(result.body), { status: result.status });
      },
    });
    const results = await local.flush((command) => client.saveCompletion(command));

    expect(sent).toEqual(['op-a']);
    expect(results.at(-1)).toMatchObject({ ok: false, error: 'OPERATION_REPLAY_STALE', reconciledConflict: true, revision: 2, status: 'NOT_COMPLETED' });
    expect(local.pendingCount()).toBe(0);
    expect(local.get({ memberId: 'fixture:self', planId: 'church-2026-09', taskDate: '2026-09-08' })).toMatchObject({ status: 'NOT_COMPLETED', revision: 2, syncStatus: 'CONFIRMED' });
    const progress = await api({
      method: 'GET',
      url: '/api/progress?date=2026-09-08',
      headers: { authorization: 'Bearer dev-only-test-token', 'x-qingmu-member-id': 'fixture:self' },
    });
    expect(progress.body).toMatchObject({ completed: 0, personal: { status: 'NOT_COMPLETED', revision: 2, points: 0 } });
    node.close();
    database.close();
  });
});

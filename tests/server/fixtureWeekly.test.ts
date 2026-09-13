import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

describe('controlled fixture weekly sync oracle', () => {
  it('uses two fictitious fixed members, two dates and four person-tasks', async () => {
    const db = createDatabase({
      members: [
        { id: 'fixture:self', displayName: '測試成員甲', groupId: 'FIXTURE-GROUP' },
        { id: 'fixture:other', displayName: '測試成員乙', groupId: 'FIXTURE-GROUP' },
      ],
    });
    const api = createApiHandler({
      db,
      fixtureToken: 'dev-fixture-token',
      scheduleDates: ['2026-09-07', '2026-09-08', '2026-09-09'],
      pointPolicy: { version: 'fixture-week-v1', status: 'ACTIVE', pointsPerCompletion: 1 },
    });
    const headers = { authorization: 'Bearer dev-fixture-token', 'x-qingmu-member-id': 'fixture:self' };
    const put = (operationId: string, expectedRevision: number, status: 'COMPLETED' | 'NOT_COMPLETED') => api({
      method: 'PUT',
      url: `/api/me/completions/church-2026-09/2026-09-08`,
      headers,
      body: JSON.stringify({ operation_id: operationId, expected_revision: expectedRevision, status }),
    });
    await put('fixture-e1', 0, 'COMPLETED');
    let progress = await api({ method: 'GET', url: '/api/progress?date=2026-09-08&period_start=2026-09-07&period_end=2026-09-08', headers });
    expect(progress.body.weekly).toMatchObject({ completed: 1, target: 4, personalCompleted: 1, points: 1 });
    await put('fixture-e2', 1, 'NOT_COMPLETED');
    progress = await api({ method: 'GET', url: '/api/progress?date=2026-09-08&period_start=2026-09-07&period_end=2026-09-08', headers });
    expect(progress.body.weekly).toMatchObject({ completed: 0, target: 4, personalCompleted: 0, points: 0 });
    await put('fixture-e3', 2, 'COMPLETED');
    progress = await api({ method: 'GET', url: '/api/progress?date=2026-09-08&period_start=2026-09-07&period_end=2026-09-08', headers });
    expect(progress.body.weekly).toMatchObject({ completed: 1, target: 4, personalCompleted: 1, points: 1 });
    const duplicate = await put('fixture-e3', 999, 'COMPLETED');
    expect(duplicate).toMatchObject({ status: 200, body: { revision: 3, points: 1 } });
    expect(JSON.stringify(progress.body)).not.toContain('測試成員乙');
    db.close();
  });
});

import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

describe('weekly reset and monthly personal accumulation', () => {
  it('keeps the month-to-date personal total while resetting the weekly denominator', async () => {
    const database = createDatabase({
      members: [
        { id: 'fixture:self', displayName: '測試成員甲', groupId: 'FIXTURE-GROUP' },
        { id: 'fixture:other', displayName: '測試成員乙', groupId: 'FIXTURE-GROUP' },
      ],
    });
    const policy = { version: 'fixture-week-v1', status: 'ACTIVE' as const, pointsPerCompletion: 1, sharedGoalTarget: 2 };
    const api = createApiHandler({
      db: database,
      fixtureToken: 'fixture-token',
      scheduleDates: ['2026-09-01', '2026-09-02', '2026-09-07', '2026-09-08'],
      pointPolicy: policy,
    });
    const headers = { authorization: 'Bearer fixture-token', 'x-qingmu-member-id': 'fixture:self' };
    const complete = (date: string, operationId: string) => api({
      method: 'PUT',
      url: `/api/me/completions/church-2026-09/${date}`,
      headers,
      body: JSON.stringify({ operation_id: operationId, expected_revision: 0, status: 'COMPLETED' }),
    });
    await complete('2026-09-01', 'month-1');
    await complete('2026-09-08', 'month-2');

    const response = await api({
      method: 'GET',
      url: '/api/progress?date=2026-09-08&period_start=2026-09-07&period_end=2026-09-08',
      headers,
    });

    expect(response.body.weekly).toMatchObject({
      periodStart: '2026-09-07',
      periodEnd: '2026-09-08',
      completed: 1,
      target: 4,
      personalCompleted: 1,
      points: 1,
      goalTarget: 2,
      goalAchieved: false,
      policyStatus: 'ACTIVE',
      pointsPerCompletion: 1,
    });
    expect(response.body.monthly).toMatchObject({
      periodStart: '2026-09-01',
      periodEnd: '2026-09-08',
      completed: 2,
      target: 8,
      personalCompleted: 2,
      points: 2,
      policyStatus: 'ACTIVE',
    });
    database.close();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

describe('progress API', () => {
  it('keeps the retired progress response scoped to the authenticated member', async () => {
    const db = createDatabase({
      members: [
        { id: 'google:self', displayName: '小明', groupId: 'A' },
        { id: 'google:other', displayName: '王小明', groupId: 'A' },
      ],
    });
    afterEach(() => db.close());
    const api = createApiHandler({ db, fixtureToken: 'test-token', now: () => new Date('2026-09-14T04:00:00.000Z') });
    const headers = {
      authorization: 'Bearer test-token',
      'x-qingmu-member-id': 'google:self',
    };

    await api({
      method: 'PUT',
      url: '/api/me/completions/church-2026-09/2026-09-08',
      headers,
      body: JSON.stringify({ operation_id: 'progress-op', expected_revision: 0, status: 'COMPLETED' }),
    });
    const response = await api({ method: 'GET', url: '/api/progress?date=2026-09-08', headers });
    const capabilities = await api({ method: 'GET', url: '/api/content-capabilities', headers });

    expect(response.status).toBe(200);
    expect(response.body.members).toEqual([
      { id: 'google:self', label: '小明', isSelf: true, status: 'COMPLETED' },
    ]);
    expect(response.body.totalMembers).toBe(1);
    expect(JSON.stringify(response.body)).not.toContain('王小明');
    expect(capabilities.body.status).toBe('C_PENDING_ACCESS');
  });
});

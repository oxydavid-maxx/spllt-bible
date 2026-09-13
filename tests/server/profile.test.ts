import { describe, expect, it } from 'vitest';

import { createDatabase } from '../../server/db';
import { createApiHandler } from '../../server/routes';

describe('authenticated member profile', () => {
  it('returns only the authenticated member profile and group context', async () => {
    const database = createDatabase({ members: [{ id: 'member:one', displayName: '小明', groupId: 'G01' }] });
    const api = createApiHandler({ db: database, fixtureToken: 'fixture-token' });

    const response = await api({
      method: 'GET',
      url: '/api/me/profile',
      headers: { authorization: 'Bearer fixture-token', 'x-qingmu-member-id': 'member:one' },
    });

    expect(response).toMatchObject({
      status: 200,
      body: { memberId: 'member:one', displayName: '小明', avatarUrl: null, groupId: 'G01' },
    });
    database.close();
  });
});

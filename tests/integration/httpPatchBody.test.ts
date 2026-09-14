import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../server/db';
import { createHttpServer } from '../../server/http';

describe('HTTP mutation body handling', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('passes a PATCH body through to the reward update route', async () => {
    vi.stubEnv('QINGMU_ADMIN_MEMBER_IDS', 'http-admin');
    const database = createDatabase({ members: [{ id: 'http-admin', displayName: 'HTTP Admin', groupId: 'isolated' }] });
    const backend = createHttpServer({ database, fixtureToken: 'http-fixture-token' });
    await new Promise<void>((resolve, reject) => {
      backend.server.once('listening', () => resolve());
      backend.server.once('error', reject);
      backend.server.listen(0, '127.0.0.1');
    });

    try {
      const address = backend.server.address();
      if (!address || typeof address === 'string') throw new Error('HTTP_TEST_ADDRESS_MISSING');
      const headers = { authorization: 'Bearer http-fixture-token', 'x-qingmu-member-id': 'http-admin', 'content-type': 'application/json' };
      const createdResponse = await fetch(`http://127.0.0.1:${address.port}/api/admin/rewards`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ operationId: '00000000-0000-4000-8000-000000000101', name: 'HTTP Test Reward', costPoints: 2 }),
      });
      expect(createdResponse.status).toBe(201);
      const created = await createdResponse.json() as { rewardId: string; revision: number };

      const updatedResponse = await fetch(`http://127.0.0.1:${address.port}/api/admin/rewards/${encodeURIComponent(created.rewardId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ operationId: '00000000-0000-4000-8000-000000000102', name: 'HTTP Test Reward', costPoints: 3, expectedRevision: created.revision }),
      });
      const updatedBody = await updatedResponse.json();
      expect({ status: updatedResponse.status, body: updatedBody }).toMatchObject({ status: 200, body: { costPoints: 3, revision: 2, active: true } });
    } finally {
      await new Promise<void>((resolve) => backend.server.close(() => resolve()));
    }
  });
});
